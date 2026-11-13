import application from "./worker.js";

const PRIMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function safeNumber(value, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), max) : 0;
}

function budgetSummary(input) {
  const totals = {};
  const limits = {};
  for (const [key, value] of Object.entries(input.categoryTotals || {}).slice(0, 20)) {
    totals[String(key).slice(0, 40)] = safeNumber(value);
  }
  for (const [key, value] of Object.entries(input.categoryLimits || {}).slice(0, 20)) {
    limits[String(key).slice(0, 40)] = safeNumber(value);
  }

  const currencies = new Set(["UAH", "USD", "EUR", "PLN"]);
  const currency = String(input.currency || "UAH").toUpperCase();
  return {
    income: safeNumber(input.income),
    expenses: safeNumber(input.expenses),
    daysLeft: Math.max(1, Math.min(31, Math.round(Number(input.daysLeft) || 1))),
    currency: currencies.has(currency) ? currency : "UAH",
    categoryTotals: totals,
    categoryLimits: limits,
    credits: (Array.isArray(input.credits) ? input.credits : []).slice(0, 20).map((item) => ({
      name: String(item?.name || "Кредит").slice(0, 60),
      remaining: safeNumber(item?.remaining),
      payment: safeNumber(item?.payment),
      interestRate: safeNumber(item?.interestRate, 1000),
    })),
    goals: (Array.isArray(input.goals) ? input.goals : []).slice(0, 20).map((item) => ({
      name: String(item?.name || "Ціль").slice(0, 60),
      target: safeNumber(item?.target),
      saved: safeNumber(item?.saved),
    })),
  };
}

function errorDetails(error) {
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  const message = String(error?.message || error?.cause?.message || "Workers AI inference failed").slice(0, 500);
  const deprecated = status === 410 || /deprecated|no longer available|model.*retired/i.test(message);
  return { status, message, deprecated };
}

function publicError(error) {
  const details = errorDetails(error);
  if (details.deprecated) {
    return {
      status: 502,
      code: "AI_MODEL_DEPRECATED",
      error: "Workers AI відхилив застарілу або недоступну модель. Перевірте список активних моделей і журнали Worker.",
    };
  }
  if (details.status === 429 || /rate.?limit|too many requests|quota/i.test(details.message)) {
    return {
      status: 429,
      code: "AI_RATE_LIMIT",
      error: "Workers AI тимчасово обмежив запити. Зачекайте хвилину й спробуйте ще раз.",
    };
  }
  if ([401, 403].includes(details.status) || /unauthorized|forbidden|permission|not entitled/i.test(details.message)) {
    return {
      status: 503,
      code: "AI_ACCESS",
      error: "Cloudflare не надав Worker доступ до Workers AI. Перевірте binding AI та доступ Workers AI для акаунта.",
    };
  }
  return {
    status: 502,
    code: "AI_INFERENCE",
    error: "Не вдалося отримати відповідь від Workers AI. Перевірте журнали Worker у Cloudflare та спробуйте ще раз.",
  };
}

async function runModel(env, model, messages) {
  const result = await env.AI.run(model, {
    messages,
    max_tokens: 450,
    temperature: 0.35,
  });
  if (result?.success === false || result?.error) {
    throw new Error(String(result.error || "Workers AI reported an unsuccessful inference"));
  }
  const answer = typeof result === "string"
    ? result
    : result?.response || result?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Workers AI returned an empty response");
  }
  return answer.trim();
}

async function ask(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Використовуйте POST." }, 405, { allow: "POST, OPTIONS" });
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, code: "INVALID_JSON", error: "Не вдалося прочитати запит. Спробуйте ще раз." }, 400);
  }

  const question = typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return json({ ok: false, code: "EMPTY_QUESTION", error: "Напишіть запитання." }, 400);
  if (question.length > 500) {
    return json({ ok: false, code: "QUESTION_TOO_LONG", error: "Запитання має містити не більше 500 символів." }, 413);
  }
  if (!env?.AI || typeof env.AI.run !== "function") {
    return json({
      ok: false,
      code: "AI_BINDING_MISSING",
      error: "Workers AI не підключений до цього Worker. Перевірте binding AI у Cloudflare та повторно розгорніть Worker.",
    }, 503);
  }

  const budget = budgetSummary(input);
  const messages = [
    {
      role: "system",
      content: "Ти — помічник сімейного бюджету. Відповідай українською, стисло, доброзичливо та практично. Використовуй лише надані підсумки, не вигадуй фактів. Якщо даних бракує — скажи про це. Поради загальні й не є фінансовою гарантією. Не проси карткові реквізити або секрети.",
    },
    {
      role: "user",
      content: `Запитання: ${question}\n\nПідсумки бюджету (JSON): ${JSON.stringify(budget)}`,
    },
  ];
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  let primaryError;

  try {
    const answer = await runModel(env, PRIMARY_MODEL, messages);
    return json({
      ok: true,
      answer,
      provider: "cloudflare-workers-ai",
      model: PRIMARY_MODEL,
      requestId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    primaryError = error;
    console.error("Workers AI primary model failed; trying fallback", {
      requestId,
      model: PRIMARY_MODEL,
      ...errorDetails(error),
      name: String(error?.name || "Error").slice(0, 80),
      code: String(error?.code || "").slice(0, 80),
    });
  }

  try {
    const answer = await runModel(env, FALLBACK_MODEL, messages);
    return json({
      ok: true,
      answer,
      provider: "cloudflare-workers-ai",
      model: FALLBACK_MODEL,
      fallback: true,
      requestId,
      generatedAt: new Date().toISOString(),
    });
  } catch (fallbackError) {
    console.error("Workers AI fallback model failed", {
      requestId,
      model: FALLBACK_MODEL,
      ...errorDetails(fallbackError),
      name: String(fallbackError?.name || "Error").slice(0, 80),
      code: String(fallbackError?.code || "").slice(0, 80),
    });
    const failure = publicError(fallbackError);
    if (errorDetails(primaryError).deprecated && !errorDetails(fallbackError).deprecated) {
      failure.primaryModelDeprecated = true;
    }
    return json({ ok: false, ...failure, requestId }, failure.status);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ask" && request.method === "OPTIONS") {
      return application.fetch(request, env, ctx);
    }
    if (url.pathname === "/api/ask") return ask(request, env);

    // Avoid serving a cached copy of the assistant after a deployment.
    if (url.pathname === "/assistant.js") {
      const response = await application.fetch(request, env, ctx);
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store, max-age=0");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return application.fetch(request, env, ctx);
  },
};
