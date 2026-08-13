import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAgentContext } from "./agent-context-builder.ts";
import { planConflictResolution } from "./conflict-resolution.ts";
import { MemoryService } from "./memory-service.ts";
import { getProjectIneligibilityReason } from "./project-eligibility.ts";
import { applyRuntimeLearning, normalizeLearningSubject } from "./runtime-learning.ts";

class LoopRepository {
  memories = [];
  knowledge = [];
  feedback = [];
  events = [];
  conflicts = [];
  async upsertMemory(input) { const row = { ...input, id: this.memories.length + 1, createdAt: new Date(), lastSeenAt: new Date(), timesObserved: 1, status: "active", supersededBy: null }; this.memories.push(row); return row; }
  async findMemories(scope) { return this.memories.filter((x) => (!scope.subjectIds?.length || scope.subjectIds.includes(x.subjectId)) && (!scope.statuses?.length || scope.statuses.includes(x.status))).slice(0, scope.limit); }
  async findKnowledge(scope) { return this.knowledge.filter((x) => (!scope.subjectIds?.length || scope.subjectIds.includes(x.subjectId)) && (!scope.approvalStatuses?.length || scope.approvalStatuses.includes(x.approvalStatus))).slice(0, scope.limit); }
  async getMemories(ids) { return this.memories.filter((x) => ids.includes(x.id)); }
  async createKnowledge(input) { const row = { ...input, id: this.knowledge.length + 1, createdAt: new Date(), updatedAt: new Date() }; this.knowledge.push(row); return row; }
  async findKnowledgeByKey(input) { return this.knowledge.filter((x) => x.knowledgeType === input.knowledgeType && x.subjectType === input.subjectType && x.subjectId === input.subjectId && x.canonicalKey === input.canonicalKey); }
  async createConflict(input) { this.conflicts.push({ ...input, id: this.conflicts.length + 1, status: "open" }); }
  async supersedeMemory() {}
  async insertFeedback(input) { this.feedback.push({ ...input, id: this.feedback.length + 1, createdAt: new Date() }); return { id: this.feedback.length }; }
  async insertEvent(input) { this.events.push(input); }
  approve(id) { const item = this.knowledge.find((x) => x.id === id); if (item) { item.approvalStatus = "approved"; item.confidence = "high"; } return item; }
}

async function promoteApproved(service, repository, input) {
  const feedback = await service.recordFeedback(input.feedback);
  const result = await service.promoteCandidate({ memoryIds: [feedback.memory.id], ...input.candidate });
  repository.approve(result.candidate.id);
  return result.candidate;
}

test("A: false-positive feedback closes the loop and safely changes a future scoped decision", async () => {
  const repository = new LoopRepository(); const service = new MemoryService(repository);
  const projectPattern = normalizeLearningSubject("Demo Solar Farm");
  const approved = await promoteApproved(service, repository, {
    feedback: { actionType: "reject_false_positive", entityType: "project", entityId: 10, originalValue: { name: "Demo Solar Farm", sourceName: "Demo Registry" }, correctedValue: { rejected: true }, feedbackType: "false_positive", reason: "Not a real project", userId: 7 },
    candidate: { knowledgeType: "known_false_positive_pattern", subjectType: "project", subjectId: projectPattern, canonicalKey: "false_positive_pattern", value: { projectPattern, sourceName: "Demo Registry" }, summary: "Known Demo Registry false positive" },
  });
  const context = await buildAgentContext(repository, { task: "project_classification", project: { name: "Demo Solar Project", sourceName: "Demo Registry" }, source: "Demo Registry" });
  const decision = applyRuntimeLearning({ name: "Demo Solar Project", sourceName: "Demo Registry" }, context);
  assert.equal(decision.rejectAsFalsePositive, true);
  assert.deepEqual(decision.appliedKnowledgeIds, [approved.id]);
  assert.ok(decision.events.includes("false_positive_avoided"));
  const unrelated = applyRuntimeLearning({ name: "Demo Solar Project", sourceName: "Different Registry" }, context);
  assert.equal(unrelated.rejectAsFalsePositive, false, "same name without scoped corroboration must not be blocked");
});

test("B: approved developer aliases canonicalise later source spelling and preserve provenance", async () => {
  const repository = new LoopRepository(); const service = new MemoryService(repository);
  await promoteApproved(service, repository, {
    feedback: { actionType: "correct_developer", entityType: "developer", entityId: "ACEN Australia Pty Ltd", originalValue: { developer: "ACEN Australia Pty Ltd" }, correctedValue: { canonicalDeveloper: "ACEN Australia" }, feedbackType: "correction", userId: 7 },
    candidate: { knowledgeType: "developer_alias", subjectType: "developer", subjectId: normalizeLearningSubject("ACEN Australia Pty Ltd"), canonicalKey: "canonical_developer", value: { alias: "ACEN Australia Pty Ltd", canonicalDeveloper: "ACEN Australia" }, summary: "ACEN alias" },
  });
  const candidate = { name: "New Solar Project", developer: "ACEN Australia Pty. Ltd.", sourceName: "Registry" };
  const context = await buildAgentContext(repository, { task: "developer_canonicalisation", project: candidate, developer: candidate.developer });
  const decision = applyRuntimeLearning(candidate, context);
  assert.equal(decision.canonicalDeveloper, "ACEN Australia");
  assert.equal(decision.originalDeveloper, "ACEN Australia Pty. Ltd.");
  assert.ok(decision.events.includes("alias_applied"));
});

