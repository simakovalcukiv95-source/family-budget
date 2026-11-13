import application from "./worker.js";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function cleanNumber(value, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), max) : 0;
}

function budgetSummary(input) {
  const categoryTotals = {};
  const categoryLimits = {};
  for (const [key, value] of Object.entries(input.categoryTotals || {}).slice(0, 20)) {
    categoryTotals[String(key).slice(0, 40)] = cleanNumber(value);
  }
  for (const [key, value] of Object.entries(input.categoryLimits || {}).slice(0, 20)) {
    categoryLimits[String(key).slice(0, 40)] = cleanNumber(value);
  }

  const currencies = new Set(["UAH", "USD", "EUR", "PLN"]);
  const requestedCurrency = String(input.currency || "UAH").toUpperCase();
  return {
    income: cleanNumber(input.income),
    expenses: cleanNumber(input.expenses),
    daysLeft: Math.max(1, Math.min(31, Math.round(Number(input.daysLeft) || 1))),
    currency: currencies.has(requestedCurrency) ? requestedCurrency : "UAH",
    categoryTotals,
    categoryLimits,
    credits: (Array.isArray(input.credits) ? input.credits : []).slice(0, 20).map((item) => ({
      name: String(item?.name || "Кредит").slice(0, 60),
      remaining: cleanNumber(item?.remaining),
      payment: cleanNumber(item?.payment),
      interestRate: cleanNumber(item?.interestRate, 1000),
    })),
    goals: (Array.isArray(input.goals) ? input.goals : []).slice(0, 20).map((item) => ({
      name: String(item?.name || "Ціль").slice(0, 60),
      target: cleanNumber(item?.target),
      saved: cleanNumber(item?.saved),
    })),
  };
}

function aiError(error) {
  const text = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  if (status === 429 || /rate.?limit|too many requests|quota/.test(text)) {
    return { status: 429, code: "AI_RATE_LIMIT", error: "Workers AI тимчасово обмежив запити. Зачекайте хвилину й спробуйте ще раз." };
  }
  if ([401, 403].includes(status) || /unauthorized|forbidden|permission|not entitled/.test(text)) {
    return { status: 503, code: "AI_ACCESS", error: "Cloudflare не надав Worker доступ до Workers AI. Перевірте доступність Workers AI для акаунта та binding AI." };
  }
  if (status === 400 || /invalid.*(input|model)|model.*not found|unsupported/.test(text)) {
    return { status: 502, code: "AI_MODEL_REQUEST", error: "Workers AI відхилив запит моделі. Перевірте підтримку моделі та формат запиту в логах Worker." };
  }
  return { status: 502, code: "AI_INFERENCE", error: "Не вдалося отримати відповідь від Workers AI. Перевірте доступ до моделі й журнал Worker у Cloudflare, потім спробуйте ще раз." };
}

async function ask(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Використовуйте POST." }, 405);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, code: "INVALID_JSON", error: "Не вдалося прочитати запит. Спробуйте ще раз." }, 400);
  }

  const question = typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return json({ ok: false, code: "EMPTY_QUESTION", error: "Напишіть запитання." }, 400);
  if (question.length > 500) return json({ ok: false, code: "QUESTION_TOO_LONG", error: "Запитання має містити не більше 500 символів." }, 413);

  if (!env?.AI || typeof env.AI.run !== "function") {
    return json({
      ok: false,
      code: "AI_BINDING_MISSING",
      error: "Workers AI не підключений до цього Worker. Перевірте binding AI у Cloudflare та повторно розгорніть Worker.",
    }, 503);
  }

  const budget = budgetSummary(input);
  const system = "Ти — помічник сімейного бюджету. Відповідай українською, стисло, доброзичливо та практично. Використовуй лише надані підсумки, не вигадуй фактів. Якщо даних бракує — скажи про це. Поради загальні й не є фінансовою гарантією. Не проси карткові реквізити або секрети.";
  const user = `Запитання: ${question}\n\nПідсумки бюджету (JSON): ${JSON.stringify(budget)}`;
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 450,
      temperature: 0.35,
    });
    const answer = typeof result === "string"
      ? result
      : result?.response || result?.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      console.error("Workers AI returned an empty response", { requestId, model: MODEL });
      return json({
        ok: false,
        code: "AI_EMPTY_RESPONSE",
        error: "Workers AI не повернув текст відповіді. Спробуйте ще раз; якщо повториться — перевірте журнали Worker.",
        requestId,
      }, 502);
    }

    return json({
      ok: true,
      answer: answer.trim(),
      provider: "cloudflare-workers-ai",
      model: MODEL,
      requestId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = aiError(error);
    // Keep provider diagnostics in Cloudflare logs, but never expose raw internals to the browser.
    console.error("Workers AI inference failed", {
      requestId,
      model: MODEL,
      status: Number(error?.status || error?.statusCode || error?.cause?.status || 0) || undefined,
      name: String(error?.name || "Error").slice(0, 80),
      message: String(error?.message || "Unknown Workers AI error").slice(0, 500),
      code: String(error?.code || "").slice(0, 80),
    });
    return json({ ok: false, code: failure.code, error: failure.error, requestId }, failure.status);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ask") return ask(request, env);

    // Ensure mobile browsers pick up the current assistant frontend after a deploy.
    if (url.pathname === "/assistant.js") {
      const response = await application.fetch(request, env, ctx);
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store, max-age=0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return application.fetch(request, env, ctx);
  },
};
