import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("learning management is admin-only while feedback remains authenticated", async () => {
  const [routes, router] = await Promise.all([readSource("../routes/learning.ts"), readSource("../routes/index.ts")]);
  assert.match(router, /router\.use\(requireAuth\)/);
  assert.match(routes, /get\("\/learning\/dashboard", requireAdmin/);
  assert.match(routes, /post\("\/learning\/candidates\/:id\/review", requireAdmin/);
  assert.match(routes, /patch\("\/learning\/knowledge\/:id", requireAdmin/);
  assert.match(routes, /post\("\/learning\/feedback", async/);
});

test("migration uses additive tables, RLS, and explicit browser-role revocation", async () => {
  const migration = await readFile(new URL("../../../../supabase/migrations/20260813080138_memory_learning_loop.sql", import.meta.url), "utf8");
  for (const table of ["agent_memory", "agent_knowledge", "agent_feedback", "agent_learning_events", "agent_knowledge_conflicts"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(migration, /drop table|truncate|delete from|alter table public\.projects/i);
});

test("open conflicts block knowledge approval in the repository", async () => {
  const repository = await readSource("./postgres-learning-repository.ts");
  assert.match(repository, /decision === "approved"/);
  assert.match(repository, /agentKnowledgeConflictsTable\.status, "open"/);
  assert.match(repository, /if \(conflict\) return null/);
});
