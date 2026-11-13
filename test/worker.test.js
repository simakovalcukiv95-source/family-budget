import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";

function postAsk(body) {
  return new Request("https://budget.example/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

test("/api/ask rejects methods other than POST", async () => {
  const response = await worker.fetch(
    new Request("https://budget.example/api/ask", { method: "GET" }),
    {},
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  assert.match((await json(response)).error, /POST/);
});

test("/api/ask rejects malformed JSON", async () => {
  const response = await worker.fetch(postAsk("{"), {});

  assert.equal(response.status, 400);
  assert.equal((await json(response)).error, "Некоректний JSON.");
});

test("/api/ask requires a non-empty question", async () => {
  for (const question of [undefined, "", "   ", 42]) {
    const response = await worker.fetch(postAsk({ question }), {});

    assert.equal(response.status, 400);
    assert.equal((await json(response)).error, "Напишіть запитання.");
  }
});

test("/api/ask rejects questions longer than 500 characters", async () => {
  const response = await worker.fetch(postAsk({ question: "а".repeat(501) }), {});

  assert.equal(response.status, 413);
  assert.match((await json(response)).error, /500/);
});

test("/api/ask reports a missing Workers AI binding", async () => {
  const response = await worker.fetch(postAsk({ question: "Як заощадити?" }), {});

  assert.equal(response.status, 503);
  assert.match((await json(response)).error, /AI binding/);
});

test("/api/ask calls Workers AI with a sanitized budget and returns its answer", async () => {
  let capturedModel;
  let capturedOptions;
  const env = {
    AI: {
      async run(model, options) {
        capturedModel = model;
        capturedOptions = options;
        return { response: "Спробуйте планувати витрати." };
      },
    },
  };
  const response = await worker.fetch(
    postAsk({
      question: "Як заощадити?",
      income: 25000,
      expenses: 12000,
      daysLeft: 8,
      currency: "UAH",
      categoryTotals: { Продукти: 5000 },
      credits: [{ name: "Кредит", remaining: 1000 }],
      goals: [{ name: "Резерв", target: 5000, saved: 1500 }],
      token: "must-not-be-sent",
      operationDescription: "must-not-be-sent",
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(capturedModel, "@cf/meta/llama-3.1-8b-instruct");
  assert.equal(capturedOptions.messages[0].role, "system");
  assert.match(capturedOptions.messages[1].content, /Як заощадити\?/);
  assert.match(capturedOptions.messages[1].content, /25000/);
  assert.doesNotMatch(capturedOptions.messages[1].content, /must-not-be-sent/);
  assert.equal(capturedOptions.max_tokens, 450);

  const body = await json(response);
  assert.equal(body.ok, true);
  assert.equal(body.answer, "Спробуйте планувати витрати.");
  assert.equal(body.provider, "cloudflare-workers-ai");
  assert.ok(body.generatedAt);
});

test("/api/ask returns a clear error when Workers AI throws", async () => {
  const response = await worker.fetch(postAsk({ question: "Порада?" }), {
    AI: {
      async run() {
        throw new Error("provider details should not leak");
      },
    },
  });

  assert.equal(response.status, 502);
  const body = await json(response);
  assert.match(body.error, /Workers AI/);
  assert.doesNotMatch(body.error, /provider details/);
});

test("unknown API paths return JSON 404 responses", async () => {
  const response = await worker.fetch(
    new Request("https://budget.example/api/not-real"),
    {},
  );

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await json(response)).error, "Ендпоінт не знайдено.");
});
