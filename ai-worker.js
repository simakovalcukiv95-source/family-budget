import application from "./worker.js";

const PRIMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const safeNumber = (value, max = 1e9) => { const n = Number(value); return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0; };

function safeContext(input) {
  const categories = {};
  for (const [key, value] of Object.entries(input.categoryTotals || {}).slice(0, 20)) categories[String(key).slice(0, 40)] = safeNumber(value);
  const list = (value, mapper, max = 12) => (Array.isArray(value) ? value : []).slice(0, max).map(mapper);
  return {
    periodFrom: String(input.periodFrom || "").slice(0, 10),
    income: safeNumber(input.income), expenses: safeNumber(input.expenses), creditPayments: safeNumber(input.creditPayments), available: safeNumber(input.available),
    daysLeft: Math.max(1, Math.min(31, Math.round(Number(input.daysLeft) || 1))), currency: /^(UAH|USD|EUR|PLN)$/.test(String(input.currency || "UAH")) ? String(input.currency || "UAH") : "UAH",
    categoryTotals: categories,
    categoryLimits: Object.fromEntries(Object.entries(input.categoryLimits || {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), safeNumber(v)])),
    topItems: list(input.topItems, (item) => ({ name: String(item?.name || "").slice(0, 60), spent: safeNumber(item?.spent), purchases: safeNumber(item?.purchases, 10000) })),
    credits: list(input.credits, (item) => ({ name: String(item?.name || "Кредит").slice(0, 60), remaining: safeNumber(item?.remaining), payment: safeNumber(item?.payment), interestRate: safeNumber(item?.interestRate, 1000) })),
    goals: list(input.goals, (item) => ({ name: String(item?.name || "Ціль").slice(0, 60), target: safeNumber(item?.target), saved: safeNumber(item?.saved) })),
    transfersExcluded: true,
  };
}

function details(error) {
  return { status: Number(error?.status || error?.statusCode || error?.cause?.status || 0), message: String(error?.message || error?.cause?.message || "AI inference failed").slice(0, 400) };
}
async function invoke(env, model, messages) {
  const result = await env.AI.run(model, { messages, max_tokens: 500, temperature: 0.3 });
  if (result?.success === false || result?.error) throw new Error(String(result.error || "Inference unsuccessful"));
  const answer = typeof result === "string" ? result : result?.response || result?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Empty model response");
  return answer.trim();
}
async function ask(request, env) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Використовуйте POST." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ ok: false, code: "INVALID_JSON", error: "Некоректний JSON." }, 400); }
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return json({ ok: false, code: "EMPTY_QUESTION", error: "Напишіть запитання." }, 400);
  if (question.length > 500) return json({ ok: false, code: "QUESTION_TOO_LONG", error: "Запитання має бути до 500 символів." }, 413);
  if (typeof env?.AI?.run !== "function") return json({ ok: false, code: "AI_BINDING_MISSING", error: "Workers AI не підключений до Worker." }, 503);
  const context = safeContext(input);
  const messages = [
    { role: "system", content: "Ти — персональний помічник сімейного бюджету. Відповідай українською, коротко і прикладно. Використовуй лише контекст, розрізняй покупки, оплату кредитів і перекази між власними рахунками (перекази не є доходом або витратою). Звертай увагу на доступний залишок, темп витрат, ліміти категорій, найбільші товари, кредитні платежі та прогрес цілей. Не вигадуй відсотки чи фінансові факти; за нестачі даних прямо скажи. Не проси секрети або карткові реквізити. Поради загальні, без гарантій." },
    { role: "user", content: `Запитання: ${question}\n\nКонтекст бюджету (JSON): ${JSON.stringify(context)}` },
  ];
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  for (const [index, model] of [PRIMARY_MODEL, FALLBACK_MODEL].entries()) {
    try {
      const answer = await invoke(env, model, messages);
      return json({ ok: true, answer, model, fallback: index > 0, requestId, generatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Workers AI model failed", { requestId, model, ...details(error) });
      if (index === 1) {
        const status = details(error).status;
        const rateLimit = status === 429 || /quota|rate.?limit/i.test(details(error).message);
        return json({ ok: false, code: rateLimit ? "AI_RATE_LIMIT" : status === 410 ? "AI_MODEL_UNAVAILABLE" : "AI_INFERENCE", error: rateLimit ? "Workers AI тимчасово обмежив запити. Спробуйте пізніше." : "Не вдалося отримати пораду. Перевірте журнали Worker у Cloudflare.", requestId }, rateLimit ? 429 : 502);
      }
    }
  }
  return json({ ok: false, code: "AI_INFERENCE", error: "Не вдалося отримати пораду.", requestId }, 502);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ask" && request.method !== "OPTIONS") return ask(request, env);
    if (url.pathname === "/assistant.js") {
      const response = await application.fetch(request, env, ctx);
      const headers = new Headers(response.headers); headers.set("cache-control", "no-store, max-age=0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return application.fetch(request, env, ctx);
  },
};
