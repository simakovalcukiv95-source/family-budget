(() => {
  "use strict";
  const KEY = "kovalchuk-family-budget-v1";
  const originalFetch = window.fetch.bind(window);

  function getCountFrom() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "{}");
      const value = data?.settings?.countFrom;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
      const timestamp = Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000);
      return Number.isFinite(timestamp) ? timestamp : null;
    } catch { return null; }
  }

  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    const method = String(init?.method || request?.method || "GET").toUpperCase();
    if (url.origin === location.origin && url.pathname === "/api/monobank" && method === "POST") {
      try {
        const source = init?.body ?? (request ? await request.clone().text() : "{}");
        const body = typeof source === "string" ? JSON.parse(source) : source instanceof FormData ? null : JSON.parse(String(source || "{}"));
        const countFrom = getCountFrom();
        if (body && countFrom != null) {
          body.from = Math.max(Number(body.from) || 0, countFrom);
          const headers = new Headers(init?.headers || request?.headers || {});
          headers.set("content-type", "application/json");
          const nextInit = { ...init, method: "POST", headers, body: JSON.stringify(body), cache: "no-store" };
          return originalFetch(input, nextInit);
        }
      } catch (error) {
        console.warn("Could not apply the configured Monobank start date; using the original request.", error);
      }
    }
    return originalFetch(input, init);
  };
})();