test("C: approved project alias plus corroboration contributes to duplicate matching", async () => {
  const repository = new LoopRepository(); const service = new MemoryService(repository);
  await promoteApproved(service, repository, {
    feedback: { actionType: "approve_alias", entityType: "project", entityId: 99, originalValue: { name: "Western Downs Solar Farm Stage 2" }, correctedValue: { alias: "Western Downs Stage II Solar Project", canonicalProjectId: 99 }, feedbackType: "approve_alias", userId: 7 },
    candidate: { knowledgeType: "project_alias", subjectType: "project", subjectId: normalizeLearningSubject("Western Downs Stage II Solar Project"), canonicalKey: "canonical_project", value: { alias: "Western Downs Stage II Solar Project", canonicalProjectId: 99, developer: "ACEN", location: "Western Downs" }, summary: "Western Downs stage alias" },
  });
  const candidate = { name: "Western Downs Stage 2 Solar Farm", developer: "ACEN", location: "Western Downs", sourceName: "Registry" };
  const context = await buildAgentContext(repository, { task: "duplicate_detection", project: candidate });
  assert.equal(applyRuntimeLearning(candidate, context).duplicateProjectId, 99);
  assert.equal(applyRuntimeLearning({ ...candidate, developer: "Other", location: "Elsewhere" }, context).duplicateProjectId, null, "name evidence alone must never match automatically");
});

test("D: duplicate feedback UX and API require a selected canonical project", async () => {
  const [page, route] = await Promise.all([readFile(new URL("../../../solar-tracker/src/pages/project-detail.tsx", import.meta.url), "utf8"), readFile(new URL("../routes/learning.ts", import.meta.url), "utf8")]);
  assert.doesNotMatch(page, /requiresDuplicateSelection/);
  assert.match(page, /canonicalProjectId: canonicalProject\.id/);
  assert.match(route, /Duplicate feedback requires distinct duplicate and canonical project IDs/);
});

test("E/F: open conflicts block ordinary approval and selecting a preferred value resolves authoritatively", async () => {
  const repositorySource = await readFile(new URL("./postgres-learning-repository.ts", import.meta.url), "utf8");
  assert.match(repositorySource, /status, "open"/);
  assert.match(repositorySource, /if \(conflict\) return null/);
  assert.equal(planConflictResolution([3, 4], "select_preferred", 9), null);
  assert.deepEqual(planConflictResolution([3, 4], "select_preferred", 4), { status: "resolved", selectedKnowledgeId: 4, rejectedKnowledgeIds: [3] });
  assert.deepEqual(planConflictResolution([3, 4], "reject_value", 3), { status: "open", selectedKnowledgeId: null, rejectedKnowledgeIds: [3] });
});

test("G/H: learning cannot override capacity, wind-only, or standalone BESS hard gates", async () => {
  const knowledge = [{ id: 1, knowledgeType: "project_alias", subjectType: "project", subjectId: "tiny solar", canonicalKey: "canonical_project", valueJson: { alias: "Tiny Solar", canonicalProjectId: 99, sourceName: "Registry" }, summary: "alias", confidence: "high", approvalStatus: "approved", evidenceCount: 1, sourceMemoryIds: [], createdAt: new Date(), updatedAt: new Date() }];
  const context = { hardRules: [], memory: [], knowledge, taskData: {} };
  assert.equal(getProjectIneligibilityReason({ name: "Tiny Solar", capacityMw: 4, country: "AU" }), "below-minimum-capacity");
  assert.equal(getProjectIneligibilityReason({ name: "Coastal Wind Project", description: "wind turbines", capacityMw: 80, country: "AU" }), "wind-project");
  assert.equal(getProjectIneligibilityReason({ name: "Standalone BESS", description: "battery storage", capacityMw: 80, country: "AU" }), "no-solar-component");
  assert.equal(applyRuntimeLearning({ name: "Tiny Solar", sourceName: "Registry" }, context).duplicateProjectId, 99, "advisory evidence may exist but scanner checks the hard gate first");
});

test("I: context retrieval stays scoped and omits unrelated memory", async () => {
  const repository = new LoopRepository(); const service = new MemoryService(repository);
  await service.remember({ memoryType: "classification_feedback", subjectType: "project", subjectId: normalizeLearningSubject("Relevant Solar"), key: "feedback", value: {}, summary: "relevant", source: "test" });
  await service.remember({ memoryType: "classification_feedback", subjectType: "project", subjectId: normalizeLearningSubject("Unrelated Solar"), key: "feedback", value: {}, summary: "unrelated", source: "test" });
  const context = await buildAgentContext(repository, { task: "project_classification", project: { name: "Relevant Solar" } });
  assert.deepEqual(context.memory.map((item) => item.summary), ["relevant"]);
});
