export const MINIMUM_SOLAR_CAPACITY_MW = 5;

export interface ScanProjectEligibilityInput {
  name: string;
  description?: string | null;
  capacityMw: number | string | null | undefined;
  country?: string | null;
}

export type ProjectIneligibilityReason =
  | "outside-target-region"
  | "missing-capacity"
  | "below-minimum-capacity"
  | "wind-project"
  | "no-solar-component";

export interface ScanProjectLineage {
  projectId: number;
  isNew: boolean;
  eventType?: "new" | "updated" | "inventory_observed";
  effectiveDate?: string | null;
  dateEvidence?: string | null;
}

export type ScanProjectEventType = "new" | "updated" | "inventory_observed";

export function classifyScanProjectEvent(input: {
  isNew: boolean;
  dateEvidence?: string | null;
  eventType?: string | null;
}): ScanProjectEventType {
  if (input.isNew) return "new";
  if (input.eventType === "updated" || input.dateEvidence === "altenergy_watts_news_update") return "updated";
  return "inventory_observed";
}

export function isWindProject(
  name: string,
  description?: string | null,
): boolean {
  if (/wind\b/i.test(name)) return true;
  return (description ?? "").toLowerCase().includes("turbine");
}

export function hasSolarComponent(
  name: string,
  description?: string | null,
): boolean {
  return /\b(solar|photovoltaic|pv)\b/i.test(`${name} ${description ?? ""}`);
}

export function getProjectIneligibilityReason(
  project: ScanProjectEligibilityInput,
): ProjectIneligibilityReason | null {
  if (
    project.country != null &&
    project.country !== "AU" &&
    project.country !== "NZ"
  ) {
    return "outside-target-region";
  }

  const capacityMw =
    typeof project.capacityMw === "string" && project.capacityMw.trim() === ""
      ? Number.NaN
      : Number(project.capacityMw);
  if (project.capacityMw == null || !Number.isFinite(capacityMw)) {
    return "missing-capacity";
  }
  if (capacityMw < MINIMUM_SOLAR_CAPACITY_MW) {
    return "below-minimum-capacity";
  }
  if (isWindProject(project.name, project.description)) {
    return "wind-project";
  }
  if (!hasSolarComponent(project.name, project.description)) {
    return "no-solar-component";
  }

  return null;
}

export function isEligibleScanProject(
  project: ScanProjectEligibilityInput,
): boolean {
  return getProjectIneligibilityReason(project) === null;
}

export function filterEligibleScanProjects<
  T extends ScanProjectEligibilityInput,
>(projects: readonly T[]): T[] {
  return projects.filter(isEligibleScanProject);
}

export function summarizeScanLineage(lineage: readonly ScanProjectLineage[], options: { bounded?: boolean } = {}): {
  projectsFound: number;
  newProjects: number;
  updatedProjects: number;
  inventoryObservedCount: number;
} {
  const uniqueProjects = new Map<number, { eventType: ScanProjectEventType; effectiveDate: string | null; inventoryObservation: boolean }>();
  const rank: Record<ScanProjectEventType, number> = { inventory_observed: 0, updated: 1, new: 2 };
  for (const relation of lineage) {
    const eventType = classifyScanProjectEvent(relation);
    const prior = uniqueProjects.get(relation.projectId);
    const inventoryObservation = eventType === "inventory_observed" || relation.dateEvidence === "altenergy_inventory_observation";
    if (!prior || rank[eventType] > rank[prior.eventType]) {
      uniqueProjects.set(relation.projectId, { eventType, effectiveDate: relation.effectiveDate ?? null, inventoryObservation });
    } else if (inventoryObservation && !prior.inventoryObservation) {
      uniqueProjects.set(relation.projectId, { ...prior, inventoryObservation: true });
    }
  }

  const values = [...uniqueProjects.values()];
  const inventoryObservedCount = values.filter((item) => item.inventoryObservation).length;
  const periodResults = options.bounded
    ? values.filter((item) => item.eventType !== "inventory_observed" && item.effectiveDate != null)
    : values;

  return {
    projectsFound: periodResults.length,
    newProjects: periodResults.filter((item) => item.eventType === "new").length,
    updatedProjects: periodResults.filter((item) => item.eventType === "updated").length,
    inventoryObservedCount,
  };
}
