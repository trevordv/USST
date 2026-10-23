import assert from "node:assert/strict";
import test from "node:test";
import { browseAiConfigurationProblem, runBrowseAiTask } from "./browse-ai-task.ts";

function harness(responses, latency = 0) {
  let clock = 0;
  const calls = [];
  return {
    calls,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url, init) => {
      calls.push({ url, init });
      clock += latency;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next ?? { result: { status: "running" } }), {
        status: next?.httpStatus ?? 200,
      });
    },
  };
}
const created = { result: { id: "task/1" } };

test("Browse.AI distinguishes missing robot, missing key and complete configuration", () => {
  assert.match(browseAiConfigurationProblem(), /robot ID and API key/);
  assert.match(browseAiConfigurationProblem("robot", " "), /API key/);
  assert.match(browseAiConfigurationProblem(" ", "key"), /robot ID/);
  assert.equal(browseAiConfigurationProblem("robot", "key"), undefined);
});

test("Browse.AI returns valid empty lists as success and uses its fixed API origin", async () => {
  const h = harness([created, { result: { status: "successful", capturedLists: { projects: [] } } }]);
  const result = await runBrowseAiTask("robot/1", "test-key", "https://www.epa.govt.nz/public-consultations/", h);
  assert.deepEqual(result.capturedLists, { projects: [] });
  assert.equal(h.calls[0].url, "https://api.browse.ai/v2/robots/robot%2F1/tasks");
  assert.equal(h.calls[1].url, "https://api.browse.ai/v2/robots/robot%2F1/tasks/task%2F1");
  assert.equal(h.calls[0].init.method, "POST");
  assert.ok(h.calls.every(c => c.init.signal instanceof AbortSignal));
});

test("Browse.AI preserves structured projects", async () => {
  const capturedLists = { projects: [{ name: "River Solar Farm", capacity: "50 MW" }] };
  const h = harness([created, { result: { status: "successful", capturedLists } }]);
  assert.deepEqual((await runBrowseAiTask("robot", "key", "https://www.epa.govt.nz/", h)).capturedLists, capturedLists);
});

test("Browse.AI HTTP, task, malformed and transport failures never become empty success", async () => {
  for (const response of [
    { httpStatus: 403 }, { result: { status: "failed" } },
    { result: { status: "successful" } },
    { result: { status: "successful", capturedLists: { projects: [null] } } },
    { result: { status: "successful", capturedLists: { projects: [{ name: 5 }] } } },
    { result: { status: "unknown" } }, new Error("network failure"),
  ]) {
    await assert.rejects(runBrowseAiTask("robot", "key", "https://www.epa.govt.nz/", harness([created, response])));
  }
  await assert.rejects(runBrowseAiTask("robot", "key", "https://www.epa.govt.nz/", harness([{ result: {} }])));
});

test("Browse.AI polling deadline includes network time", async () => {
  const h = harness([created], 10_000);
  await assert.rejects(runBrowseAiTask("robot", "key", "https://www.epa.govt.nz/", h), /timed out/);
  assert.ok(h.now() <= 90_000);
  assert.ok(h.calls.length < 18);
});

test("Browse.AI missing configuration never makes a network call", async () => {
  const h = harness([]);
  await assert.rejects(runBrowseAiTask("robot", "", "https://www.epa.govt.nz/", h), /API key/);
  assert.equal(h.calls.length, 0);
});
