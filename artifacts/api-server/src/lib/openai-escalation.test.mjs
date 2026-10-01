import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENAI_ESCALATION_MODELS, OpenAiQualityError, runOpenAiEscalation,
} from "./openai-escalation.ts";

function harness(outputs, operation = "source_fallback", maxAttempts) {
  const calls = [];
  const events = [];
  const ledger = [];
  return {
    calls, events, ledger,
    run: () => runOpenAiEscalation({
      context: { operation, sourceName: "Official source" }, maxAttempts,
      request: async model => {
        calls.push(model);
        const value = outputs[calls.length - 1];
        if (value instanceof Error) throw value;
        return { output_text: value };
      },
      validate: response => {
        try {
          const parsed = JSON.parse(response.output_text);
          if (!Array.isArray(parsed)) throw new OpenAiQualityError("schema_invalid", "array required");
          return parsed;
        } catch (error) {
          if (error instanceof OpenAiQualityError) throw error;
          throw new OpenAiQualityError("malformed_output", "invalid JSON");
        }
      }, resultCount: rows => rows.length, log: (event, fields) => events.push({ event, ...fields }),
      ledgerWriter: async entry => ledger.push(entry),
    }),
  };
}

test("Luna valid result terminates without escalation", async () => {
  const h = harness(['[{"name":"Solar"}]']);
  assert.equal((await h.run()).length, 1);
  assert.deepEqual(h.calls, ["gpt-5.6-luna"]);
});

test("Luna valid empty array terminates without escalation", async () => {
  const h = harness(["[]"]);
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.calls, ["gpt-5.6-luna"]);
});

test("malformed Luna output escalates to Terra and Terra success stops before Sol", async () => {
  const h = harness(["not json", "[]"]);
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
  assert.equal(h.events.find(value => value.event === "openai_model_escalated").escalationReason, "malformed_output");
});

test("retryable Luna provider failure escalates to Terra", async () => {
  const providerError = Object.assign(new Error("temporary outage"), { status: 503 });
  const h = harness([providerError, "[]"]);
  await h.run();
  assert.deepEqual(h.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
});

test("Luna and Terra quality failures reach Sol only for permitted operations", async () => {
  const h = harness(["bad", "still bad", "[]"]);
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.calls, [...OPENAI_ESCALATION_MODELS]);
  assert.equal(h.ledger.length, 3);
  assert.deepEqual(h.ledger.map(entry => entry.model), [...OPENAI_ESCALATION_MODELS]);

  const lowImportance = harness(["bad", "still bad", "[]"], "watt_news_extract");
  await assert.rejects(lowImportance.run(), OpenAiQualityError);
  assert.deepEqual(lowImportance.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
});

test("Sol failure is returned as a graceful final failure", async () => {
  const h = harness(["bad", "bad", "bad"]);
  await assert.rejects(h.run(), OpenAiQualityError);
  assert.deepEqual(h.calls, [...OPENAI_ESCALATION_MODELS]);
  const final = h.events.at(-1);
  assert.deepEqual({ event: final.event, model: final.finalModel, success: final.success },
    { event: "openai_model_final", model: "gpt-5.6-sol", success: false });
});

test("eligibility rejection happens after a valid result and cannot escalate", async () => {
  const h = harness(['[{"capacity_mw":4.99,"country":"US"}]']);
  const extracted = await h.run();
  const eligible = extracted.filter(row => row.capacity_mw >= 5 && ["AU", "NZ"].includes(row.country));
  assert.deepEqual(eligible, []);
  assert.deepEqual(h.calls, ["gpt-5.6-luna"]);
});

test("maximum attempts cannot be exceeded", async () => {
  const h = harness(["bad", "bad", "[]"], "source_fallback", 2);
  await assert.rejects(h.run(), OpenAiQualityError);
  assert.equal(h.calls.length, 2);
});

test("non-retryable provider failures do not spend on a stronger model", async () => {
  const h = harness([Object.assign(new Error("invalid request"), { status: 400 }), "[]"]);
  await assert.rejects(h.run(), /invalid request/);
  assert.deepEqual(h.calls, ["gpt-5.6-luna"]);
});
