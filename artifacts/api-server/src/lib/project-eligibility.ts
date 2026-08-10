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

export function summarizeScanLineage(lineage: readonly ScanProjectLineage[]): {
  projectsFound: number;
  newProjects: number;
} {
  const uniqueProjects = new Map<number, boolean>();
  for (const relation of lineage) {
    uniqueProjects.set(
      relation.projectId,
      (uniqueProjects.get(relation.projectId) ?? false) || relation.isNew,
    );
  }

  return {
    projectsFound: uniqueProjects.size,
    newProjects: [...uniqueProjects.values()].filter(Boolean).length,
  };
}
