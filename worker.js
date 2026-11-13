const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;
const CURRENCY_CODES = { UAH: 980, USD: 840, EUR: 978, PLN: 985 };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function errorMessage(status, payload) {
  if (status === 429) return "Monobank обмежив частоту запитів. Спробуйте оновити пізніше.";
  if (status === 401 || status === 403) return "Monobank відхилив токен. Перевірте доступ до API.";
  return payload?.errorDescription || payload?.error || `Помилка Monobank API (${status}).`;
}
async function monoFetch(url, token) {
  const response = await fetch(url, { headers: { "X-Token": token, accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(errorMessage(response.status, payload)), { status: response.status });
  return payload;
}
function findRate(rates, from, to) {
  const row = (Array.isArray(rates) ? rates : []).find(x => Number(x.currencyCodeA) === from && Number(x.currencyCodeB) === to);
  if (!row) return null;
  const rate = Number(row.rateSell || row.rateCross || row.rateBuy);
  return rate > 0 ? rate : null;
}
function convert(value, from, to, rates) {
  if (from === to) return value;
  const direct = findRate(rates, from, to);
  if (direct) return value * direct;
  const inverse = findRate(rates, to, from);
  if (inverse) return value / inverse;
  if (from !== 980 && to !== 980) {
    const a = findRate(rates, from, 980), b = findRate(rates, 980, to);
    if (a && b) return value * a * b;
  }
  return null;
}
function normalize(tx, account, targetCode, rates) {
  const accountCode = Number(account.currencyCode || 980);
  const transactionCode = Number(tx.currencyCode || accountCode);
  const major = Number(tx.amount || 0) / 100;
  const converted = convert(Math.abs(major), transactionCode, targetCode, rates);
  return {
    id: String(tx.id), monoId: String(tx.id), accountId: String(account.id),
    accountName: `${account.type || "Картка"}${Array.isArray(account.maskedPan) && account.maskedPan.length ? ` · ${account.maskedPan.filter(Boolean).join(" · ")}` : ""}`,
    cardName: Array.isArray(account.maskedPan) ? account.maskedPan.filter(Boolean).join(" · ") : "",
    type: Number(tx.amount) < 0 ? "expense" : "income",
    amount: converted === null ? Math.abs(major) : Math.round(converted * 100) / 100,
    convertedAmount: converted === null ? null : Math.round(converted * 100) / 100,
    currency: transactionCode, targetCurrency: targetCode,
    description: String(tx.description || tx.comment || "").slice(0, 180),
    merchantName: String(tx.mcc || ""),
    date: new Date(Number(tx.time) * 1000).toISOString().slice(0, 10),
    time: Number(tx.time), source: "monobank"
  };
}
async function monobank(request, env) {
  if (request.method !== "POST") return json({ error: "Використовуйте POST." }, 405, { allow: "POST, OPTIONS" });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); }
  const token = String(env.MONOBANK_TOKEN || body?.token || "").trim();
  if (!token || token.length > 512) return json({ error: "Налаштуйте MONOBANK_TOKEN у Worker або передайте токен у запиті." }, 400);
  const now = Math.floor(Date.now() / 1000);
  const to = Math.min(now, Number.isFinite(Number(body.to)) ? Number(body.to) : now);
  const requestedFrom = Number.isFinite(Number(body.from)) ? Number(body.from) : to - MAX_WINDOW_SECONDS;
  const from = Math.max(to - MAX_WINDOW_SECONDS, Math.min(requestedFrom, to - 60));
  const targetCurrency = CURRENCY_CODES[String(body.currency || "UAH").toUpperCase()] || 980;
  try {
    const client = await monoFetch("https://api.monobank.ua/personal/client-info", token);
    const accounts = Array.isArray(client?.accounts) ? client.accounts : [];
    if (!accounts.length) return json({ error: "Для цього токена не знайдено рахунків." }, 404);
    let rates = [];
    if (targetCurrency !== 980) {
      try { rates = await fetch("https://api.monobank.ua/bank/currency").then(r => r.ok ? r.json() : []); } catch { rates = []; }
    }
    const transactions = [], accountResults = [], failures = [];
    for (const account of accounts) {
      if (!account?.id) continue;
      try {
        const statement = await monoFetch(`https://api.monobank.ua/personal/statement/${encodeURIComponent(account.id)}/${from}/${to}`, token);
        for (const tx of Array.isArray(statement) ? statement : []) if (tx?.id != null) transactions.push(normalize(tx, account, targetCurrency, rates));
        accountResults.push({ accountId: String(account.id), accountName: String(account.type || "Рахунок"), count: Array.isArray(statement) ? statement.length : 0 });
      } catch (error) { failures.push({ accountId: String(account.id), error: error.message, status: error.status || 0 }); }
    }
    transactions.sort((a, b) => Number(b.time) - Number(a.time));
    return json({ ok: true, transactions, accounts: accountResults, failures, partial: failures.length > 0, count: transactions.length, currency: Object.keys(CURRENCY_CODES).find(k => CURRENCY_CODES[k] === targetCurrency) || "UAH" });
  } catch (error) {
    return json({ error: error.message || "Не вдалося отримати дані Monobank." }, error.status === 429 ? 429 : error.status === 401 || error.status === 403 ? error.status : 502);
  }
}

