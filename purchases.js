(() => {
  "use strict";

  const BUDGET_KEY = "kovalchuk-family-budget-v1";
  const PURCHASES_KEY = "kovalchuk-purchases-v1";
  const ITEMS_KEY = "kovalchuk-purchase-items-v1";
  const ROOT_ID = "detailed-purchases";
  const CATEGORIES = ["Продукти", "Транспорт", "Одяг", "Кафе", "Комуналка", "Здоров’я", "Розваги", "Дім", "Інше"];
  const money = (value) => new Intl.NumberFormat("uk-UA", {
    style: "currency", currency: "UAH", maximumFractionDigits: 2,
  }).format(Number(value) || 0);
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const readArray = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  function installStyles() {
    if (document.getElementById(`${ROOT_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${ROOT_ID}-styles`;
    style.textContent = `
      #${ROOT_ID}{position:fixed;left:16px;bottom:20px;z-index:999;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20243a}
      #${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select{font:inherit}
      #${ROOT_ID} .dp-toggle{border:0;border-radius:999px;background:#20243a;color:white;padding:12px 16px;font-weight:700;box-shadow:0 6px 20px #20243a30;cursor:pointer}
      #${ROOT_ID} .dp-panel{position:absolute;left:0;bottom:58px;width:min(440px,calc(100vw - 28px));max-height:min(78vh,720px);overflow:auto;background:#fff;border:1px solid #e9ebf2;border-radius:18px;box-shadow:0 18px 55px #20243a30;padding:16px}
      #${ROOT_ID} [hidden]{display:none!important}#${ROOT_ID} h2{font-size:19px;margin:0 0 12px}#${ROOT_ID} h3{font-size:15px;margin:18px 0 8px}
      #${ROOT_ID} .dp-form{display:grid;gap:9px}#${ROOT_ID} .dp-row{display:grid;grid-template-columns:minmax(0,1fr) 100px 36px;gap:7px;align-items:center}
      #${ROOT_ID} input,#${ROOT_ID} select{width:100%;min-width:0;border:1px solid #dfe1ea;border-radius:10px;padding:10px;background:#fff;color:#20243a}
      #${ROOT_ID} .dp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}#${ROOT_ID} .dp-actions button{border:0;border-radius:10px;background:#6857df;color:#fff;padding:10px 12px;font-weight:700;cursor:pointer}
      #${ROOT_ID} .dp-actions .secondary{background:#f0effb;color:#5546c5}#${ROOT_ID} .dp-icon{border:0;border-radius:9px;background:#f4f4f8;padding:8px;cursor:pointer}
      #${ROOT_ID} .dp-total{font-weight:750;font-size:17px;margin-top:10px}#${ROOT_ID} .dp-note{color:#777f96;font-size:12px;margin:8px 0}
      #${ROOT_ID} .dp-list{display:grid;gap:7px}#${ROOT_ID} .dp-entry{border:1px solid #eceef4;border-radius:12px;padding:10px}#${ROOT_ID} .dp-entry-head{display:flex;justify-content:space-between;gap:8px;font-weight:700}
      #${ROOT_ID} .dp-products{color:#687087;font-size:12px;margin-top:5px;overflow-wrap:anywhere}#${ROOT_ID} .dp-top{display:grid;gap:6px;list-style:none;padding:0;margin:0}
      #${ROOT_ID} .dp-top li{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #f0f1f5;padding:7px 0}
      #${ROOT_ID} .dp-receipt{border:1px dashed #c9c5e9;border-radius:12px;padding:10px}#${ROOT_ID} .dp-preview{display:block;max-width:100%;max-height:180px;margin-top:8px;border-radius:8px}
      @media(max-width:600px){#${ROOT_ID}{left:10px;bottom:calc(88px + env(safe-area-inset-bottom))}#${ROOT_ID} .dp-panel{left:0;bottom:56px;width:calc(100vw - 20px);max-height:72vh;padding:13px}#${ROOT_ID} .dp-row{grid-template-columns:minmax(0,1fr) 82px 34px}}
    `;
    document.head.append(style);
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    installStyles();
    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `<section class="dp-panel" aria-label="Детальні покупки" hidden>
      <h2>🛒 Детальні покупки</h2>
      <form class="dp-form" id="dp-form">
        <label>Магазин або назва операції<input name="merchant" maxlength="80" placeholder="Наприклад, Сільпо" required></label>
        <label>Категорія<select name="category">${CATEGORIES.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select></label>
        <label>Дата<input name="date" type="date" required></label>
        <div><strong>Товари</strong><div class="dp-rows"></div></div>
        <div class="dp-total">Разом: <span class="dp-total-value">0 ₴</span></div>
        <div class="dp-actions"><button class="dp-add-row secondary" type="button">＋ Додати товар</button><button type="submit">Зберегти покупку</button></div>
      </form>
      <h3>Фото чека</h3>
      <div class="dp-receipt"><label>Завантажити фото<input class="dp-receipt-file" type="file" accept="image/*" capture="environment"></label><img class="dp-preview" alt="Попередній перегляд чека" hidden><p class="dp-note">Фото можна переглянути тут. Автоматичне розпізнавання чека ще не підключене — додайте товари вручну.</p></div>
      <h3>Топ товарів цього місяця</h3><ol class="dp-top"></ol>
      <h3>Останні покупки</h3><div class="dp-list"></div>
      <p class="dp-note">Деталі покупок зберігаються у цьому браузері. Одна покупка також додається до загальних операцій бюджету.</p>
      </section><button class="dp-toggle" type="button" aria-expanded="false">🛒 Покупки</button>`;
    document.body.append(root);
    const panel = root.querySelector(".dp-panel");
    const form = root.querySelector("#dp-form");
    const rows = root.querySelector(".dp-rows");
    const addRow = () => {
      const row = document.createElement("div");
      row.className = "dp-row";
      row.innerHTML = '<input name="itemName" maxlength="80" placeholder="Назва товару" required><input name="itemPrice" type="number" min="0.01" max="100000000" step="0.01" inputmode="decimal" placeholder="Ціна" required><button class="dp-icon" type="button" aria-label="Видалити товар">×</button>';
      row.querySelector("button").addEventListener("click", () => {
        if (rows.children.length > 1) row.remove();
        updateTotal();
      });
      row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateTotal));
      rows.append(row);
      return row;
    };
    const updateTotal = () => {
      const total = [...rows.querySelectorAll('[name="itemPrice"]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      root.querySelector(".dp-total-value").textContent = money(total);
    };
    const renderHistory = () => {
      const month = new Date().toISOString().slice(0, 7);
      const purchases = readArray(PURCHASES_KEY).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const itemRecords = readArray(ITEMS_KEY);
      const totals = new Map();
      for (const purchase of purchases) {
        if (String(purchase.date || "").slice(0, 7) !== month) continue;
        for (const item of purchase.items || []) {
          const name = String(item.name || "").trim();
          if (name) totals.set(name, (totals.get(name) || 0) + (Number(item.price) || 0));
        }
      }
      const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 10);
      root.querySelector(".dp-top").innerHTML = top.length
        ? top.map(([name, total]) => `<li><span>${escapeHtml(name)}</span><strong>${money(total)}</strong></li>`).join("")
        : '<li class="dp-note">Цього місяця ще немає товарів.</li>';
      root.querySelector(".dp-list").innerHTML = purchases.length
        ? purchases.slice(0, 8).map((purchase) => `<article class="dp-entry"><div class="dp-entry-head"><span>${escapeHtml(purchase.merchant)} · ${escapeHtml(purchase.date)}</span><span>${money(purchase.total)}</span></div><div class="dp-products">${(purchase.items || []).map((item) => `${escapeHtml(item.name)} — ${money(item.price)}`).join(" · ")}</div></article>`).join("")
        : '<p class="dp-note">Покупок поки немає.</p>';
      // Remove any orphaned detail rows created by interrupted browser writes.
      const itemIds = new Set(purchases.flatMap((purchase) => (purchase.items || []).map((item) => item.id)));
      if (itemRecords.length && itemRecords.some((item) => !itemIds.has(item.id))) {
        localStorage.setItem(ITEMS_KEY, JSON.stringify(itemRecords.filter((item) => itemIds.has(item.id))));
      }
    };

    root.querySelector(".dp-toggle").addEventListener("click", (event) => {
      panel.hidden = !panel.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    });
    root.querySelector(".dp-add-row").addEventListener("click", addRow);
    root.querySelector(".dp-receipt-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      const preview = root.querySelector(".dp-preview");
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        window.alert("Будь ласка, виберіть файл зображення.");
        event.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        preview.src = String(reader.result || "");
        preview.hidden = !preview.src;
      };
      reader.readAsDataURL(file);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const items = [...rows.querySelectorAll(".dp-row")].map((row) => ({
        id: id(), name: row.querySelector('[name="itemName"]').value.trim(), price: Number(row.querySelector('[name="itemPrice"]').value),
      }));
      if (!items.length || items.some((item) => !item.name || !Number.isFinite(item.price) || item.price <= 0)) {
        window.alert("Перевірте назви та ціни товарів.");
        return;
      }
      const data = new FormData(form);
      const total = Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100;
      const merchant = String(data.get("merchant") || "Покупка").trim().slice(0, 80);
      const date = String(data.get("date") || new Date().toISOString().slice(0, 10));
      const purchaseId = id();
      const purchase = { id: purchaseId, merchant, category: String(data.get("category") || "Продукти"), date, total, items, createdAt: new Date().toISOString() };
      try {
        const purchases = readArray(PURCHASES_KEY);
        purchases.push(purchase);
        localStorage.setItem(PURCHASES_KEY, JSON.stringify(purchases));
        const detailRows = readArray(ITEMS_KEY);
        localStorage.setItem(ITEMS_KEY, JSON.stringify([...detailRows, ...items.map((item) => ({ ...item, purchaseId, date, merchant, category: purchase.category }))]));

        // Mirror the grouped purchase into the existing budget operation ledger.
        const budget = JSON.parse(localStorage.getItem(BUDGET_KEY) || "{}");
        if (budget && typeof budget === "object" && !Array.isArray(budget)) {
          budget.operations = Array.isArray(budget.operations) ? budget.operations : [];
          budget.operations.push({
            id: purchaseId, type: "expense", amount: total, category: purchase.category, date,
            description: `${merchant} (${items.length} товар${items.length === 1 ? "" : "и"})`, source: "detailed-purchase", purchaseId,
          });
          localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
        }
        renderHistory();
        rows.innerHTML = "";
        addRow();
        form.reset();
        form.elements.date.value = new Date().toISOString().slice(0, 10);
        updateTotal();
        window.dispatchEvent(new CustomEvent("budget:updated", { detail: { purchaseId, amount: total } }));
        window.alert(`Покупку збережено: ${money(total)}. Вона додана до операцій бюджету.`);
      } catch (error) {
        console.error("Could not save detailed purchase", error);
        window.alert("Не вдалося зберегти покупку. Перевірте, чи доступне сховище браузера.");
      }
    });

    addRow();
    form.elements.date.value = new Date().toISOString().slice(0, 10);
    renderHistory();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
