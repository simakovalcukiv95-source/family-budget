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
      const categoryTotals = Object.fromEntries(CATEGORIES.map((category) => [
        category,
        expenses.filter((operation) => operation.category === category)
          .reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0),
      ]));
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const settings = data.settings || {};
      return {
        income: current.filter((operation) => operation.type === "income")
          .reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0),
        expenses: expenses.reduce((sum, operation) => sum + (Number(operation.amount) || 0), 0),
        daysLeft: Math.max(1, endOfMonth - date.getDate() + 1),
        currency: String(settings.currency || "UAH"),
        categoryTotals,
        categoryLimits: settings.categoryLimits || {
          Продукти: Number(settings.foodLimit) || 0,
          Одяг: Number(settings.clothesLimit) || 0,
        },
        credits: (Array.isArray(data.credits) ? data.credits : []).slice(0, 20).map((item) => ({
          name: String(item.name || "Кредит").slice(0, 60),
          remaining: Number(item.remaining) || 0,
          payment: Number(item.payment) || 0,
          interestRate: Number(item.interestRate) || 0,
        })),
        goals: (Array.isArray(data.goals) ? data.goals : []).slice(0, 20).map((item) => ({
          name: String(item.name || "Ціль").slice(0, 60),
          target: Number(item.target) || 0,
          saved: Number(item.saved) || 0,
        })),
      };
    } catch {
      return {};
    }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:16px;bottom:20px;z-index:1000;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20243a}
      #${ROOT_ID} *{box-sizing:border-box}
      #${ROOT_ID} .ai-toggle{border:0;border-radius:999px;background:linear-gradient(135deg,#705fe7,#8273ee);color:#fff;padding:12px 17px;font-weight:750;box-shadow:0 8px 24px #28214b35;cursor:pointer}
      #${ROOT_ID} .ai-panel{position:absolute;right:0;bottom:62px;width:min(380px,calc(100vw - 28px));max-height:min(75vh,620px);display:flex;flex-direction:column;background:#fff;border:1px solid #e9ebf2;border-radius:20px;box-shadow:0 18px 55px #20243a30;overflow:hidden}
      #${ROOT_ID} [hidden]{display:none!important}
      #${ROOT_ID} .ai-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8f7ff;border-bottom:1px solid #eeeafc}
      #${ROOT_ID} .ai-close{border:0;background:transparent;color:#777f96;font-size:23px;cursor:pointer;padding:0 5px}
      #${ROOT_ID} .ai-subtitle{padding:10px 16px 0;color:#777f96;font-size:12px}
      #${ROOT_ID} .ai-messages{padding:12px 16px;overflow:auto;min-height:84px;max-height:28vh;display:flex;flex-direction:column;gap:9px}
      #${ROOT_ID} .ai-message{padding:10px 12px;border-radius:13px;background:#f3f1ff;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
      #${ROOT_ID} .ai-message.user{align-self:flex-end;background:#6857df;color:#fff;max-width:90%}
      #${ROOT_ID} .ai-message.error{background:#fff0f1;color:#9e3343}
      #${ROOT_ID} .ai-examples{display:flex;gap:6px;overflow:auto;padding:0 14px 10px}
      #${ROOT_ID} .ai-example{flex:none;border:1px solid #e9ebf2;border-radius:99px;background:white;color:#5546c5;padding:6px 9px;font-size:11px;cursor:pointer}
      #${ROOT_ID} .ai-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e9ebf2}
      #${ROOT_ID} .ai-input{min-width:0;flex:1;border:1px solid #e1e3ed;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;color:#20243a}
      #${ROOT_ID} .ai-send{border:0;border-radius:12px;padding:0 14px;background:#6857df;color:#fff;font-weight:750;cursor:pointer}
      #${ROOT_ID} .ai-send:disabled{opacity:.55;cursor:wait}
      #${ROOT_ID} .ai-privacy{padding:0 14px 10px;color:#777f96;font-size:10px}
      @media(max-width:600px){#${ROOT_ID}{right:12px;bottom:calc(82px + env(safe-area-inset-bottom))}#${ROOT_ID} .ai-panel{right:-2px;bottom:58px;width:min(380px,calc(100vw - 24px));max-height:70vh}#${ROOT_ID} .ai-messages{max-height:24vh}}
    `;
    document.head.append(style);
  }

  function addMessage(messages, text, kind = "") {
    const node = document.createElement("div");
    node.className = `ai-message${kind ? ` ${kind}` : ""}`;
    node.textContent = text;
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }

  async function ask(question, root) {
    const input = root.querySelector(".ai-input");
    const button = root.querySelector(".ai-send");
    const messages = root.querySelector(".ai-messages");
    const text = String(question || "").trim();
    if (!text) return;
    if (text.length > 500) {
      addMessage(messages, "Запитання має містити не більше 500 символів.", "error");
      return;
    }

    addMessage(messages, text, "user");
    input.value = "";
    button.disabled = true;
    button.textContent = "…";
    const pending = addMessage(messages, "AI аналізує підсумки бюджету…");
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ question: text, ...budgetSummary() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        const error = new Error(result.error || `Не вдалося отримати відповідь (HTTP ${response.status}).`);
        error.requestId = result.requestId;
        throw error;
      }
      pending.remove();
      addMessage(messages, result.answer || "AI не повернув текст відповіді.");
    } catch (error) {
      pending.remove();
      const requestRef = error.requestId ? ` Код запиту: ${error.requestId}.` : "";
      addMessage(messages, `${error.message || "Не вдалося з’єднатися з AI."}${requestRef}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Надіслати";
      input.focus();
    }
  }

  function init() {
    if (document.getElementById(ROOT_ID)) return;
    installStyles();
    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `<section class="ai-panel" aria-label="AI-помічник з бюджету" hidden>
      <header class="ai-head"><strong>✨ Запитати пораду · Workers AI</strong><button class="ai-close" type="button" aria-label="Закрити">×</button></header>
      <div class="ai-subtitle">Поставте питання про бюджет, витрати, кредити або цілі</div>
      <div class="ai-messages" role="log" aria-live="polite"><div class="ai-message">Поставте питання — помічник відповість на основі підсумків вашого бюджету.</div></div>
      <div class="ai-examples"><button class="ai-example" type="button">Як зменшити витрати?</button><button class="ai-example" type="button">Який кредит гасити першим?</button><button class="ai-example" type="button">Як ідуть цілі?</button></div>
      <form class="ai-form"><input class="ai-input" aria-label="Ваше запитання" maxlength="500" placeholder="Ваше запитання…" required><button class="ai-send" type="submit">Надіслати</button></form>
      <div class="ai-privacy">Надсилаються лише агреговані підсумки бюджету — без описів операцій і токена Monobank.</div>
    </section><button class="ai-toggle" type="button" aria-expanded="false">✨ Запитати пораду</button>`;
    document.body.append(root);

    const panel = root.querySelector(".ai-panel");
    const toggle = root.querySelector(".ai-toggle");
    const input = root.querySelector(".ai-input");
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) input.focus();
    });
    root.querySelector(".ai-close").addEventListener("click", () => {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    });
    root.querySelector(".ai-form").addEventListener("submit", (event) => {
      event.preventDefault();
      ask(input.value, root);
    });
    root.querySelector(".ai-examples").addEventListener("click", (event) => {
      const example = event.target.closest(".ai-example");
      if (example) ask(example.textContent, root);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
