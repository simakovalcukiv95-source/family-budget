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
  const row = rates.find(x => Number(x.currencyCodeA) === from && Number(x.currencyCodeB) === to);
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
  const accountCode = Number(account.currencyCode);
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
  // Prefer a Cloudflare secret. The request-body token is a compatibility option for personal use.
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
      try {
        rates = await fetch("https://api.monobank.ua/bank/currency").then(r => r.ok ? r.json() : []);
      } catch { rates = []; }
    }
    const transactions = [], accountResults = [], failures = [];
    // Query every account; a per-account failure does not hide transactions from the other cards.
    for (const account of accounts) {
      if (!account?.id) continue;
      try {
        const statement = await monoFetch(`https://api.monobank.ua/personal/statement/${encodeURIComponent(account.id)}/${from}/${to}`, token);
        for (const tx of Array.isArray(statement) ? statement : []) {
          if (tx?.id == null) continue;
          transactions.push(normalize(tx, account, targetCurrency, rates));
        }
        accountResults.push({ accountId: String(account.id), accountName: String(account.type || "Рахунок"), count: Array.isArray(statement) ? statement.length : 0 });
      } catch (error) {
        failures.push({ accountId: String(account.id), error: error.message, status: error.status || 0 });
      }
    }
    transactions.sort((a, b) => b.time - a.time);
    return json({ ok: true, transactions, accounts: accountResults, failures, partial: failures.length > 0, count: transactions.length, currency: Object.keys(CURRENCY_CODES).find(k => CURRENCY_CODES[k] === targetCurrency) || "UAH" });
  } catch (error) {
    return json({ error: error.message || "Не вдалося отримати дані Monobank." }, error.status === 429 ? 429 : error.status === 401 || error.status === 403 ? error.status : 502);
  }
}

async function advice(request) {
  let input = {};
  if (request.method === "POST") {
    try { input = await request.json(); } catch { return json({ error: "Некоректний JSON." }, 400); }
  } else if (request.method !== "GET") return json({ error: "Використовуйте GET або POST." }, 405, { allow: "GET, POST, OPTIONS" });
  const tips = ["Перевірте темп витрат на продукти та порівняйте його з місячним лімітом.", "Залиште частину вільної суми на заплановані платежі й непередбачені витрати."];
  if (Number(input.expenses) > Number(input.income) && Number(input.income) > 0) tips.unshift("Витрати вже перевищують дохід за наданий період — перегляньте необов’язкові покупки.");
  if (Number(input.foodLimit) > 0 && Number(input.food) > Number(input.foodLimit)) tips.unshift("Витрати на продукти перевищили встановлений ліміт.");
  return json({ ok: true, advice: tips, generatedAt: new Date().toISOString() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": url.origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization", "access-control-max-age": "86400" } });
    }
    if (url.pathname === "/api/monobank") return monobank(request, env);
    if (url.pathname === "/api/advice") return advice(request);
    if (url.pathname.startsWith("/api/")) return json({ error: "Ендпоінт не знайдено." }, 404);
    if (!env.ASSETS) return new Response("Static assets binding ASSETS is not configured.", { status: 500 });
    return env.ASSETS.fetch(request);
  }
};