// Deterministic, privacy-conscious budget helper. This can later be replaced by an AI provider.
function budgetAdvice(body) {
  const question = String(body.question || "").trim().toLocaleLowerCase("uk");
  const income = Math.max(0, Number(body.income) || 0);
  const expenses = Math.max(0, Number(body.expenses) || 0);
  const daysLeft = Math.max(1, Math.min(31, Number(body.daysLeft) || 1));
  const currency = String(body.currency || "UAH").toUpperCase();
  const currencyLabels = { UAH: "грн", USD: "доларів", EUR: "євро", PLN: "злотих" };
  const unit = currencyLabels[currency] || currency;
  const totals = body.categoryTotals && typeof body.categoryTotals === "object" ? body.categoryTotals : {};
  const limits = body.categoryLimits && typeof body.categoryLimits === "object" ? body.categoryLimits : {};
  const credits = Array.isArray(body.credits) ? body.credits : [];
  const goals = Array.isArray(body.goals) ? body.goals : [];
  const monthlyFree = income - expenses - credits.reduce((sum, item) => sum + (Number(item.payment) || 0), 0);
  const daily = Math.max(0, monthlyFree / daysLeft);
  const category = question.includes("продукт") || question.includes("їж") || question.includes("їд") ? "Продукти"
    : question.includes("одяг") ? "Одяг"
    : question.includes("каф") || question.includes("ресторан") ? "Кафе"
    : question.includes("транспорт") || question.includes("бензин") ? "Транспорт" : "";
  if (category) {
    const spent = Math.max(0, Number(totals[category]) || 0);
    const limit = Math.max(0, Number(limits[category]) || 0);
    const pace = spent / Math.max(1, new Date().getDate());
    const forecast = pace * new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    if (limit) {
      const remaining = Math.max(0, limit - spent);
      return `${category}: вже витрачено приблизно ${Math.round(spent)} ${unit}. До ліміту ${Math.round(limit)} ${unit} залишилося ${Math.round(remaining)} ${unit}. За поточним темпом прогноз — близько ${Math.round(forecast)} ${unit}.`;
    }
    return `${category}: витрачено приблизно ${Math.round(spent)} ${unit}; за поточним темпом до кінця місяця може вийти близько ${Math.round(forecast)} ${unit}. Задайте місячний ліміт, щоб відстежувати витрати.`;
  }
  if (question.includes("кредит") || question.includes("платіж")) {
    if (!credits.length) return "У списку поки немає кредитів. Додайте залишок, щомісячний платіж і дату, щоб враховувати їх у бюджеті.";
    const payment = credits.reduce((sum, item) => sum + (Number(item.payment) || 0), 0);
    const next = credits.filter(c => c.paymentDate).sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)))[0];
    return `Заплановані щомісячні платежі: близько ${Math.round(payment)} ${unit}. ${next ? `Перевірте дату найближчого платежу за кредитом «${String(next.name || "Кредит").slice(0, 60)}»: ${next.paymentDate}.` : "Додайте дату наступного платежу в картці кредиту."} Відмічайте оплату після фактичного платежу.`;
  }
  if (question.includes("ціл") || question.includes("відкла") || question.includes("заощад")) {
    if (!goals.length) return `Цілі ще не додані. Створіть ціль, а потім відкладайте фіксовану суму регулярно. Поточний вільний залишок за записами — приблизно ${Math.round(monthlyFree)} ${unit}.`;
    const goal = [...goals].sort((a, b) => (Number(a.saved) / Math.max(1, Number(a.target))) - (Number(b.saved) / Math.max(1, Number(b.target))))[0];
    return `Найменше заповнена ціль «${String(goal.name || "Мета").slice(0, 60)}»: відкладено ${Math.round(Number(goal.saved) || 0)} з ${Math.round(Number(goal.target) || 0)} ${unit}. Обирайте суму для відкладання так, щоб після платежів зберігався резерв на щоденні витрати.`;
  }
  if (income > 0 && monthlyFree < 0) return `За записаними операціями витрати й платежі перевищують дохід приблизно на ${Math.round(-monthlyFree)} ${unit}. Поставте на паузу необов’язкові покупки та перевірте, чи всі доходи цього місяця внесені.`;
  if (income > 0) return `Цього місяця записано доходів ${Math.round(income)} ${unit}, витрат ${Math.round(expenses)} ${unit}. Після запланованих платежів орієнтовно доступно ${Math.round(monthlyFree)} ${unit}, або близько ${Math.round(daily)} ${unit} на день на ${daysLeft} днів. Це оцінка за даними, внесеними в додаток.`;
  return "Щоб порада була точнішою, додайте доходи й витрати за цей місяць. Можете запитати про продукти, одяг, кафе, транспорт, кредити або цілі.";
}
async function ask(request) {
  if (request.method !== "POST") return json({ error: "Використовуйте POST." }, 405, { allow: "POST, OPTIONS" });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return json({ error: "Напишіть запитання." }, 400);
  if (question.length > 500) return json({ error: "Запитання має бути коротшим за 500 символів." }, 413);
  return json({ ok: true, answer: budgetAdvice({ ...body, question }), generatedAt: new Date().toISOString(), provider: "local-rules" });
}
async function advice(request) {
  let input = {};
  if (request.method === "POST") { try { input = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); } }
  else if (request.method !== "GET") return json({ error: "Використовуйте GET або POST." }, 405, { allow: "GET, POST, OPTIONS" });
  const tips = ["Перевірте темп витрат на продукти та порівняйте його з місячним лімітом.", "Залиште частину вільних коштів на резерв для непередбачених витрат."];
  const expenses = Number(input.expenses) || 0, income = Number(input.income) || 0, food = Number(input.food) || 0, foodLimit = Number(input.foodLimit) || 0;
  if (income > 0 && expenses > income) tips.unshift("Витрати вже перевищують дохід за наданий період — перегляньте необов’язкові покупки.");
  if (foodLimit > 0 && food >= foodLimit * 0.8) tips.unshift(food > foodLimit ? "Витрати на продукти перевищили встановлений ліміт." : "Ліміт на продукти майже вичерпано.");
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
    return env.ASSETS.fetch(request);
  }
};
