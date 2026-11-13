(() => {
  "use strict";

  const STORAGE_KEY = "kovalchuk-family-budget-v1";
  const ROOT_ID = "family-budget-assistant";
  const STYLE_ID = "family-budget-assistant-style";
  const CATEGORIES = ["Продукти", "Транспорт", "Одяг", "Кафе", "Комуналка", "Здоров’я", "Розваги", "Дім", "Інше"];

  function budgetSummary() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const operations = Array.isArray(data.operations) ? data.operations : [];
      const date = new Date();
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const current = operations.filter((operation) => String(operation.date || "").slice(0, 7) === month);
      const expenses = current.filter((operation) => operation.type !== "income");
      const categoryTotals = Object.fromEntries(CATEGORIES.map((category) => [category, expenses.filter((operation) => operation.category === category).reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0)]));
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const settings = data.settings || {};
      return {
        income: current.filter((operation) => operation.type === "income").reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0),
        expenses: expenses.reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0),
        daysLeft: Math.max(1, endOfMonth - date.getDate() + 1), currency: String(settings.currency || "UAH"), categoryTotals,
        categoryLimits: settings.categoryLimits || { Продукти: Number(settings.foodLimit) || 0, Одяг: Number(settings.clothesLimit) || 0 },
        credits: (Array.isArray(data.credits) ? data.credits : []).slice(0, 20).map((item) => ({ name: String(item.name || "Кредит").slice(0, 60), remaining: Number(item.remaining) || 0, payment: Number(item.payment) || 0, interestRate: Number(item.interestRate) || 0 })),
        goals: (Array.isArray(data.goals) ? data.goals : []).slice(0, 20).map((item) => ({ name: String(item.name || "Ціль").slice(0, 60), target: Number(item.target) || 0, saved: Number(item.saved) || 0 })),
      };
    } catch { return {}; }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style"); style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:16px;bottom:20px;z-index:1200;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20243a}
      #${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} [hidden]{display:none!important}
      #${ROOT_ID} .ai-toggle{border:0;border-radius:999px;background:linear-gradient(135deg,#705fe7,#8273ee);color:#fff;padding:13px 18px;font-weight:750;box-shadow:0 8px 24px #28214b35;cursor:pointer}
      #${ROOT_ID} .ai-panel{position:fixed;inset:0;z-index:1201;width:100vw;height:100dvh;max-height:100dvh;display:flex;flex-direction:column;background:#f7f8fc;border:0;border-radius:0;box-shadow:none;overflow:auto;overscroll-behavior:contain;padding:clamp(16px,4vw,32px);padding-bottom:calc(18px + env(safe-area-inset-bottom))}
      #${ROOT_ID} .ai-shell{width:100%;max-width:820px;margin:0 auto;display:flex;flex-direction:column;flex:1;min-height:0}
      #${ROOT_ID} .ai-head{display:flex;align-items:center;justify-content:space-between;padding:4px 0 18px;border-bottom:1px solid #e7e9f1}
      #${ROOT_ID} .ai-head strong{font-size:clamp(22px,5vw,30px);letter-spacing:-.04em}#${ROOT_ID} .ai-close{border:0;border-radius:50%;width:44px;height:44px;background:#fff;color:#596078;font-size:24px;cursor:pointer}
      #${ROOT_ID} .ai-subtitle{padding:18px 0 0;color:#777f96;font-size:14px}#${ROOT_ID} .ai-messages{padding:18px 0;overflow:auto;flex:1;min-height:140px;display:flex;flex-direction:column;gap:12px}
      #${ROOT_ID} .ai-message{max-width:min(760px,92%);padding:14px 16px;border-radius:18px;background:#fff;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 4px 16px #20243a09}
      #${ROOT_ID} .ai-message.user{align-self:flex-end;background:#6857df;color:#fff}#${ROOT_ID} .ai-message.error{background:#fff0f1;color:#9e3343}
      #${ROOT_ID} .ai-examples{display:flex;gap:8px;overflow:auto;padding:8px 0 12px}#${ROOT_ID} .ai-example{flex:none;border:1px solid #e4e6ef;border-radius:99px;background:white;color:#5546c5;padding:10px 14px;font-size:13px;cursor:pointer}
      #${ROOT_ID} .ai-form{display:flex;gap:10px;padding:12px 0;border-top:1px solid #e7e9f1}#${ROOT_ID} .ai-input{min-width:0;flex:1;border:1px solid #dfe1ea;border-radius:16px;padding:14px;font:inherit;color:#20243a;background:#fff}
      #${ROOT_ID} .ai-send{border:0;border-radius:15px;padding:0 20px;background:#6857df;color:#fff;font-weight:750;cursor:pointer}#${ROOT_ID} .ai-send:disabled{opacity:.55;cursor:wait}
      #${ROOT_ID} .ai-privacy{padding:0 0 8px;color:#8990a4;font-size:11px}
      @media(max-width:600px){#${ROOT_ID}{right:10px;bottom:calc(98px + env(safe-area-inset-bottom))}#${ROOT_ID} .ai-toggle{padding:12px 15px}#${ROOT_ID} .ai-panel{padding:16px 14px calc(16px + env(safe-area-inset-bottom))}#${ROOT_ID} .ai-form{gap:7px}#${ROOT_ID} .ai-input{padding:12px}#${ROOT_ID} .ai-send{padding:0 14px}#${ROOT_ID} .ai-message{max-width:96%}}
    `;
    document.head.append(style);
  }

  function addMessage(messages, text, kind = "") {
    const node = document.createElement("div"); node.className = `ai-message${kind ? ` ${kind}` : ""}`; node.textContent = text; messages.append(node); messages.scrollTop = messages.scrollHeight; return node;
  }

  async function ask(question, root) {
    const input = root.querySelector(".ai-input"), button = root.querySelector(".ai-send"), messages = root.querySelector(".ai-messages"), text = String(question || "").trim();
    if (!text) return;
    if (text.length > 500) { addMessage(messages, "Запитання має містити не більше 500 символів.", "error"); return; }
    addMessage(messages, text, "user"); input.value = ""; button.disabled = true; button.textContent = "…";
    const pending = addMessage(messages, "Готую відповідь…");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ question: text, ...budgetSummary() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) { const error = new Error(result.error || `Не вдалося отримати відповідь (${response.status}).`); error.requestId = result.requestId; throw error; }
      pending.remove(); addMessage(messages, result.answer || "AI не повернув текст відповіді.");
    } catch (error) {
      pending.remove(); addMessage(messages, `${error.message || "Не вдалося з’єднатися з AI."}${error.requestId ? ` Код запиту: ${error.requestId}.` : ""}`, "error");
    } finally { button.disabled = false; button.textContent = "Надіслати"; input.focus(); }
  }

  function init() {
    if (document.getElementById(ROOT_ID)) return;
    installStyles();
    const root = document.createElement("aside"); root.id = ROOT_ID;
    root.innerHTML = `<section class="ai-panel" aria-label="AI-помічник з бюджету" hidden><div class="ai-shell">
      <header class="ai-head"><strong>✨ Запитати пораду</strong><button class="ai-close" type="button" aria-label="Закрити">×</button></header>
      <div class="ai-subtitle">Поради щодо бюджету, витрат, кредитів і цілей</div>
      <div class="ai-messages" role="log" aria-live="polite"><div class="ai-message">Поставте запитання — відповім на основі підсумків вашого бюджету.</div></div>
      <div class="ai-examples"><button class="ai-example" type="button">Як зменшити витрати?</button><button class="ai-example" type="button">Який кредит гасити першим?</button><button class="ai-example" type="button">Як ідуть цілі?</button></div>
      <form class="ai-form"><input class="ai-input" aria-label="Ваше запитання" maxlength="500" placeholder="Ваше запитання…" required><button class="ai-send" type="submit">Надіслати</button></form>
      <div class="ai-privacy">Надсилаються лише агреговані підсумки бюджету.</div>
      </div></section><button class="ai-toggle" type="button" aria-expanded="false">✨ Запитати пораду</button>`;
    document.body.append(root);
    const panel = root.querySelector(".ai-panel"), toggle = root.querySelector(".ai-toggle"), input = root.querySelector(".ai-input");
    const close = () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; toggle.focus(); };
    toggle.addEventListener("click", () => { panel.hidden = false; toggle.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden"; input.focus(); });
    root.querySelector(".ai-close").addEventListener("click", close);
    root.querySelector(".ai-form").addEventListener("submit", (event) => { event.preventDefault(); ask(input.value, root); });
    root.querySelector(".ai-examples").addEventListener("click", (event) => { const example = event.target.closest(".ai-example"); if (example) ask(example.textContent, root); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) close(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
