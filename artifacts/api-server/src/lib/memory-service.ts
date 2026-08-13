import {
  CRITICAL_KNOWLEDGE_KEYS,
  confidenceForEvidence,
  memoryFingerprint,
  sanitizeLearningPayload,
  type Confidence,
} from "./learning-policy.ts";

export interface MemoryRecord {
  id: number;
  memoryType: string;
  subjectType: string;
  subjectId: string | null;
  key: string;
  valueJson: Record<string, unknown>;
  summary: string;
  confidence: Confidence;
  source: string;
  sourceReference: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
  timesObserved: number;
  status: string;
  supersededBy: number | null;
  createdBy: number | null;
  fingerprint: string;
}

export interface KnowledgeRecord {
  id: number;
  knowledgeType: string;
  subjectType: string;
  subjectId: string | null;
  canonicalKey: string;
  valueJson: Record<string, unknown>;
  summary: string;
  confidence: Confidence;
  approvalStatus: string;
  evidenceCount: number;
  sourceMemoryIds: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningRepository {
  upsertMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "lastSeenAt" | "timesObserved" | "status" | "supersededBy">): Promise<MemoryRecord>;
  findMemories(scope: { subjectType?: string; subjectIds?: string[]; memoryTypes?: string[]; statuses?: string[]; limit: number }): Promise<MemoryRecord[]>;
  findKnowledge(scope: { subjectType?: string; subjectIds?: string[]; knowledgeTypes?: string[]; approvalStatuses?: string[]; limit: number }): Promise<KnowledgeRecord[]>;
  getMemories(ids: number[]): Promise<MemoryRecord[]>;
  createKnowledge(input: Omit<KnowledgeRecord, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeRecord>;
  findKnowledgeByKey(input: { knowledgeType: string; subjectType: string; subjectId: string | null; canonicalKey: string }): Promise<KnowledgeRecord[]>;
  createConflict(input: { knowledgeType: string; subjectType: string; subjectId: string | null; canonicalKey: string; knowledgeIds: number[]; memoryIds: number[]; summary: string }): Promise<void>;
  supersedeMemory(id: number, supersededBy: number): Promise<void>;
  insertFeedback(input: { actionType: string; entityType: string; entityId: string | null; originalValue: Record<string, unknown> | null; correctedValue: Record<string, unknown> | null; feedbackType: string; reason: string | null; userId: number }): Promise<{ id: number }>;
  insertEvent(input: { actionType: string; entityType: string; entityId: string | null; contextJson: Record<string, unknown>; outcome: string; durationMs?: number | null; sourceName?: string | null; projectCount?: number | null; expiresAt?: Date | null }): Promise<void>;
}

export class MemoryService {
  private readonly repository: LearningRepository;

  constructor(repository: LearningRepository) {
    this.repository = repository;
  }

  async remember(input: {
    memoryType: string;
    subjectType: string;
    subjectId?: string | number | null;
    key: string;
    value: Record<string, unknown>;
    summary: string;
    source: string;
    sourceReference?: string | null;
    createdBy?: number | null;
    expiresAt?: Date | null;
    humanConfirmed?: boolean;
  }): Promise<MemoryRecord> {
    const valueJson = sanitizeLearningPayload(input.value) as Record<string, unknown>;
    const memory = await this.repository.upsertMemory({
      memoryType: input.memoryType,
      subjectType: input.subjectType,
      subjectId: input.subjectId == null ? null : String(input.subjectId),
      key: input.key,
      valueJson,
      summary: input.summary,
      confidence: input.humanConfirmed ? "high" : "low",
      source: input.source,
      sourceReference: input.sourceReference ?? null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.createdBy ?? null,
      fingerprint: memoryFingerprint({
        memoryType: input.memoryType,
        subjectType: input.subjectType,
        subjectId: input.subjectId == null ? null : String(input.subjectId),
        key: input.key,
        value: valueJson,
        source: input.source,
      }),
    });
    await this.repository.insertEvent({
      actionType: "memory",
      entityType: input.subjectType,
      entityId: input.subjectId == null ? null : String(input.subjectId),
      contextJson: { memoryType: input.memoryType },
      outcome: memory.timesObserved === 1 ? "created" : "reused",
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    });
    return memory;
  }

  recordObservation(input: Parameters<MemoryService["remember"]>[0]) {
    return this.remember(input);
  }

  incrementObservation(input: Parameters<MemoryService["remember"]>[0]) {
    return this.remember(input);
  }

  async retrieveRelevantMemory(input: {
    subjectType?: string;
    subjectIds?: Array<string | number | null | undefined>;
    memoryTypes?: string[];
    limit?: number;
  }): Promise<MemoryRecord[]> {
    const subjectIds = input.subjectIds?.filter((id): id is string | number => id != null).map(String);
    const records = await this.repository.findMemories({
      subjectType: input.subjectType,
      subjectIds,
      memoryTypes: input.memoryTypes,
      statuses: ["active", "candidate"],
      limit: Math.min(input.limit ?? 20, 50),
    });
    await this.repository.insertEvent({
      actionType: "memory_retrieval",
      entityType: input.subjectType ?? "task",
      entityId: null,
      contextJson: { resultCount: records.length, memoryTypes: input.memoryTypes ?? [] },
      outcome: records.length > 0 ? "retrieved" : "empty",
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    });
    return records;
  }

