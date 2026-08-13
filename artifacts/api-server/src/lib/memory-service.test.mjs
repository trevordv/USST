import assert from "node:assert/strict";
import test from "node:test";
import { MemoryService } from "./memory-service.ts";

class MemoryRepository {
  memories = [];
  knowledge = [];
  feedback = [];
  events = [];
  conflicts = [];

  async upsertMemory(input) {
    const found = this.memories.find((item) => item.fingerprint === input.fingerprint);
    if (found) { found.timesObserved++; found.lastSeenAt = new Date(); if (found.timesObserved >= 3) found.confidence = "medium"; return found; }
    const row = { ...input, id: this.memories.length + 1, createdAt: new Date(), lastSeenAt: new Date(), timesObserved: 1, status: "active", supersededBy: null };
    this.memories.push(row); return row;
  }
  async findMemories(scope) { return this.memories.filter((item) => (!scope.subjectType || item.subjectType === scope.subjectType) && (!scope.subjectIds?.length || scope.subjectIds.includes(item.subjectId)) && (!scope.memoryTypes?.length || scope.memoryTypes.includes(item.memoryType)) && (!scope.statuses?.length || scope.statuses.includes(item.status))).slice(0, scope.limit); }
  async findKnowledge(scope) { return this.knowledge.filter((item) => (!scope.subjectIds?.length || scope.subjectIds.includes(item.subjectId)) && (!scope.approvalStatuses?.length || scope.approvalStatuses.includes(item.approvalStatus))).slice(0, scope.limit); }
  async getMemories(ids) { return this.memories.filter((item) => ids.includes(item.id)); }
  async createKnowledge(input) { const row = { ...input, id: this.knowledge.length + 1, createdAt: new Date(), updatedAt: new Date() }; this.knowledge.push(row); return row; }
  async findKnowledgeByKey(input) { return this.knowledge.filter((item) => item.knowledgeType === input.knowledgeType && item.subjectType === input.subjectType && item.subjectId === input.subjectId && item.canonicalKey === input.canonicalKey); }
  async createConflict(input) { this.conflicts.push(input); }
  async supersedeMemory(id, supersededBy) { const row = this.memories.find((item) => item.id === id); row.status = "superseded"; row.supersededBy = supersededBy; }
  async insertFeedback(input) { const row = { ...input, id: this.feedback.length + 1 }; this.feedback.push(row); return row; }
  async insertEvent(input) { this.events.push(input); }
}

test("memory creation deduplicates and increments observations", async () => {
  const repo = new MemoryRepository(); const service = new MemoryService(repo);
  const input = { memoryType: "project_alias", subjectType: "project", subjectId: 7, key: "alias", value: { alias: "Stage II" }, summary: "Alias observed", source: "scanner" };
  const first = await service.remember(input); const second = await service.incrementObservation(input); await service.incrementObservation(input);
  assert.equal(first.id, second.id); assert.equal(repo.memories.length, 1); assert.equal(repo.memories[0].timesObserved, 3); assert.equal(repo.memories[0].confidence, "medium");
});

test("feedback capture creates high-confidence memory and telemetry", async () => {
  const repo = new MemoryRepository(); const service = new MemoryService(repo);
  const result = await service.recordFeedback({ actionType: "reject_false_positive", entityType: "project", entityId: 9, feedbackType: "false_positive", correctedValue: { rejected: true }, reason: "Operational article", userId: 1 });
  assert.equal(repo.feedback.length, 1); assert.equal(result.memory.confidence, "high"); assert.equal(result.memory.memoryType, "classification_feedback"); assert.ok(repo.events.some((event) => event.outcome === "received"));
});

test("project and developer aliases become candidates, never automatic knowledge", async () => {
  const repo = new MemoryRepository(); const service = new MemoryService(repo);
  const project = await service.remember({ memoryType: "project_alias", subjectType: "project", subjectId: 1, key: "alias", value: { alias: "Western Downs Stage II" }, summary: "Project alias", source: "user_feedback", humanConfirmed: true });
  const developer = await service.remember({ memoryType: "developer_alias", subjectType: "developer", subjectId: "acen", key: "alias", value: { canonical: "ACEN Australia" }, summary: "Developer alias", source: "user_feedback", humanConfirmed: true });
  const a = await service.promoteCandidate({ memoryIds: [project.id], knowledgeType: "project_alias", subjectType: "project", subjectId: 1, canonicalKey: "canonical_project", value: { canonical: "Western Downs Solar Farm Stage 2" }, summary: "Canonical project alias" });
  const b = await service.promoteCandidate({ memoryIds: [developer.id], knowledgeType: "developer_alias", subjectType: "developer", subjectId: "acen", canonicalKey: "canonical_developer", value: { canonical: "ACEN Australia" }, summary: "Canonical developer alias" });
  assert.equal(a.candidate.approvalStatus, "candidate"); assert.equal(b.candidate.approvalStatus, "candidate");
});

test("conflicting knowledge is retained and explicitly flagged", async () => {
  const repo = new MemoryRepository(); const service = new MemoryService(repo);
  const one = await service.remember({ memoryType: "developer_alias", subjectType: "project", subjectId: 3, key: "developer", value: { developer: "ACEN" }, summary: "ACEN evidence", source: "source-a" });
  const two = await service.remember({ memoryType: "developer_alias", subjectType: "project", subjectId: 3, key: "developer", value: { developer: "Lightsource bp" }, summary: "Lightsource evidence", source: "source-b" });
  await service.promoteCandidate({ memoryIds: [one.id], knowledgeType: "project_relationship", subjectType: "project", subjectId: 3, canonicalKey: "developer", value: { developer: "ACEN" }, summary: "Developer ACEN" });
  const result = await service.promoteCandidate({ memoryIds: [two.id], knowledgeType: "project_relationship", subjectType: "project", subjectId: 3, canonicalKey: "developer", value: { developer: "Lightsource bp" }, summary: "Developer Lightsource" });
  assert.equal(result.conflict, true); assert.equal(result.candidate.confidence, "low"); assert.equal(repo.conflicts.length, 1); assert.equal(repo.knowledge.length, 2);
});

test("memory retrieval is task-scoped and superseding preserves history", async () => {
  const repo = new MemoryRepository(); const service = new MemoryService(repo);
  const a = await service.remember({ memoryType: "parser_failure", subjectType: "source", subjectId: "AEMO", key: "xlsx", value: { outcome: "failed" }, summary: "AEMO failed", source: "scanner" });
  const b = await service.remember({ memoryType: "parser_failure", subjectType: "source", subjectId: "EPBC", key: "arcgis", value: { outcome: "failed" }, summary: "EPBC failed", source: "scanner" });
  const scoped = await service.getSourceHistory("AEMO"); assert.deepEqual(scoped.map((item) => item.id), [a.id]);
  await service.supersedeMemory(a.id, b.id); assert.equal(repo.memories.find((item) => item.id === a.id).status, "superseded"); assert.equal(repo.memories.length, 2);
});
