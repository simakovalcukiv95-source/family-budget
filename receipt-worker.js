import application from "./ai-worker.js";

const RECEIPT_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function parseModelText(result) {
  const text = typeof result === "string" ? result : result?.response || result?.description || "";
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function receipt(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Використовуйте POST." }, 405);
  if (!env?.AI || typeof env.AI.run !== "function") return json({ ok: false, error: "Workers AI не підключений. Додайте товари вручну." }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: "Не вдалося прочитати фото чека." }, 400); }
  const image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function") return json({ ok: false, error: "Додайте фото чека." }, 400);
  if (!/^image\/(jpeg|png|webp)$/.test(image.type)) return json({ ok: false, error: "Підтримуються JPEG, PNG або WebP." }, 415);
  if (image.size > MAX_RECEIPT_BYTES) return json({ ok: false, error: "Фото має бути до 5 МБ." }, 413);
  try {
    const result = await env.AI.run(RECEIPT_MODEL, {
      task: "query", image: new Uint8Array(await image.arrayBuffer()),
      question: "Read this receipt. Return only JSON: {\"merchant\":string|null,\"date\":\"YYYY-MM-DD\"|null,\"items\":[{\"name\":string,\"price\":number}]}. Include only purchased product lines and final line prices, exclude totals/payment lines. Do not guess; use [] if unreadable.",
      max_tokens: 700,
    });
    const parsed = parseModelText(result);
    const items = Array.isArray(parsed?.items) ? parsed.items.slice(0, 100).map((item) => ({ name: String(item?.name || "").trim().slice(0, 80), price: Number(item?.price) })).filter((item) => item.name && Number.isFinite(item.price) && item.price > 0 && item.price <= 100_000_000) : [];
    if (!items.length) return json({ ok: false, code: "RECEIPT_UNREADABLE", error: "Не вдалося розпізнати товари. Введіть їх вручну." }, 422);
    return json({ ok: true, merchant: typeof parsed.merchant === "string" ? parsed.merchant.slice(0, 80) : "", date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : "", items, total: items.reduce((sum, item) => sum + item.price, 0), needsConfirmation: true });
  } catch (error) {
    console.error("Receipt Workers AI failed", { status: Number(error?.status || error?.statusCode || 0) || undefined, message: String(error?.message || "unknown").slice(0, 300) });
    return json({ ok: false, code: "RECEIPT_INFERENCE_FAILED", error: "Не вдалося розпізнати чек. Введіть товари вручну." }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/receipt") return receipt(request, env);
    return application.fetch(request, env, ctx);
  },
};
