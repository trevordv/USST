import { Router, type IRouter } from "express";
import { CreateLearningFeedbackBody, ReviewLearningCandidateBody, UpdateLearningKnowledgeBody } from "@workspace/api-zod";
import type { UsstAuthUser } from "../middlewares/supabase-auth";
import { requireAdmin } from "../middlewares/supabase-auth";
import { MemoryService } from "../lib/memory-service";
import { postgresLearningRepository } from "../lib/postgres-learning-repository";

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
  const result = await memory.recordFeedback({ ...parsed.data, userId: user.id });

  let candidateCreated = false;
  const corrected = parsed.data.correctedValue ?? {};
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
      subjectId: parsed.data.entityId,
      canonicalKey: "duplicate_of",
      value: corrected,
      summary: parsed.data.reason || "User identified a duplicate project relationship",
    };
  } else if (parsed.data.feedbackType === "false_positive") {
    candidate = {
      knowledgeType: "known_false_positive_pattern",
      subjectType: parsed.data.entityType,
      subjectId: parsed.data.entityId,
      canonicalKey: "false_positive_pattern",
      value: corrected,
      summary: parsed.data.reason || "User rejected a false-positive extraction",
    };
  } else if (parsed.data.feedbackType === "approve_alias" || (parsed.data.feedbackType === "correction" && "developer" in corrected)) {
    candidate = {
      knowledgeType: "developer_alias",
      subjectType: "developer",
      subjectId: String(parsed.data.originalValue?.developer ?? parsed.data.entityId ?? "").toLowerCase(),
      canonicalKey: "canonical_developer",
      value: corrected,
      summary: parsed.data.reason || "Developer alias correction submitted for approval",
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

export default router;
