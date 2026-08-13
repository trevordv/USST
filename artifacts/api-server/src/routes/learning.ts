import { Router, type IRouter } from "express";
import { CreateLearningFeedbackBody, ReviewLearningCandidateBody, ResolveLearningConflictBody, UpdateLearningKnowledgeBody } from "@workspace/api-zod";
import type { UsstAuthUser } from "../middlewares/supabase-auth";
import { requireAdmin } from "../middlewares/supabase-auth";
import { MemoryService } from "../lib/memory-service";
import { postgresLearningRepository } from "../lib/postgres-learning-repository";
import { normalizeLearningSubject, sourceDomain } from "../lib/runtime-learning";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const memory = new MemoryService(postgresLearningRepository);

router.get("/learning/dashboard", requireAdmin, async (_req, res): Promise<void> => {
  const [dashboard, sourceReliability] = await Promise.all([
    postgresLearningRepository.listDashboard(),
    postgresLearningRepository.listSourceReliability(),
  ]);
  res.json({ ...dashboard, sourceReliability });
});

router.post("/learning/feedback", async (req, res): Promise<void> => {
  const parsed = CreateLearningFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = res.locals.usstUser as UsstAuthUser;
  let original = parsed.data.originalValue ?? {};
  let corrected = parsed.data.correctedValue ?? {};
  if (parsed.data.feedbackType === "duplicate") {
    const duplicateProjectId = Number(parsed.data.entityId);
    const canonicalProjectId = Number(corrected.canonicalProjectId);
    if (!Number.isInteger(duplicateProjectId) || !Number.isInteger(canonicalProjectId) || duplicateProjectId <= 0 || canonicalProjectId <= 0 || duplicateProjectId === canonicalProjectId) {
      res.status(400).json({ error: "Duplicate feedback requires distinct duplicate and canonical project IDs" });
      return;
    }
    const [duplicate, canonical] = await Promise.all([
      db.select().from(projectsTable).where(eq(projectsTable.id, duplicateProjectId)).limit(1),
      db.select().from(projectsTable).where(eq(projectsTable.id, canonicalProjectId)).limit(1),
    ]);
    if (!duplicate[0] || !canonical[0]) { res.status(400).json({ error: "Both projects must exist" }); return; }
    original = { ...original, name: duplicate[0].name, developer: duplicate[0].developer, location: duplicate[0].location, sourceName: duplicate[0].sourceName, sourceUrl: duplicate[0].sourceUrl };
    corrected = {
      ...corrected, duplicateProjectId, canonicalProjectId, duplicateName: duplicate[0].name,
      canonicalName: canonical[0].name, developer: duplicate[0].developer,
      location: duplicate[0].location, sourceName: duplicate[0].sourceName,
      sourceDomain: sourceDomain(duplicate[0].sourceUrl),
    };
  } else if (parsed.data.feedbackType === "false_positive") {
    const projectPattern = normalizeLearningSubject(String(original.name ?? ""));
    if (projectPattern.length < 4 || !original.sourceName && !original.sourceUrl && !original.developer && !original.location) {
      res.status(400).json({ error: "False-positive feedback requires a project pattern and scoped source, domain, developer, or location evidence" });
      return;
    }
    corrected = { ...corrected, projectPattern, sourceName: original.sourceName, sourceDomain: sourceDomain(String(original.sourceUrl ?? "")), developer: original.developer, location: original.location };
  }
  const result = await memory.recordFeedback({ ...parsed.data, originalValue: original, correctedValue: corrected, userId: user.id });

  let candidateCreated = false;
  let candidate: {
    knowledgeType: string;
    subjectType: string;
    subjectId: string | number | null | undefined;
    canonicalKey: string;
    value: Record<string, unknown>;
    summary: string;
  } | null = null;

  if (parsed.data.feedbackType === "duplicate") {
    candidate = {
      knowledgeType: "project_relationship",
      subjectType: "project",
      subjectId: normalizeLearningSubject(String(corrected.duplicateName)),
      canonicalKey: "duplicate_of",
      value: corrected,
      summary: parsed.data.reason || "User identified a duplicate project relationship",
    };
  } else if (parsed.data.feedbackType === "false_positive") {
    candidate = {
      knowledgeType: "known_false_positive_pattern",
      subjectType: parsed.data.entityType,
      subjectId: String(corrected.projectPattern),
      canonicalKey: "false_positive_pattern",
      value: corrected,
      summary: parsed.data.reason || "User rejected a false-positive extraction",
    };
  } else if (parsed.data.feedbackType === "approve_alias" || (parsed.data.feedbackType === "correction" && ("developer" in corrected || "canonicalDeveloper" in corrected))) {
    const isProjectAlias = corrected.canonicalProjectId != null && corrected.alias != null;
    candidate = {
      knowledgeType: isProjectAlias ? "project_alias" : "developer_alias",
      subjectType: isProjectAlias ? "project" : "developer",
      subjectId: normalizeLearningSubject(String(isProjectAlias ? corrected.alias : original.developer ?? parsed.data.entityId ?? "")),
      canonicalKey: isProjectAlias ? "canonical_project" : "canonical_developer",
      value: isProjectAlias ? corrected : { ...corrected, alias: original.developer, canonicalDeveloper: corrected.canonicalDeveloper ?? corrected.developer },
      summary: parsed.data.reason || (isProjectAlias ? "Project alias submitted for approval" : "Developer alias correction submitted for approval"),
    };
  } else if (parsed.data.feedbackType === "confirm_contact") {
    candidate = {
      knowledgeType: "validated_contact",
      subjectType: "contact",
      subjectId: parsed.data.entityId,
      canonicalKey: "confirmed_contact",
      value: corrected,
      summary: parsed.data.reason || "Contact confirmed by a user",
    };
  }

  if (candidate && Object.keys(candidate.value).length > 0) {
    await memory.promoteCandidate({ memoryIds: [result.memory.id], ...candidate });
    candidateCreated = true;
    await memory.recordAction({ actionType: "candidate_learning", entityType: candidate.subjectType, entityId: candidate.subjectId, outcome: "created", context: { knowledgeType: candidate.knowledgeType }, transientDays: 365 });
  }

  await memory.recordAction({ actionType: "feedback", entityType: parsed.data.entityType, entityId: parsed.data.entityId, outcome: "received", context: { feedbackType: parsed.data.feedbackType }, transientDays: 365 });
  res.status(201).json({ id: result.id, memoryId: result.memory.id, candidateCreated });
});

