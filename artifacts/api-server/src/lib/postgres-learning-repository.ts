import {
  agentFeedbackTable,
  agentKnowledgeConflictsTable,
  agentKnowledgeTable,
  agentLearningEventsTable,
  agentMemoryTable,
  db,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { reliabilityScore } from "./learning-policy.ts";
import type { Confidence } from "./learning-policy.ts";
import type { KnowledgeRecord, LearningRepository, MemoryRecord } from "./memory-service.ts";
import { planConflictResolution } from "./conflict-resolution.ts";

function asMemory(row: typeof agentMemoryTable.$inferSelect): MemoryRecord {
  return { ...row, confidence: row.confidence as Confidence };
}

function asKnowledge(row: typeof agentKnowledgeTable.$inferSelect): KnowledgeRecord {
  return { ...row, confidence: row.confidence as Confidence };
}

export class PostgresLearningRepository implements LearningRepository {
  async upsertMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "lastSeenAt" | "timesObserved" | "status" | "supersededBy">): Promise<MemoryRecord> {
    const [row] = await db.insert(agentMemoryTable).values(input).onConflictDoUpdate({
      target: agentMemoryTable.fingerprint,
      set: {
        lastSeenAt: new Date(),
        timesObserved: sql`${agentMemoryTable.timesObserved} + 1`,
        summary: input.summary,
        expiresAt: input.expiresAt,
        confidence: sql`case
          when ${agentMemoryTable.confidence} = 'high' then 'high'
          when ${agentMemoryTable.timesObserved} + 1 >= 5 then 'high'
          when ${agentMemoryTable.timesObserved} + 1 >= 3 then 'medium'
          else ${agentMemoryTable.confidence}
        end`,
      },
    }).returning();
    return asMemory(row);
  }

  async findMemories(scope: { subjectType?: string; subjectIds?: string[]; memoryTypes?: string[]; statuses?: string[]; limit: number }): Promise<MemoryRecord[]> {
    const conditions = [];
    if (scope.subjectType) conditions.push(eq(agentMemoryTable.subjectType, scope.subjectType));
    if (scope.subjectIds?.length) conditions.push(inArray(agentMemoryTable.subjectId, scope.subjectIds));
    if (scope.memoryTypes?.length) conditions.push(inArray(agentMemoryTable.memoryType, scope.memoryTypes));
    if (scope.statuses?.length) conditions.push(inArray(agentMemoryTable.status, scope.statuses));
    conditions.push(or(isNull(agentMemoryTable.expiresAt), sql`${agentMemoryTable.expiresAt} > now()`)!);
    const rows = await db.select().from(agentMemoryTable)
      .where(and(...conditions))
      .orderBy(desc(agentMemoryTable.lastSeenAt))
      .limit(scope.limit);
    return rows.map(asMemory);
  }

  async findKnowledge(scope: { subjectType?: string; subjectIds?: string[]; knowledgeTypes?: string[]; approvalStatuses?: string[]; limit: number }): Promise<KnowledgeRecord[]> {
    const conditions = [];
    if (scope.subjectType) conditions.push(eq(agentKnowledgeTable.subjectType, scope.subjectType));
    if (scope.subjectIds?.length) conditions.push(inArray(agentKnowledgeTable.subjectId, scope.subjectIds));
    if (scope.knowledgeTypes?.length) conditions.push(inArray(agentKnowledgeTable.knowledgeType, scope.knowledgeTypes));
    if (scope.approvalStatuses?.length) conditions.push(inArray(agentKnowledgeTable.approvalStatus, scope.approvalStatuses));
    const rows = await db.select().from(agentKnowledgeTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(agentKnowledgeTable.updatedAt))
      .limit(scope.limit);
    return rows.map(asKnowledge);
  }

  async getMemories(ids: number[]): Promise<MemoryRecord[]> {
    if (!ids.length) return [];
    return (await db.select().from(agentMemoryTable).where(inArray(agentMemoryTable.id, ids))).map(asMemory);
  }

  async createKnowledge(input: Omit<KnowledgeRecord, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeRecord> {
    const [row] = await db.insert(agentKnowledgeTable).values(input).returning();
    return asKnowledge(row);
  }

  async findKnowledgeByKey(input: { knowledgeType: string; subjectType: string; subjectId: string | null; canonicalKey: string }): Promise<KnowledgeRecord[]> {
    const subject = input.subjectId == null
      ? isNull(agentKnowledgeTable.subjectId)
      : eq(agentKnowledgeTable.subjectId, input.subjectId);
    const rows = await db.select().from(agentKnowledgeTable).where(and(
      eq(agentKnowledgeTable.knowledgeType, input.knowledgeType),
      eq(agentKnowledgeTable.subjectType, input.subjectType),
      subject,
      eq(agentKnowledgeTable.canonicalKey, input.canonicalKey),
      inArray(agentKnowledgeTable.approvalStatus, ["candidate", "approved"]),
    ));
    return rows.map(asKnowledge);
  }

  async createConflict(input: { knowledgeType: string; subjectType: string; subjectId: string | null; canonicalKey: string; knowledgeIds: number[]; memoryIds: number[]; summary: string }): Promise<void> {
    await db.insert(agentKnowledgeConflictsTable).values(input);
  }

  async supersedeMemory(id: number, supersededBy: number): Promise<void> {
    await db.update(agentMemoryTable).set({ status: "superseded", supersededBy }).where(eq(agentMemoryTable.id, id));
  }

  async insertFeedback(input: { actionType: string; entityType: string; entityId: string | null; originalValue: Record<string, unknown> | null; correctedValue: Record<string, unknown> | null; feedbackType: string; reason: string | null; userId: number; duplicateProjectId?: number | null; canonicalProjectId?: number | null }): Promise<{ id: number }> {
    const [row] = await db.insert(agentFeedbackTable).values(input).returning({ id: agentFeedbackTable.id });
    return row;
  }

  async insertEvent(input: { actionType: string; entityType: string; entityId: string | null; contextJson: Record<string, unknown>; outcome: string; durationMs?: number | null; sourceName?: string | null; projectCount?: number | null; expiresAt?: Date | null }): Promise<void> {
    await db.insert(agentLearningEventsTable).values(input);
  }

  async listDashboard(limit = 50) {
    const [memory, knowledge, feedback, conflicts, eventMetrics] = await Promise.all([
      db.select().from(agentMemoryTable).orderBy(desc(agentMemoryTable.lastSeenAt)).limit(limit),
      db.select().from(agentKnowledgeTable).orderBy(desc(agentKnowledgeTable.updatedAt)).limit(limit),
      db.select().from(agentFeedbackTable).orderBy(desc(agentFeedbackTable.createdAt)).limit(limit),
      db.select().from(agentKnowledgeConflictsTable).orderBy(desc(agentKnowledgeConflictsTable.createdAt)).limit(limit),
      db.select({ actionType: agentLearningEventsTable.actionType, outcome: agentLearningEventsTable.outcome, count: sql<number>`count(*)::int` })
        .from(agentLearningEventsTable)
        .groupBy(agentLearningEventsTable.actionType, agentLearningEventsTable.outcome),
    ]);
    return { memory, knowledge, feedback, conflicts, metrics: eventMetrics };
  }

  async listSourceReliability() {
    const rows = await db.select({
      sourceName: agentLearningEventsTable.sourceName,
      successes: sql<number>`count(*) filter (where ${agentLearningEventsTable.outcome} in ('success', 'empty'))::int`,
      failures: sql<number>`count(*) filter (where ${agentLearningEventsTable.outcome} in ('blocked', 'timeout', 'extraction-failed', 'error'))::int`,
      parserSuccesses: sql<number>`count(*) filter (where ${agentLearningEventsTable.outcome} = 'success')::int`,
      parserFailures: sql<number>`count(*) filter (where ${agentLearningEventsTable.outcome} = 'extraction-failed')::int`,
      fallbackSuccesses: sql<number>`count(*) filter (where ${agentLearningEventsTable.contextJson}->>'fallbackUsed' = 'true' and ${agentLearningEventsTable.outcome} = 'success')::int`,
      avgResponseMs: sql<number | null>`round(avg(${agentLearningEventsTable.durationMs}))::int`,
      qualifyingProjects: sql<number>`coalesce(sum(${agentLearningEventsTable.projectCount}), 0)::int`,
      lastSuccess: sql<Date | null>`max(${agentLearningEventsTable.createdAt}) filter (where ${agentLearningEventsTable.outcome} in ('success', 'empty'))`,
      lastFailure: sql<Date | null>`max(${agentLearningEventsTable.createdAt}) filter (where ${agentLearningEventsTable.outcome} in ('blocked', 'timeout', 'extraction-failed', 'error'))`,
    }).from(agentLearningEventsTable)
      .where(and(eq(agentLearningEventsTable.actionType, "source_scrape"), sql`${agentLearningEventsTable.sourceName} is not null`))
      .groupBy(agentLearningEventsTable.sourceName)
      .orderBy(agentLearningEventsTable.sourceName);
    return rows.map((row) => ({
      ...row,
      reliabilityScore: reliabilityScore(row),
    }));
  }

  async reviewKnowledge(id: number, decision: "approved" | "rejected", userId: number, reason?: string | null) {
    const now = new Date();
    if (decision === "approved") {
      const [conflict] = await db.select({ id: agentKnowledgeConflictsTable.id })
        .from(agentKnowledgeConflictsTable)
        .where(and(
          eq(agentKnowledgeConflictsTable.status, "open"),
          sql`${id} = any(${agentKnowledgeConflictsTable.knowledgeIds})`,
        )).limit(1);
      if (conflict) return null;
    }
    const [row] = await db.update(agentKnowledgeTable).set(decision === "approved" ? {
      approvalStatus: "approved",
      confidence: "high",
      approvedBy: userId,
      approvedAt: now,
      lastValidatedAt: now,
      updatedAt: now,
    } : {
      approvalStatus: "rejected",
      rejectedBy: userId,
      rejectedAt: now,
      rejectionReason: reason ?? null,
      updatedAt: now,
    }).where(and(eq(agentKnowledgeTable.id, id), eq(agentKnowledgeTable.approvalStatus, "candidate"))).returning();
    return row ? asKnowledge(row) : null;
  }

  async resolveConflict(id: number, input: { action: "select_preferred" | "reject_value" | "dismiss"; knowledgeId?: number; reason: string }, userId: number) {
    return db.transaction(async (tx) => {
      const [conflict] = await tx.select().from(agentKnowledgeConflictsTable)
        .where(and(eq(agentKnowledgeConflictsTable.id, id), eq(agentKnowledgeConflictsTable.status, "open")))
        .limit(1);
      if (!conflict) return null;
      const now = new Date();
      const plan = planConflictResolution(conflict.knowledgeIds, input.action, input.knowledgeId);
      if (!plan) return null;

      if (input.action === "dismiss") {
        const [updated] = await tx.update(agentKnowledgeConflictsTable).set({
          status: "dismissed", resolutionAction: input.action, resolution: input.reason,
          resolvedBy: userId, resolvedAt: now,
        }).where(eq(agentKnowledgeConflictsTable.id, id)).returning();
        return updated;
      }

      if (input.action === "reject_value") {
        const rejectedKnowledgeId = plan.rejectedKnowledgeIds[0];
        await tx.update(agentKnowledgeTable).set({
          approvalStatus: "rejected", rejectedBy: userId, rejectedAt: now,
          rejectionReason: input.reason, updatedAt: now,
        }).where(and(eq(agentKnowledgeTable.id, rejectedKnowledgeId), inArray(agentKnowledgeTable.approvalStatus, ["candidate", "approved"])));
        const [updated] = await tx.update(agentKnowledgeConflictsTable).set({
          resolutionAction: input.action, resolution: input.reason, resolvedBy: userId,
        }).where(eq(agentKnowledgeConflictsTable.id, id)).returning();
        return updated;
      }

      const selectedKnowledgeId = plan.selectedKnowledgeId!;
      await tx.update(agentKnowledgeTable).set({
        approvalStatus: "approved", confidence: "high", approvedBy: userId,
        approvedAt: now, lastValidatedAt: now, updatedAt: now,
      }).where(eq(agentKnowledgeTable.id, selectedKnowledgeId));
      const rejectedIds = plan.rejectedKnowledgeIds;
      if (rejectedIds.length) {
        await tx.update(agentKnowledgeTable).set({
          approvalStatus: "rejected", rejectedBy: userId, rejectedAt: now,
          rejectionReason: `Conflict resolved in favour of knowledge #${selectedKnowledgeId}: ${input.reason}`, updatedAt: now,
        }).where(inArray(agentKnowledgeTable.id, rejectedIds));
      }
      const [updated] = await tx.update(agentKnowledgeConflictsTable).set({
        status: "resolved", resolutionAction: input.action, resolution: input.reason,
        selectedKnowledgeId, resolvedBy: userId, resolvedAt: now,
      }).where(eq(agentKnowledgeConflictsTable.id, id)).returning();
      return updated;
    });
  }

  async updateKnowledge(id: number, input: { summary?: string; valueJson?: Record<string, unknown>; supersede?: boolean }) {
    const [row] = await db.update(agentKnowledgeTable).set({
      summary: input.summary,
      valueJson: input.valueJson,
      approvalStatus: input.supersede ? "superseded" : undefined,
      updatedAt: new Date(),
    }).where(eq(agentKnowledgeTable.id, id)).returning();
    return row ? asKnowledge(row) : null;
  }

  async pruneExpiredTransientData(): Promise<{ memory: number; events: number }> {
    const [memory, events] = await Promise.all([
      db.update(agentMemoryTable).set({ status: "expired" })
        .where(and(eq(agentMemoryTable.status, "active"), sql`${agentMemoryTable.expiresAt} <= now()`))
        .returning({ id: agentMemoryTable.id }),
      db.delete(agentLearningEventsTable).where(sql`${agentLearningEventsTable.expiresAt} <= now()`)
        .returning({ id: agentLearningEventsTable.id }),
    ]);
    return { memory: memory.length, events: events.length };
  }
}

export const postgresLearningRepository = new PostgresLearningRepository();
