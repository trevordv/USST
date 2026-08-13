export type ConflictResolutionAction = "select_preferred" | "reject_value" | "dismiss";

export function planConflictResolution(
  knowledgeIds: number[],
  action: ConflictResolutionAction,
  knowledgeId?: number,
): { status: "open" | "resolved" | "dismissed"; selectedKnowledgeId: number | null; rejectedKnowledgeIds: number[] } | null {
  if (action === "dismiss") return { status: "dismissed", selectedKnowledgeId: null, rejectedKnowledgeIds: [] };
  if (!knowledgeId || !knowledgeIds.includes(knowledgeId)) return null;
  if (action === "reject_value") return { status: "open", selectedKnowledgeId: null, rejectedKnowledgeIds: [knowledgeId] };
  return {
    status: "resolved",
    selectedKnowledgeId: knowledgeId,
    rejectedKnowledgeIds: knowledgeIds.filter((id) => id !== knowledgeId),
  };
}