router.post("/learning/candidates/:id/review", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ReviewLearningCandidateBody.safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid candidate id" : parsed.error.message });
    return;
  }
  const user = res.locals.usstUser as UsstAuthUser;
  const reviewed = await postgresLearningRepository.reviewKnowledge(id, parsed.data.decision, user.id, parsed.data.reason);
  if (!reviewed) {
    res.status(404).json({ error: "Knowledge candidate not found or already reviewed" });
    return;
  }
  await memory.recordAction({ actionType: "knowledge_review", entityType: "knowledge", entityId: id, outcome: parsed.data.decision, transientDays: 365 });
  res.json(reviewed);
});

router.patch("/learning/knowledge/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdateLearningKnowledgeBody.safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid knowledge id" : parsed.error.message });
    return;
  }
  const updated = await postgresLearningRepository.updateKnowledge(id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: "Knowledge record not found" });
    return;
  }
  await memory.recordAction({ actionType: "knowledge_management", entityType: "knowledge", entityId: id, outcome: parsed.data.supersede ? "superseded" : "edited", transientDays: 365 });
  res.json(updated);
});

router.post("/learning/conflicts/:id/resolve", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ResolveLearningConflictBody.safeParse(req.body);
  if (!Number.isInteger(id) || id <= 0 || !parsed.success || (parsed.data.action !== "dismiss" && !parsed.data.knowledgeId)) {
    res.status(400).json({ error: parsed.success ? "A conflict value must be selected" : parsed.error.message });
    return;
  }
  const user = res.locals.usstUser as UsstAuthUser;
  const conflict = await postgresLearningRepository.resolveConflict(id, parsed.data, user.id);
  if (!conflict) { res.status(404).json({ error: "Open conflict or selected knowledge value not found" }); return; }
  await memory.recordAction({ actionType: "conflict_resolution", entityType: "knowledge_conflict", entityId: id, outcome: parsed.data.action, context: { knowledgeId: parsed.data.knowledgeId, administratorId: user.id }, transientDays: 3650 });
  res.json(conflict);
});

export default router;
