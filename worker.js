const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_WINDOW_SECONDS = 31 * 86400;
const CURRENCY_CODES = { UAH: 980, USD: 840, EUR: 978, PLN: 985 };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });

function monoError(status, body) {
  if (status === 429) return "Monobank обмежив частоту запитів. Спробуйте пізніше.";
  if (status === 401 || status === 403) return "Monobank відхилив токен. Перевірте доступ до API.";
  return body?.errorDescription || body?.error || `Помилка Monobank API (${status}).`;
}
async function monoGet(url, token) {
  const response = await fetch(url, { headers: { "X-Token": token, accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(monoError(response.status, body)), { status: response.status });
  return body;
}
function rateFor(rates, from, to) {
  const row = (Array.isArray(rates) ? rates : []).find(x => Number(x.currencyCodeA) === from && Number(x.currencyCodeB) === to);
  const rate = Number(row?.rateSell || row?.rateCross || row?.rateBuy);
  return rate > 0 ? rate : null;
}
function convertRate(rates, from, to) {
  if (from === to) return 1;
  const direct = rateFor(rates, from, to);
  if (direct) return direct;
  const inverse = rateFor(rates, to, from);
  if (inverse) return 1 / inverse;
  if (from !== 980 && to !== 980) {
    const a = rateFor(rates, from, 980), b = rateFor(rates, 980, to);
    if (a && b) return a * b;
  }
  return null;
}
function normalize(tx, account, targetCode, rates) {
  const sourceCode = Number(tx.currencyCode || account.currencyCode || 980);
  const raw = Number(tx.amount || 0) / 100;
  const rate = convertRate(rates, sourceCode, targetCode);
  const masked = Array.isArray(account.maskedPan) ? account.maskedPan.filter(Boolean).join(" · ") : "";
  const amount = Math.round(Math.abs(raw) * (rate || 1) * 100) / 100;
  return {
    id: String(tx.id), monoId: String(tx.id), accountId: String(account.id),
    accountName: `${account.type || "Картка"}${masked ? ` · ${masked}` : ""}`, cardName: masked,
    type: raw < 0 ? "expense" : "income", amount,
    convertedAmount: rate ? amount : null, currency: sourceCode, targetCurrency: targetCode,
    description: String(tx.description || tx.comment || "").slice(0, 180),
    merchantName: String(tx.mcc || ""), mcc: Number(tx.mcc) || 0,
    date: new Date(Number(tx.time) * 1000).toISOString().slice(0, 10),
    time: Number(tx.time), source: "monobank"
  };
}
async function monobank(request, env) {
  if (request.method !== "POST") return json({ error: "Використовуйте POST." }, 405, { allow: "POST, OPTIONS" });
  let input;
  try { input = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); }
  const token = String(env.MONOBANK_TOKEN || input?.token || "").trim();
  if (!token || token.length > 512) return json({ error: "Налаштуйте MONOBANK_TOKEN у Worker." }, 400);
  const now = Math.floor(Date.now() / 1000);
  const end = Math.min(now, Number(input.to) > 0 ? Number(input.to) : now);
  const start = Math.max(end - MAX_WINDOW_SECONDS, Math.min(Number(input.from) > 0 ? Number(input.from) : end - MAX_WINDOW_SECONDS, end - 60));
  const targetCode = CURRENCY_CODES[String(input.currency || "UAH").toUpperCase()] || 980;
  try {
    const client = await monoGet("https://api.monobank.ua/personal/client-info", token);
    const accounts = Array.isArray(client?.accounts) ? client.accounts : [];
    if (!accounts.length) return json({ error: "Для цього токена не знайдено рахунків." }, 404);
    let rates = [];
    if (targetCode !== 980) {
      try { rates = await fetch("https://api.monobank.ua/bank/currency").then(r => r.ok ? r.json() : []); } catch { rates = []; }
    }
    const transactions = [], accountResults = [], failures = [];
    for (const account of accounts) {
      if (!account?.id) continue;
      try {
        const statement = await monoGet(`https://api.monobank.ua/personal/statement/${encodeURIComponent(account.id)}/${start}/${end}`, token);
        for (const tx of Array.isArray(statement) ? statement : []) if (tx?.id != null) transactions.push(normalize(tx, account, targetCode, rates));
        accountResults.push({ accountId: String(account.id), accountName: String(account.type || "Рахунок"), currencyCode: Number(account.currencyCode), count: Array.isArray(statement) ? statement.length : 0 });
      } catch (error) { failures.push({ accountId: String(account.id), error: error.message, status: error.status || 0 }); }
    }
    transactions.sort((a, b) => Number(b.time) - Number(a.time));
    return json({ ok: true, transactions, accounts: accountResults, failures, partial: failures.length > 0, count: transactions.length, currency: Object.keys(CURRENCY_CODES).find(k => CURRENCY_CODES[k] === targetCode) || "UAH" });
  } catch (error) {
    return json({ error: error.message || "Не вдалося отримати дані Monobank." }, error.status === 429 ? 429 : error.status === 401 || error.status === 403 ? error.status : 502);
  }
}

function budgetAnswer(input) {
  const question = String(input.question || "").trim().toLocaleLowerCase("uk");
  const income = Math.max(0, Number(input.income) || 0), expenses = Math.max(0, Number(input.expenses) || 0);
  const daysLeft = Math.max(1, Math.min(31, Number(input.daysLeft) || 1));
  const currency = String(input.currency || "UAH").toUpperCase();
  const unit = ({ UAH: "грн", USD: "доларів", EUR: "євро", PLN: "злотих" })[currency] || currency;
  const totals = input.categoryTotals && typeof input.categoryTotals === "object" ? input.categoryTotals : {};
  const limits = input.categoryLimits && typeof input.categoryLimits === "object" ? input.categoryLimits : {};
  const credits = Array.isArray(input.credits) ? input.credits : [], goals = Array.isArray(input.goals) ? input.goals : [];
  const payments = credits.reduce((sum, item) => sum + Math.max(0, Number(item.payment) || 0), 0);
  const free = income - expenses - payments;
  const category = question.includes("продукт") || question.includes("їж") || question.includes("їд") ? "Продукти"
    : question.includes("одяг") ? "Одяг" : question.includes("каф") || question.includes("ресторан") ? "Кафе"
    : question.includes("транспорт") || question.includes("бензин") ? "Транспорт" : null;
  if (category) {
    const spent = Math.max(0, Number(totals[category]) || 0), limit = Math.max(0, Number(limits[category]) || 0);
    const days = new Date().getDate(), monthDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const forecast = spent / Math.max(1, days) * monthDays;
    if (limit) return spent >= limit ? `${category}: ліміт ${Math.round(limit)} ${unit} вичерпано або перевищено на ${Math.round(spent - limit)} ${unit}. Прогноз — ${Math.round(forecast)} ${unit}.` : `${category}: витрачено ${Math.round(spent)} з ${Math.round(limit)} ${unit}; залишок ${Math.round(limit - spent)} ${unit}. До кінця місяця ${daysLeft} дн.`;
    return `${category}: витрачено ${Math.round(spent)} ${unit}; прогноз за поточним темпом — ${Math.round(forecast)} ${unit}. Задайте ліміт у налаштуваннях.`;
  }
  if (question.includes("кредит") || question.includes("платіж")) {
    if (!credits.length) return "Кредитів у бюджеті не записано. Додайте їх у вкладці «Кредити», щоб враховувати платежі.";
    const next = credits.filter(c => c.paymentDate).sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)))[0];
    return `Планові платежі за кредитами: ${Math.round(payments)} ${unit}.${next ? ` Найближча дата: ${next.paymentDate} (${String(next.name || "кредит").slice(0, 40)}).` : " Додайте дату платежу для нагадування."}`;
  }
  if (question.includes("ціл") || question.includes("відкла") || question.includes("заощад") || question.includes("відпуст")) {
    if (!goals.length) return `Цілі ще не додані. Створіть ціль у вкладці «Цілі». Вільно: ${Math.round(free)} ${unit}.`;
    const goal = goals[0];
    return `Ціль «${String(goal.name || "Мета").slice(0, 50)}»: відкладено ${Math.round(Number(goal.saved) || 0)} з ${Math.round(Number(goal.target) || 0)} ${unit}. Спробуйте відкладати невелику суму щотижня.`;
  }
  if (income > 0 && free < 0) return `Витрати та кредитні платежі перевищують доходи на ${Math.round(-free)} ${unit}. Перегляньте необов’язкові покупки.`;
  if (income > 0) return `Доходи: ${Math.round(income)} ${unit}; витрати: ${Math.round(expenses)} ${unit}; платежі: ${Math.round(payments)} ${unit}. Залишок близько ${Math.round(free)} ${unit}, орієнтир — ${Math.round(Math.max(0, free / daysLeft))} ${unit} на день.`;
  return "Додайте доходи й витрати за цей місяць, щоб порада була точнішою. Запитайте про продукти, одяг, кафе, транспорт, кредити або цілі.";
}
async function ask(request) {
  if (request.method !== "POST") return json({ error: "Використовуйте POST." }, 405, { allow: "POST, OPTIONS" });
  let input;
  try { input = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); }
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return json({ error: "Напишіть запитання." }, 400);
  if (question.length > 500) return json({ error: "Запитання має бути коротшим за 500 символів." }, 413);
  return json({ ok: true, answer: budgetAnswer({ ...input, question }), provider: "local-rules", generatedAt: new Date().toISOString() });
}
async function advice(request) {
  let input = {};
  if (request.method === "POST") { try { input = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); } }
  else if (request.method !== "GET") return json({ error: "Використовуйте GET або POST." }, 405, { allow: "GET, POST, OPTIONS" });
  const tips = ["Перевірте темп витрат на продукти та порівняйте його з місячним лімітом.", "Залиште частину коштів на резерв для непередбачених витрат."];
  const income = Number(input.income) || 0, expenses = Number(input.expenses) || 0;
  if (income > 0 && expenses > income) tips.unshift("Витрати перевищують дохід за період — перегляньте необов’язкові покупки.");
  return json({ ok: true, advice: tips, generatedAt: new Date().toISOString() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization, X-Token", "access-control-max-age": "86400" } });
    if (url.pathname === "/api/monobank") return monobank(request, env);
    if (url.pathname === "/api/ask") return ask(request);
    if (url.pathname === "/api/advice") return advice(request);
    if (url.pathname.startsWith("/api/")) return json({ error: "Ендпоінт не знайдено." }, 404);
    if (!env.ASSETS) return new Response("Static assets binding ASSETS is not configured.", { status: 500 });
    const response = await env.ASSETS.fetch(request);
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return response;
    return new HTMLRewriter().on("body", { element(element) { element.append('<script src="/assistant.js" defer></script>', { html: true }); } }).transform(response);
  }
};
