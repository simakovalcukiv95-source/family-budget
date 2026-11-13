(() => {
  "use strict";
  const KEY = "kovalchuk-family-budget-v1";
  const PURCHASES = "kovalchuk-purchases-v1";
  const ITEMS = "kovalchuk-purchase-items-v1";
  const ID = "budget-polish";
  const CATEGORIES = ["Продукти", "Транспорт", "Одяг", "Кафе", "Комуналка", "Здоров’я", "Розваги", "Дім", "Інше"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = (amount) => {
    const currency = read()?.settings?.currency || "UAH";
    try { return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount) || 0); }
    catch { return `${Math.round(Number(amount) || 0)} ₴`; }
  };
  function read() {
    try { const data = JSON.parse(localStorage.getItem(KEY) || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; }
    catch { return {}; }
  }
  function persist(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent("budget:updated", { detail: { source: ID } }));
    try { window.BudgetApp?.render?.(); window.BudgetApp?.refresh?.(); } catch { /* Optional app hooks. */ }
  }
  function dateValue(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function ensureStyles() {
    if ($(`#${ID}-style`)) return;
    const style = document.createElement("style"); style.id = `${ID}-style`;
    style.textContent = `
      #${ID}{margin:0 0 16px}#${ID} *{box-sizing:border-box}#${ID} .bp-hero{position:relative;overflow:hidden;border:0;border-radius:26px;padding:26px;background:linear-gradient(135deg,#242944,#383c62);color:#fff;box-shadow:0 18px 42px #20243a20}
      #${ID} .bp-kicker{opacity:.76;font-size:14px;font-weight:650}#${ID} .bp-amount{font-size:clamp(38px,9vw,58px);letter-spacing:-.055em;font-weight:800;line-height:1.08;margin:9px 0 8px;overflow-wrap:anywhere}
      #${ID} .bp-caption{font-size:13px;opacity:.76}.bp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
      #${ID} .bp-card{background:#fff;border:1px solid #eceef4;border-radius:20px;padding:17px;box-shadow:0 8px 26px #20243a08}#${ID} h3{margin:0 0 13px;font-size:16px;letter-spacing:-.02em}
      #${ID} .bp-cat{margin:12px 0}.bp-catline{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:6px}.bp-track{height:8px;background:#f0eff7;border-radius:99px;overflow:hidden}.bp-fill{height:100%;border-radius:99px;background:#7161e8}
      #${ID} .bp-tip{display:flex;gap:9px;padding:9px 0;border-top:1px solid #f0f1f5;color:#535b72;font-size:13px}#${ID} .bp-tip:first-of-type{border-top:0;padding-top:0}
      #${ID} .bp-goal{padding:10px 0;border-top:1px solid #f0f1f5}.bp-goal:first-of-type{border-top:0;padding-top:0}.bp-goal-head{display:flex;justify-content:space-between;gap:8px;font-size:13px}.bp-goal-actions{display:flex;gap:6px;margin-top:8px}.bp-goal-actions button,#${ID} .bp-danger{border:0;border-radius:10px;background:#f0effb;color:#5546c5;padding:8px 11px;font-weight:700;cursor:pointer}
      #${ID} .bp-progress{height:7px;background:#f0eff7;border-radius:99px;overflow:hidden;margin-top:7px}.bp-progress span{display:block;height:100%;background:#21a17a;border-radius:99px}
      #${ID} .bp-settings{display:flex;align-items:end;gap:9px;flex-wrap:wrap}.bp-settings label{display:grid;gap:5px;font-size:12px;color:#777f96}.bp-settings input{min-height:42px;border:1px solid #dfe1ea;border-radius:10px;padding:8px 10px;font:inherit;color:#20243a}
      #${ID} .bp-danger{background:#fff0f1;color:#a52c3b;min-height:42px}.bp-muted{color:#777f96;font-size:12px}
      @media(max-width:600px){#${ID} .bp-hero{padding:22px;border-radius:22px}#${ID} .bp-grid{grid-template-columns:1fr;gap:10px}#${ID} .bp-card{padding:15px;border-radius:17px}}
      @media(max-width:680px){.tabs{min-height:88px!important;padding:12px 8px calc(12px + env(safe-area-inset-bottom))!important;gap:4px!important}.tabs .tab{min-height:56px!important;padding:0 13px!important;border-radius:17px!important;font-weight:750!important}}
    `;
    document.head.append(style);
  }
  function startOfMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`; }
  function buildDashboard() {
    const data = read();
    const operations = Array.isArray(data.operations) ? data.operations : [];
    const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
    const from = settings.countFrom || startOfMonth();
    const today = dateValue(new Date());
    const period = operations.filter((op) => String(op.date || "") >= from && String(op.date || "") <= today);
    const isTransfer = (op) => op.type === "transfer" || op.type === "internal-transfer" || op.internalTransfer === true || op.isTransfer === true;
    const isCreditPayment = (op) => op.type === "credit-payment" || op.type === "loan-payment" || op.isCreditPayment === true;
    const income = period.filter((op) => op.type === "income" && !isTransfer(op)).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
    const expenses = period.filter((op) => op.type !== "income" && !isTransfer(op) && !isCreditPayment(op)).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
    const creditPaid = period.filter(isCreditPayment).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
    const available = income - expenses - creditPaid;
    const spent = new Map(CATEGORIES.map((category) => [category, 0]));
    for (const op of period) if (op.type !== "income" && !isTransfer(op) && !isCreditPayment(op)) {
      const category = CATEGORIES.includes(op.category) ? op.category : "Інше";
      spent.set(category, spent.get(category) + (Number(op.amount) || 0));
    }
    const limits = settings.categoryLimits && typeof settings.categoryLimits === "object" ? settings.categoryLimits : {};
    const topCategories = [...spent].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const daysLeft = Math.max(1, Math.ceil((new Date(`${today}T12:00:00`) - new Date(`${today.slice(0, 7)}-01T12:00:00`)) / 86400000));
    const daily = available > 0 ? available / Math.max(1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate() + 1) : 0;
    const formatCategory = ([category, amount]) => {
      const limit = Number(limits[category]) || 0;
      const percent = limit > 0 ? Math.min(100, amount / limit * 100) : Math.min(100, amount / Math.max(1, expenses) * 100);
      return `<div class="bp-cat"><div class="bp-catline"><span>${category}</span><strong>${money(amount)}${limit > 0 ? ` / ${money(limit)}` : ""}</strong></div><div class="bp-track"><div class="bp-fill" style="width:${percent}%"></div></div></div>`;
    };
    const tips = [];
    if (available < 0) tips.push("Витрати перевищили доходи за вибраний період — перегляньте необов’язкові покупки.");
    else if (daily > 0) tips.push(`Орієнтир на день до кінця місяця — близько ${money(daily)}.`);
    if (topCategories[0]) tips.push(`Найбільше витрачено на «${topCategories[0][0]}» — ${money(topCategories[0][1])}.`);
    const goals = Array.isArray(data.goals) ? data.goals : [];
    return `<article class="bp-hero"><div class="bp-kicker">Можна витратити</div><div class="bp-amount">${money(available)}</div><div class="bp-caption">За період від ${from} · дохід мінус витрати та оплати кредитів</div></article>
      <div class="bp-grid"><article class="bp-card"><h3>Витрати за категоріями</h3>${topCategories.length ? topCategories.map(formatCategory).join("") : '<div class="bp-muted">Додайте операції, щоб побачити прогрес категорій.</div>'}</article>
      <article class="bp-card"><h3>Коротко</h3>${tips.length ? tips.map((tip) => `<div class="bp-tip"><span>✦</span><span>${tip}</span></div>`).join("") : '<div class="bp-muted">Поки немає підказок.</div>'}</article></div>
      ${goals.length ? `<article class="bp-card" style="margin-top:12px"><h3>Цілі</h3>${goals.map((goal, index) => { const target = Number(goal.target) || 0; const saved = Number(goal.saved) || 0; const percent = target > 0 ? Math.min(100, saved / target * 100) : 0; return `<div class="bp-goal"><div class="bp-goal-head"><strong>${String(goal.name || "Ціль").replace(/[&<>"']/g, "")}</strong><span>${money(saved)} / ${money(target)}</span></div><div class="bp-progress"><span style="width:${percent}%"></span></div><div class="bp-goal-actions"><button type="button" data-bp-save="${index}" data-amount="100">+100 ₴</button><button type="button" data-bp-save="${index}" data-amount="500">+500 ₴</button></div></div>`; }).join("")}</article>` : ""}`;
  }
  function mount() {
    if ($(`#${ID}`)) return;
    ensureStyles();
    const home = $("#view-home");
    if (!home) return;
    const section = document.createElement("section"); section.id = ID;
    home.prepend(section);
    const refresh = () => { if (!document.getElementById(ID)) return; section.innerHTML = `${buildDashboard()}<article class="bp-card" style="margin-top:12px"><h3>Період і дані</h3><div class="bp-settings"><label>Рахувати з<input type="date" class="bp-count-from"></label><button class="bp-danger" type="button" data-bp-clear>Очистити операції</button></div></article>`; section.querySelector(".bp-count-from").value = read()?.settings?.countFrom || startOfMonth(); };
    refresh();
    section.addEventListener("change", (event) => {
      if (!event.target.matches(".bp-count-from")) return;
      const data = read(); data.settings = { ...(data.settings || {}), countFrom: event.target.value || startOfMonth() }; persist(data); refresh();
    });
    section.addEventListener("click", (event) => {
      const save = event.target.closest("[data-bp-save]");
      if (save) {
        const data = read(); const goal = data.goals?.[Number(save.dataset.bpSave)]; if (!goal) return;
        const amount = Number(save.dataset.amount) || 0; goal.saved = (Number(goal.saved) || 0) + amount; persist(data); refresh(); return;
      }
      if (event.target.closest("[data-bp-clear]")) {
        if (!window.confirm("Видалити всі операції бюджету та покупки з цього браузера? Кредити й цілі залишаться. Цю дію не можна скасувати.")) return;
        try {
          const data = read(); data.operations = []; persist(data);
          localStorage.setItem(PURCHASES, "[]"); localStorage.setItem(ITEMS, "[]");
          refresh(); window.dispatchEvent(new CustomEvent("budget:updated", { detail: { source: ID, cleared: true } }));
        } catch { window.alert("Не вдалося очистити дані браузера."); }
      }
    });
    window.addEventListener("budget:updated", refresh);
    const observer = new MutationObserver(() => { if (!document.getElementById(ID) && document.getElementById("view-home")) mount(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})();
