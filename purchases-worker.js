import application from "./receipt-worker.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const INTERNAL_TRANSFER = /(?:переказ|перевод).{0,35}(?:між своїми|власн(?:ими|их) рахун|власн(?:ими|их) карт)|(?:між своїми|власн(?:ими|их) рахун|власн(?:ими|их) карт).{0,35}(?:переказ|перевод)/i;
const CREDIT_PAYMENT = /(?:погашенн.{0,30}кредит|оплат.{0,30}кредит|кредит.{0,30}(?:погашенн|оплат)|repayment of loan|loan repayment|credit card payment)/i;

function classifyTransaction(transaction) {
  const description = String(transaction.description || transaction.merchantName || "");
  if (INTERNAL_TRANSFER.test(description)) {
    return { ...transaction, type: "transfer", internalTransfer: true, isTransfer: true, category: "Переказ між своїми рахунками" };
  }
  if (CREDIT_PAYMENT.test(description)) {
    return { ...transaction, type: "credit-payment", isCreditPayment: true, category: "Оплата кредиту" };
  }
  return transaction;
}

async function decorateMonobankResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/json")) return response;
  let body;
  try { body = await response.clone().json(); } catch { return response; }
  if (!Array.isArray(body.transactions)) return response;
  body.transactions = body.transactions.map(classifyTransaction);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Receipt, AI, Monobank, credits, and legacy API paths all flow through the deployed Worker chain.
    const response = await application.fetch(request, env, ctx);
    if (url.pathname === "/api/monobank" && request.method === "POST") return decorateMonobankResponse(response);

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) return response;
    return new HTMLRewriter()
      .on("head", {
        element(element) {
          element.append(`<style>
            .tabs{min-height:76px;padding:12px 16px;border-radius:22px;background:#fff;box-shadow:0 10px 36px #20243a18;gap:8px}
            .tabs .tab{min-height:52px;padding:0 20px;border-radius:16px;font-weight:700;transition:background .18s,transform .18s}
            .tabs .tab:active{transform:scale(.97)}
            @media(max-width:680px){.tabs{min-height:86px;padding:10px 8px calc(10px + env(safe-area-inset-bottom));gap:4px}.tabs .tab{min-height:54px;padding:0 12px;border-radius:16px;font-size:14px}}
          </style>`, { html: true });
        },
      })
      .on("body", {
        element(element) {
          element.append('<script src="/purchases.js" defer></script><script src="/enhancements.js" defer></script><script src="/monobank-controls.js" defer></script>', { html: true });
        },
      })
      .transform(response);
  },
};
