import application from "./receipt-worker.js";

export default {
  async fetch(request, env, ctx) {
    const response = await application.fetch(request, env, ctx);
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
          element.append('<script src="/purchases.js" defer></script>', { html: true });
        },
      })
      .transform(response);
  },
};