  async promoteCandidate(input: {
    memoryIds: number[];
    knowledgeType: string;
    subjectType: string;
    subjectId?: string | number | null;
    canonicalKey: string;
    value: Record<string, unknown>;
    summary: string;
  }): Promise<{ candidate: KnowledgeRecord; conflict: boolean }> {
    const memories = await this.repository.getMemories(input.memoryIds);
    if (memories.length === 0) throw new Error("Knowledge candidates require memory evidence");
    const subjectId = input.subjectId == null ? null : String(input.subjectId);
    const valueJson = sanitizeLearningPayload(input.value) as Record<string, unknown>;
    const existing = await this.repository.findKnowledgeByKey({
      knowledgeType: input.knowledgeType,
      subjectType: input.subjectType,
      subjectId,
      canonicalKey: input.canonicalKey,
    });
    const identical = existing.find((item) => JSON.stringify(item.valueJson) === JSON.stringify(valueJson));
    if (identical) return { candidate: identical, conflict: false };
    const conflicts = existing.filter((item) => JSON.stringify(item.valueJson) !== JSON.stringify(valueJson));
    const candidate = await this.repository.createKnowledge({
      knowledgeType: input.knowledgeType,
      subjectType: input.subjectType,
      subjectId,
      canonicalKey: input.canonicalKey,
      valueJson,
      summary: input.summary,
      confidence: confidenceForEvidence({
        independentObservations: new Set(memories.map((item) => item.sourceReference ?? item.source)).size,
        conflicting: conflicts.length > 0,
      }),
      approvalStatus: "candidate",
      evidenceCount: memories.reduce((sum, item) => sum + item.timesObserved, 0),
      sourceMemoryIds: memories.map((item) => item.id),
    });
    if (conflicts.length > 0) {
      await this.repository.createConflict({
        knowledgeType: input.knowledgeType,
        subjectType: input.subjectType,
        subjectId,
        canonicalKey: input.canonicalKey,
        knowledgeIds: [...conflicts.map((item) => item.id), candidate.id],
        memoryIds: memories.map((item) => item.id),
        summary: `Conflicting values observed for ${input.canonicalKey}; administrative resolution required.`,
      });
    }
    return { candidate, conflict: conflicts.length > 0 };
  }

  async recordFeedback(input: {
    actionType: string;
    entityType: string;
    entityId?: string | number | null;
    originalValue?: Record<string, unknown> | null;
    correctedValue?: Record<string, unknown> | null;
    feedbackType: string;
    reason?: string | null;
    userId: number;
  }): Promise<{ id: number; memory: MemoryRecord }> {
    const entityId = input.entityId == null ? null : String(input.entityId);
    const feedback = await this.repository.insertFeedback({
      actionType: input.actionType,
      entityType: input.entityType,
      entityId,
      originalValue: sanitizeLearningPayload(input.originalValue ?? null) as Record<string, unknown> | null,
      correctedValue: sanitizeLearningPayload(input.correctedValue ?? null) as Record<string, unknown> | null,
      feedbackType: input.feedbackType,
      reason: input.reason ?? null,
      userId: input.userId,
    });
    const memory = await this.remember({
      memoryType: input.feedbackType === "false_positive" ? "classification_feedback" : "workflow_feedback",
      subjectType: input.entityType,
      subjectId: entityId,
      key: input.actionType,
      value: { original: input.originalValue ?? null, corrected: input.correctedValue ?? null, reason: input.reason ?? null },
      summary: input.reason || `${input.feedbackType.replaceAll("_", " ")} recorded for ${input.entityType}`,
      source: "user_feedback",
      sourceReference: `feedback:${feedback.id}`,
      createdBy: input.userId,
      humanConfirmed: true,
    });
    await this.recordAction({
      actionType: "feedback",
      entityType: input.entityType,
      entityId,
      outcome: "received",
      context: { feedbackType: input.feedbackType },
      transientDays: 365,
    });
    return { id: feedback.id, memory };
  }

  recordAction(input: {
    actionType: string;
    entityType: string;
    entityId?: string | number | null;
    context?: Record<string, unknown>;
    outcome: string;
    durationMs?: number | null;
    sourceName?: string | null;
    projectCount?: number | null;
    transientDays?: number;
  }) {
    return this.repository.insertEvent({
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      contextJson: sanitizeLearningPayload(input.context ?? {}) as Record<string, unknown>,
      outcome: input.outcome,
      durationMs: input.durationMs,
      sourceName: input.sourceName,
      projectCount: input.projectCount,
      expiresAt: input.transientDays ? new Date(Date.now() + input.transientDays * 86_400_000) : null,
    });
  }

  supersedeMemory(id: number, supersededBy: number) {
    return this.repository.supersedeMemory(id, supersededBy);
  }

  getSourceHistory(sourceName: string) {
    return this.retrieveRelevantMemory({ subjectType: "source", subjectIds: [sourceName], limit: 20 });
  }

  getProjectContext(projectId: number | string) {
    return this.retrieveRelevantMemory({ subjectType: "project", subjectIds: [projectId], limit: 20 });
  }

  getDeveloperContext(developer: string) {
    return this.retrieveRelevantMemory({ subjectType: "developer", subjectIds: [developer.toLowerCase().trim()], limit: 20 });
  }

  static requiresHumanApproval(canonicalKey: string): boolean {
    // USST currently routes every candidate through review. The explicit
    // critical-key check documents the invariant if lower-risk auto-promotion
    // is introduced later.
    if (CRITICAL_KNOWLEDGE_KEYS.has(canonicalKey)) return true;
    return true;
  }
}
