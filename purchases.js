(() => {
  "use strict";

  const BUDGET_KEY = "kovalchuk-family-budget-v1";
  const PURCHASES_KEY = "kovalchuk-purchases-v1";
  const ITEMS_KEY = "kovalchuk-purchase-items-v1";
  const ROOT_ID = "detailed-purchases";
  const CATEGORIES = ["Продукти", "Транспорт", "Одяг", "Кафе", "Комуналка", "Здоров’я", "Розваги", "Дім", "Інше"];
  const money = (value) => new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 2 }).format(Number(value) || 0);
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const readArray = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

  function installStyles() {
    if (document.getElementById(`${ROOT_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${ROOT_ID}-styles`;
    style.textContent = `
      #${ROOT_ID}{position:fixed;left:16px;bottom:20px;z-index:1100;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20243a}
      #${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select{font:inherit}
      #${ROOT_ID} .dp-toggle{border:0;border-radius:999px;background:#20243a;color:white;padding:13px 19px;font-weight:750;box-shadow:0 8px 26px #20243a25;cursor:pointer}
      #${ROOT_ID} .dp-panel{position:fixed;inset:0;z-index:1101;width:100vw;height:100dvh;max-height:100dvh;overflow:auto;overscroll-behavior:contain;background:#f7f8fc;padding:clamp(18px,4vw,36px);padding-bottom:calc(32px + env(safe-area-inset-bottom));border:0;border-radius:0;box-shadow:none}
      #${ROOT_ID} [hidden]{display:none!important}#${ROOT_ID} .dp-shell{max-width:760px;margin:0 auto}#${ROOT_ID} .dp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 auto 24px;max-width:760px}
      #${ROOT_ID} h2{font-size:clamp(24px,5vw,34px);letter-spacing:-.04em;margin:0}#${ROOT_ID} h3{font-size:18px;letter-spacing:-.02em;margin:26px 0 12px}
      #${ROOT_ID} .dp-close{border:0;border-radius:50%;width:44px;height:44px;background:white;color:#313650;font-size:24px;cursor:pointer}
      #${ROOT_ID} .dp-card{background:#fff;border:1px solid #eceef4;border-radius:20px;padding:18px;margin-bottom:14px;box-shadow:0 8px 28px #20243a08}
      #${ROOT_ID} .dp-form{display:grid;gap:13px}#${ROOT_ID} .dp-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 40px;gap:8px;align-items:center;margin-top:8px}
      #${ROOT_ID} input,#${ROOT_ID} select{width:100%;min-width:0;border:1px solid #e1e4ed;border-radius:13px;padding:12px 13px;background:#fff;color:#20243a;min-height:48px}
      #${ROOT_ID} .dp-label{display:grid;gap:7px;color:#687087;font-size:13px;font-weight:650}#${ROOT_ID} .dp-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:4px}
      #${ROOT_ID} .dp-actions button{border:0;border-radius:13px;background:#6857df;color:#fff;padding:13px 16px;font-weight:750;cursor:pointer;min-height:48px}
      #${ROOT_ID} .dp-actions .secondary{background:#f0effb;color:#5546c5}#${ROOT_ID} .dp-icon{border:0;border-radius:11px;background:#f1f2f7;padding:9px;min-height:42px;cursor:pointer}
      #${ROOT_ID} .dp-total{font-weight:800;font-size:20px;margin-top:2px}#${ROOT_ID} .dp-status{min-height:20px;margin:8px 0 0;color:#687087;font-size:13px}#${ROOT_ID} .dp-status.error{color:#b4233b}
      #${ROOT_ID} .dp-list{display:grid;gap:9px}#${ROOT_ID} .dp-entry{background:#fff;border:1px solid #eceef4;border-radius:16px;padding:14px}#${ROOT_ID} .dp-entry-head{display:flex;justify-content:space-between;gap:8px;font-weight:750}
      #${ROOT_ID} .dp-products{color:#687087;font-size:13px;margin-top:6px;overflow-wrap:anywhere}#${ROOT_ID} .dp-top{display:grid;gap:5px;list-style:none;padding:0;margin:0}
      #${ROOT_ID} .dp-top li{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #f0f1f5;padding:10px 0}#${ROOT_ID} .dp-receipt{display:grid;gap:10px}
      #${ROOT_ID} .dp-preview{display:block;max-width:100%;max-height:240px;margin-top:10px;border-radius:12px}#${ROOT_ID} .dp-note{color:#777f96;font-size:12px;margin:0}
      @media(max-width:600px){#${ROOT_ID}{left:10px;bottom:calc(98px + env(safe-area-inset-bottom))}#${ROOT_ID} .dp-toggle{padding:12px 16px}#${ROOT_ID} .dp-panel{padding:18px 14px calc(24px + env(safe-area-inset-bottom))}#${ROOT_ID} .dp-row{grid-template-columns:minmax(0,1fr) 92px 38px}#${ROOT_ID} .dp-card{padding:14px;border-radius:17px}}
    `;
    document.head.append(style);
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    installStyles();
    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `<section class="dp-panel" aria-label="Детальні покупки" hidden>
      <header class="dp-head"><h2>Покупки</h2><button class="dp-close" type="button" aria-label="Закрити">×</button></header>
      <div class="dp-shell">
        <article class="dp-card"><form class="dp-form" id="dp-form">
          <label class="dp-label">Магазин<input name="merchant" maxlength="80" placeholder="Наприклад, Сільпо" required></label>
          <label class="dp-label">Категорія<select name="category">${CATEGORIES.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select></label>
          <label class="dp-label">Дата<input name="date" type="date" required></label>
          <div><strong>Товари</strong><div class="dp-rows"></div></div>
          <div class="dp-total">Разом: <span class="dp-total-value">0 ₴</span></div>
          <div class="dp-actions"><button class="dp-add-row secondary" type="button">＋ Товар</button><button type="submit">Зберегти покупку</button></div>
        </form></article>
        <article class="dp-card"><h3>Фото чека</h3><div class="dp-receipt"><input class="dp-receipt-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Завантажити фото чека"><img class="dp-preview" alt="Попередній перегляд чека" hidden><p class="dp-status" aria-live="polite"></p></div></article>
        <h3>Топ товарів за місяць</h3><article class="dp-card"><ol class="dp-top"></ol></article>
        <h3>Останні покупки</h3><div class="dp-list"></div>
      </div>
      </section><button class="dp-toggle" type="button" aria-expanded="false">🛒 Покупки</button>`;
    document.body.append(root);
    const panel = root.querySelector(".dp-panel");
    const form = root.querySelector("#dp-form");
    const rows = root.querySelector(".dp-rows");
    const status = root.querySelector(".dp-status");

    const updateTotal = () => {
      const total = [...rows.querySelectorAll('[name="itemPrice"]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      root.querySelector(".dp-total-value").textContent = money(total);
    };
    const addRow = (item = {}) => {
      const row = document.createElement("div");
      row.className = "dp-row";
      row.innerHTML = '<input name="itemName" maxlength="80" placeholder="Назва товару" required><input name="itemPrice" type="number" min="0.01" max="100000000" step="0.01" inputmode="decimal" placeholder="Ціна" required><button class="dp-icon" type="button" aria-label="Видалити товар">×</button>';
      row.querySelector('[name="itemName"]').value = String(item.name || "");
      row.querySelector('[name="itemPrice"]').value = item.price == null ? "" : String(item.price);
      row.querySelector("button").addEventListener("click", () => { if (rows.children.length > 1) row.remove(); updateTotal(); });
      row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateTotal));
      rows.append(row);
      updateTotal();
    };
    const renderHistory = () => {
      const month = today().slice(0, 7);
      const purchases = readArray(PURCHASES_KEY).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const totals = new Map();
      for (const purchase of purchases) if (String(purchase.date || "").slice(0, 7) === month) {
        for (const item of purchase.items || []) {
          const name = String(item.name || "").trim();
          const key = name.toLocaleLowerCase("uk-UA");
          if (key) totals.set(key, { name, total: (totals.get(key)?.total || 0) + (Number(item.price) || 0) });
        }
      }
      const top = [...totals.values()].sort((a, b) => b.total - a.total).slice(0, 10);
      root.querySelector(".dp-top").innerHTML = top.length
        ? top.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${money(item.total)}</strong></li>`).join("")
        : "<li>Поки немає товарів за цей місяць.</li>";
      root.querySelector(".dp-list").innerHTML = purchases.length
        ? purchases.slice(0, 10).map((purchase) => `<article class="dp-entry"><div class="dp-entry-head"><span>${escapeHtml(purchase.merchant)} · ${escapeHtml(purchase.date)}</span><span>${money(purchase.total)}</span></div><div class="dp-products">${(purchase.items || []).map((item) => `${escapeHtml(item.name)} — ${money(item.price)}`).join(" · ")}</div></article>`).join("")
        : "<article class=\"dp-entry\">Покупок поки немає.</article>";
    };

    const togglePanel = (open) => {
      panel.hidden = !open;
      root.querySelector(".dp-toggle").setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };
    root.querySelector(".dp-toggle").addEventListener("click", () => togglePanel(panel.hidden));
    root.querySelector(".dp-close").addEventListener("click", () => togglePanel(false));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) togglePanel(false); });
    root.querySelector(".dp-add-row").addEventListener("click", () => addRow());

    root.querySelector(".dp-receipt-file").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      const preview = root.querySelector(".dp-preview");
      status.classList.remove("error");
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { status.textContent = "Виберіть фото у форматі JPEG, PNG або WebP."; status.classList.add("error"); return; }
      if (file.size > 5 * 1024 * 1024) { status.textContent = "Фото має бути до 5 МБ."; status.classList.add("error"); return; }
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      status.textContent = "Розпізнаємо товари…";
      try {
        const body = new FormData();
        body.append("image", file, file.name);
        const response = await fetch("/api/receipt", { method: "POST", body, cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok !== true) throw new Error(result.error || `Не вдалося розпізнати чек (${response.status}).`);
        rows.innerHTML = "";
        result.items.forEach((item) => addRow(item));
        if (result.merchant) form.elements.merchant.value = result.merchant;
        if (result.date) form.elements.date.value = result.date;
        status.textContent = `Розпізнано ${result.items.length} товарів. Перевірте й відредагуйте список перед збереженням.`;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        status.textContent = `${error.message || "Не вдалося розпізнати чек."} Можна ввести товари вручну.`;
        status.classList.add("error");
        if (!rows.children.length) addRow();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const items = [...rows.querySelectorAll(".dp-row")].map((row) => ({
        id: id(), name: row.querySelector('[name="itemName"]').value.trim(), price: Number(row.querySelector('[name="itemPrice"]').value),
      }));
      if (!items.length || items.some((item) => !item.name || !Number.isFinite(item.price) || item.price <= 0)) {
        status.textContent = "Перевірте назви та ціни товарів."; status.classList.add("error"); return;
      }
      const values = new FormData(form);
      const total = Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100;
      const merchant = String(values.get("merchant") || "Покупка").trim().slice(0, 80);
      const date = String(values.get("date") || today());
      const purchaseId = id();
      const purchase = { id: purchaseId, merchant, category: String(values.get("category") || "Продукти"), date, total, items, createdAt: new Date().toISOString() };
      try {
        const purchases = readArray(PURCHASES_KEY);
        purchases.push(purchase);
        localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases));
        const detailRows = readArray(ITEMS_KEY);
        localStorage.setItem(ITEMS_KEY, JSON.stringify([...detailRows, ...items.map((item) => ({ ...item, purchaseId, date, merchant, category: purchase.category }))]));
        const budget = JSON.parse(localStorage.getItem(BUDGET_KEY) || "{}");
        if (budget && typeof budget === "object" && !Array.isArray(budget)) {
          budget.operations = Array.isArray(budget.operations) ? budget.operations : [];
          budget.operations.push({ id: purchaseId, type: "expense", amount: total, category: purchase.category, date, description: `${merchant} (${items.length} товарів)`, source: "detailed-purchase", purchaseId });
          localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
        }
        renderHistory();
        rows.innerHTML = ""; addRow(); form.reset(); form.elements.date.value = today();
        status.textContent = `Покупку збережено · ${money(total)}`; status.classList.remove("error");
        window.dispatchEvent(new CustomEvent("budget:updated", { detail: { purchaseId, amount: total } }));
      } catch (error) {
        console.error("Could not save detailed purchase", error);
        status.textContent = "Не вдалося зберегти покупку. Перевірте, чи доступне сховище браузера."; status.classList.add("error");
      }
    });

    addRow(); form.elements.date.value = today(); renderHistory();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
