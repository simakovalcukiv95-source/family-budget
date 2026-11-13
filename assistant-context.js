(() => {
  "use strict";
  const KEY = "kovalchuk-family-budget-v1";
  const PURCHASES = "kovalchuk-purchases-v1";
  const ITEMS = "kovalchuk-purchase-items-v1";
  const CATEGORIES = ["Продукти", "Транспорт", "Одяг", "Кафе", "Комуналка", "Здоров’я", "Розваги", "Дім", "Інше"];
  function context() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "{}");
      const purchases = JSON.parse(localStorage.getItem(PURCHASES) || "[]");
      const settings = data.settings || {};
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const from = settings.countFrom || `${today.slice(0, 7)}-01`;
      const ops = (Array.isArray(data.operations) ? data.operations : []).filter((op) => String(op.date || "") >= from && String(op.date || "") <= today);
      const isTransfer = (op) => op.internalTransfer === true || op.isTransfer === true || op.type === "transfer" || op.type === "internal-transfer";
      const isCredit = (op) => op.isCreditPayment === true || op.type === "credit-payment" || op.type === "loan-payment";
      const categories = Object.fromEntries(CATEGORIES.map((category) => [category, ops.filter((op) => op.category === category && !isTransfer(op) && !isCredit(op)).reduce((sum, op) => sum + (Number(op.amount) || 0), 0)]));
      const purchasesByItem = new Map();
      for (const purchase of Array.isArray(purchases) ? purchases : []) if (String(purchase.date || "") >= from && String(purchase.date || "") <= today) {
        for (const item of purchase.items || []) {
          const name = String(item.name || "").trim(); if (!name) continue;
          const key = name.toLocaleLowerCase("uk-UA");
          const row = purchasesByItem.get(key) || { name, spent: 0, purchases: 0 };
          row.spent += Number(item.price) || 0; row.purchases += 1; purchasesByItem.set(key, row);
        }
      }
      const income = ops.filter((op) => op.type === "income" && !isTransfer(op)).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
      const expenses = ops.filter((op) => op.type !== "income" && !isTransfer(op) && !isCredit(op)).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
      const creditPayments = ops.filter(isCredit).reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
      return {
        periodFrom: from, income, expenses, creditPayments, available: income - expenses - creditPayments,
        daysLeft: Math.max(1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1),
        currency: String(settings.currency || "UAH"), categoryTotals: categories,
        categoryLimits: settings.categoryLimits || { Продукти: Number(settings.foodLimit) || 0, Одяг: Number(settings.clothesLimit) || 0 },
        topItems: [...purchasesByItem.values()].sort((a, b) => b.spent - a.spent).slice(0, 10),
        credits: (Array.isArray(data.credits) ? data.credits : []).slice(0, 20).map((c) => ({ name: c.name, remaining: c.remaining, payment: c.payment, interestRate: c.interestRate })),
        goals: (Array.isArray(data.goals) ? data.goals : []).slice(0, 20).map((g) => ({ name: g.name, target: g.target, saved: g.saved })),
      };
    } catch { return {}; }
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === location.origin && url.pathname === "/api/ask" && init?.body && typeof init.body === "string") {
      try { const body = JSON.parse(init.body); return originalFetch(input, { ...init, body: JSON.stringify({ ...body, ...context() }), cache: "no-store" }); } catch { /* Send original request. */ }
    }
    return originalFetch(input, init);
  };
})();
