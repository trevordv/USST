import { HARD_BUSINESS_RULES } from "./learning-policy.ts";
import type { LearningRepository, MemoryRecord, KnowledgeRecord } from "./memory-service.ts";
import { learningSubjectIds, type RuntimeProjectCandidate } from "./runtime-learning.ts";

export interface AgentContext {
  hardRules: readonly string[];
  knowledge: KnowledgeRecord[];
  memory: MemoryRecord[];
  taskData: Record<string, unknown>;
}

export async function buildAgentContext(
  repository: LearningRepository,
  input: {
    task: string;
    project?: ({ id?: number } & RuntimeProjectCandidate);
    source?: string;
    developer?: string | null;
    taskData?: Record<string, unknown>;
  },
): Promise<AgentContext> {
  const subjectIds = [...new Set([
    input.project?.id,
    ...(input.project ? learningSubjectIds(input.project) : []),
    input.source?.toLowerCase().trim(),
    input.developer?.toLowerCase().trim(),
  ].filter((value): value is string | number => value != null && value !== "").map(String))];
  const [memory, knowledge] = await Promise.all([
    repository.findMemories({ subjectIds, statuses: ["active", "candidate"], limit: 20 }),
    repository.findKnowledge({ subjectIds, approvalStatuses: ["approved"], limit: 20 }),
  ]);
  return {
    hardRules: HARD_BUSINESS_RULES,
    knowledge,
    memory,
    taskData: { task: input.task, project: input.project, source: input.source, developer: input.developer, ...input.taskData },
  };
}
