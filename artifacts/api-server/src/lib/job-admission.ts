export type CostlyOperation = "scan" | "enrichment" | "epbc-sync" | "project-research";

const COOLDOWN_MS = 15_000;
const active = new Set<CostlyOperation>();
const lastStartedByUser = new Map<string, number>();

export function admitCostlyOperation(operation: CostlyOperation, userId: number, now = Date.now()): { release: () => void } | null {
  const key = `${operation}:${userId}`;
  const lastStarted = lastStartedByUser.get(key);
  if (active.has(operation) || (lastStarted != null && now - lastStarted < COOLDOWN_MS)) return null;
  active.add(operation);
  lastStartedByUser.set(key, now);
  return { release: () => active.delete(operation) };
}

export function resetCostlyOperationAdmissionForTests(): void {
  active.clear();
  lastStartedByUser.clear();
}
