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

// Publication names are not technology evidence ("pv magazine reports a
// 750 MW battery" is a battery article).
const PUBLICATION_NAME_RE = /\bpv[\s-]?(?:magazine|tech)\b/gi;
// Turbines that are not wind turbines.
const NON_WIND_TURBINE_RE = /\b(?:gas|steam|hydro|diesel|water|combustion)\s+turbines?\b/gi;
const SOLAR_RE = /\b(?:solar|photovoltaic|pv)\b/i;
const SOLAR_WIND_HYBRID_RE = /\b(?:wind\s*(?:and|&|\+|-|\/)\s*solar|solar\s*(?:and|&|\+|-|\/)\s*wind)\b/i;
const WIND_TECHNOLOGY_RE = /\bwind\s+(?:farm|turbines?|project|energy|generation|power)\b|\bturbines?\b/i;
const STORAGE_NAME_RE = /\b(?:bess|battery|batteries|energy\s+storage|storage)\b/i;
const SOLAR_STORAGE_PAIRING_RE = new RegExp([
  "\\b(?:solar|pv)\\b[^.]{0,40}\\b(?:and|plus|with|co-?located|colocated|paired)\\b[^.]{0,40}\\b(?:battery|bess|storage)\\b",
  "(?:solar|pv)\\s*[&+/]\\s*(?:battery|bess|storage)",
  "\\b(?:battery|bess|storage)\\b[^.]{0,40}\\b(?:and|plus|with|paired)\\b[^.]{0,25}\\b(?:solar|pv)\\b",
  "(?:battery|bess|storage)\\s*[&+/]\\s*(?:solar|pv)",
  "\\bhybrid\\b",
].join("|"), "i");

function technologyText(text: string | null | undefined): string {
  return (text ?? "").replace(PUBLICATION_NAME_RE, " ");
}

/**
 * Wind (including wind + BESS and wind/solar hybrids) is excluded. A project
 * named as solar is not reclassified because its description mentions nearby
 * wind turbines or a gas turbine.
 */
export function isWindProject(
  name: string,
  description?: string | null,
): boolean {
  if (/wind\b/i.test(name)) return true;
  const text = technologyText(description).replace(NON_WIND_TURBINE_RE, " ");
  if (SOLAR_WIND_HYBRID_RE.test(text)) return true;
  if (SOLAR_RE.test(technologyText(name))) return false;
  return WIND_TECHNOLOGY_RE.test(text);
}

export function hasSolarComponent(
  name: string,
  description?: string | null,
): boolean {
  return SOLAR_RE.test(technologyText(`${name} ${description ?? ""}`));
}

/**
 * A project named as a battery/storage asset is standalone storage unless the
 * text pairs it with solar as part of the same project. A battery merely built
 * "next to an existing solar farm" is still standalone storage.
 */
export function isStandaloneStorageProject(
  name: string,
  description?: string | null,
): boolean {
  const cleanName = technologyText(name);
  if (SOLAR_RE.test(cleanName) || !STORAGE_NAME_RE.test(cleanName)) return false;
  return !SOLAR_STORAGE_PAIRING_RE.test(technologyText(description));
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
  if (
    !hasSolarComponent(project.name, project.description) ||
    isStandaloneStorageProject(project.name, project.description)
  ) {
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

export type ScanRejectionReason = ProjectIneligibilityReason | "noisy-name";

export interface ScanRejectionSummaryValue {
  totalRejected: number;
  "noisy-name": number;
  "outside-target-region": number;
  "missing-capacity": number;
  "below-minimum-capacity": number;
  "wind-project": number;
  "no-solar-component": number;
  topMissingCapacitySources: { sourceName: string; count: number }[];
}

/** Scan-wide tally of candidates dropped at the pre-insert quality gate. */
export class ScanRejectionTally {
  private readonly counts = new Map<ScanRejectionReason, number>();
  private readonly missingCapacityBySource = new Map<string, number>();

  record(reason: ScanRejectionReason, sourceName: string | null | undefined): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    if (reason === "missing-capacity") {
      const name = sourceName?.trim() || "Unknown source";
      this.missingCapacityBySource.set(name, (this.missingCapacityBySource.get(name) ?? 0) + 1);
    }
  }

  summary(topSources = 5): ScanRejectionSummaryValue {
    const count = (reason: ScanRejectionReason) => this.counts.get(reason) ?? 0;
    return {
      totalRejected: [...this.counts.values()].reduce((sum, value) => sum + value, 0),
      "noisy-name": count("noisy-name"),
      "outside-target-region": count("outside-target-region"),
      "missing-capacity": count("missing-capacity"),
      "below-minimum-capacity": count("below-minimum-capacity"),
      "wind-project": count("wind-project"),
      "no-solar-component": count("no-solar-component"),
      topMissingCapacitySources: [...this.missingCapacityBySource.entries()]
        .map(([sourceName, value]) => ({ sourceName, count: value }))
        .sort((a, b) => b.count - a.count || a.sourceName.localeCompare(b.sourceName))
        .slice(0, topSources),
    };
  }
}
