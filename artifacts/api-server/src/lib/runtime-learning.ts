import type { AgentContext } from "./agent-context-builder.ts";
import type { KnowledgeRecord } from "./memory-service.ts";

export interface RuntimeProjectCandidate {
  name: string;
  developer?: string | null;
  location?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
}

export interface RuntimeLearningDecision {
  rejectAsFalsePositive: boolean;
  canonicalDeveloper: string | null;
  originalDeveloper: string | null;
  duplicateProjectId: number | null;
  appliedKnowledgeIds: number[];
  events: Array<"knowledge_reused" | "false_positive_avoided" | "alias_applied" | "duplicate_candidate_matched">;
}

export function normalizeLearningSubject(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\bstage\s+(ii|2)\b/g, "stage 2")
    .replace(/\bstage\s+(iii|3)\b/g, "stage 3")
    .replace(/\bstage\s+(iv|4)\b/g, "stage 4")
    .replace(/\bpty\.?\s+ltd\.?\b/g, "")
    .replace(/\b(project|farm|development)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function sourceDomain(value: string | null | undefined): string {
  if (!value) return "";
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function learningSubjectIds(project: RuntimeProjectCandidate): string[] {
  return [...new Set([
    normalizeLearningSubject(project.name),
    normalizeLearningSubject(project.developer),
    normalizeLearningSubject(project.location),
    normalizeLearningSubject(project.sourceName),
    sourceDomain(project.sourceUrl),
  ].filter(Boolean))];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}

function scopeCorroborates(candidate: RuntimeProjectCandidate, value: Record<string, unknown>): boolean {
  const candidateDomain = sourceDomain(candidate.sourceUrl);
  const checks = [
    text(value.sourceName) && normalizeLearningSubject(text(value.sourceName)) === normalizeLearningSubject(candidate.sourceName),
    text(value.sourceDomain) && text(value.sourceDomain).toLowerCase() === candidateDomain,
    text(value.developer) && normalizeLearningSubject(text(value.developer)) === normalizeLearningSubject(candidate.developer),
    text(value.location) && normalizeLearningSubject(text(value.location)) === normalizeLearningSubject(candidate.location),
  ];
  return checks.some(Boolean);
}

function approved(context: AgentContext, type: string): KnowledgeRecord[] {
  return context.knowledge.filter((item) => item.approvalStatus === "approved" && item.knowledgeType === type);
}

export function applyRuntimeLearning(candidate: RuntimeProjectCandidate, context: AgentContext): RuntimeLearningDecision {
  const normalizedName = normalizeLearningSubject(candidate.name);
  const normalizedDeveloper = normalizeLearningSubject(candidate.developer);
  const applied = new Set<number>();
  const events = new Set<RuntimeLearningDecision["events"][number]>();

  const falsePositive = approved(context, "known_false_positive_pattern").find((item) => {
    const value = item.valueJson;
    const pattern = normalizeLearningSubject(text(value.projectPattern) || item.subjectId || "");
    return pattern.length >= 4 && pattern === normalizedName && scopeCorroborates(candidate, value);
  });
  if (falsePositive) {
    applied.add(falsePositive.id);
    events.add("knowledge_reused");
    events.add("false_positive_avoided");
  }

  let canonicalDeveloper = candidate.developer ?? null;
  const developerAlias = approved(context, "developer_alias").find((item) => {
    const alias = normalizeLearningSubject(text(item.valueJson.alias) || item.subjectId || "");
    return alias.length > 0 && alias === normalizedDeveloper && text(item.valueJson.canonicalDeveloper).length > 0;
  });
  if (developerAlias) {
    canonicalDeveloper = text(developerAlias.valueJson.canonicalDeveloper);
    applied.add(developerAlias.id);
    events.add("knowledge_reused");
    events.add("alias_applied");
  }

  const projectAlias = approved(context, "project_alias").find((item) => {
    const alias = normalizeLearningSubject(text(item.valueJson.alias) || item.subjectId || "");
    return alias.length >= 4 && alias === normalizedName && scopeCorroborates({ ...candidate, developer: canonicalDeveloper }, item.valueJson);
  });
  let duplicateProjectId = projectAlias ? number(projectAlias.valueJson.canonicalProjectId) : null;

  if (!duplicateProjectId) {
    const relationship = approved(context, "project_relationship").find((item) => {
      const duplicateName = normalizeLearningSubject(text(item.valueJson.duplicateName));
      return duplicateName.length >= 4 && duplicateName === normalizedName && scopeCorroborates({ ...candidate, developer: canonicalDeveloper }, item.valueJson);
    });
    if (relationship) {
      duplicateProjectId = number(relationship.valueJson.canonicalProjectId);
      if (duplicateProjectId) {
        applied.add(relationship.id);
        events.add("knowledge_reused");
        events.add("duplicate_candidate_matched");
      }
    }
  } else if (projectAlias) {
    applied.add(projectAlias.id);
    events.add("knowledge_reused");
    events.add("alias_applied");
    events.add("duplicate_candidate_matched");
  }

  return {
    rejectAsFalsePositive: Boolean(falsePositive),
    canonicalDeveloper,
    originalDeveloper: candidate.developer ?? null,
    duplicateProjectId,
    appliedKnowledgeIds: [...applied],
    events: [...events],
  };
}
