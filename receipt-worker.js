import assistantApplication from "./ai-worker.js";

const RECEIPT_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function parseModelText(result) {
  const text = typeof result === "string" ? result : result?.response || result?.description || "";
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function receipt(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Використовуйте POST." }, 405);
  if (!env?.AI || typeof env.AI.run !== "function") {
    return json({ ok: false, error: "Розпізнавання недоступне: перевірте binding Workers AI `AI`. Можна додати товари вручну." }, 503);
  }

  let form;
  try { form = await request.formData(); } catch {
    return json({ ok: false, error: "Не вдалося прочитати фото чека. Спробуйте вибрати зображення ще раз." }, 400);
  }
  const image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function") return json({ ok: false, error: "Додайте фото чека." }, 400);
  if (!/^image\/(jpeg|png|webp)$/.test(image.type)) return json({ ok: false, error: "Підтримуються зображення JPEG, PNG або WebP." }, 415);
  if (image.size > MAX_RECEIPT_BYTES) return json({ ok: false, error: "Фото завелике. Виберіть зображення до 5 МБ." }, 413);

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const result = await env.AI.run(RECEIPT_MODEL, {
      task: "query",
      image: bytes,
      question: "Read this shop receipt. Return ONLY valid JSON, no markdown, in this schema: {\"merchant\": string|null, \"date\": \"YYYY-MM-DD\"|null, \"items\": [{\"name\": string, \"price\": number}], \"total\": number|null}. Include only purchased product line items with their final line prices, not subtotals, discounts, tax summary, or payment lines. Prices must be numeric UAH amounts. If unreadable, return an empty items array. Do not guess missing values.",
      max_tokens: 700,
    });
    const parsed = parseModelText(result);
    if (!parsed || !Array.isArray(parsed.items)) {
      return json({ ok: false, code: "RECEIPT_UNREADABLE", error: "Не вдалося впевнено розпізнати товари. Введіть їх вручну." }, 422);
    }
    const items = parsed.items.slice(0, 100).map((item) => ({
      name: String(item?.name || "").trim().slice(0, 80),
      price: Number(item?.price),
    })).filter((item) => item.name && Number.isFinite(item.price) && item.price > 0 && item.price <= 100_000_000);
    if (!items.length) {
      return json({ ok: false, code: "RECEIPT_NO_ITEMS", error: "На фото не знайдено товарів. Додайте їх вручну." }, 422);
    }
    return json({
      ok: true,
      merchant: typeof parsed.merchant === "string" ? parsed.merchant.trim().slice(0, 80) : "",
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : "",
      items,
      total: items.reduce((sum, item) => sum + item.price, 0),
      model: RECEIPT_MODEL,
      needsConfirmation: true,
    });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 0);
    console.error("Receipt Workers AI inference failed", {
      model: RECEIPT_MODEL,
      status: status || undefined,
      message: String(error?.message || "unknown error").slice(0, 400),
    });
    return json({ ok: false, code: status === 410 ? "RECEIPT_MODEL_UNAVAILABLE" : "RECEIPT_INFERENCE_FAILED", error: "Не вдалося розпізнати чек зараз. Товари можна ввести вручну." }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/receipt") return receipt(request, env);
    return assistantApplication.fetch(request, env, ctx);
  },
};
