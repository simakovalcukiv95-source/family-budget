import application from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    const response = await application.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) return response;

    return new HTMLRewriter()
      .on("body", {
        element(element) {
          element.append('<script src="/purchases.js" defer></script>', { html: true });
        },
      })
      .transform(response);
  },
};
