import {
  braveWebSearch,
  type BraveSearchPurpose,
  type BraveSearchResult,
  type BraveWebSearchInput,
} from "./brave-search.ts";

export interface BraveResearchInput {
  purpose: BraveSearchPurpose;
  country?: "AU" | "NZ" | string | null;
  projectName?: string | null;
  developer?: string | null;
  location?: string | null;
  capacityMw?: number | string | null;
}

export interface BraveResearchEvidence {
  title: string;
  url: string;
  source: string;
  description: string | null;
  searchedAt: string;
  queryHash: string;
  purpose: BraveSearchPurpose;
}

interface BraveResearchDependencies {
  search?: (input: BraveWebSearchInput) => Promise<BraveSearchResult[]>;
}

function compact(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function buildResearchQuery(input: BraveResearchInput, country: "AU" | "NZ"): string | null {
  const geography = country === "NZ" ? "New Zealand" : "Australia";
  const projectName = compact(input.projectName, 120);
  const developer = compact(input.developer, 100);
  const location = compact(input.location, 100);
  const capacity = compact(input.capacityMw, 20);

  if (input.purpose === "project_corroboration") {
    if (!projectName) return null;
    return [
      `"${projectName}"`,
      developer ? `"${developer}"` : null,
      location,
      capacity ? `${capacity} MW` : null,
      "solar project",
      geography,
    ].filter(Boolean).join(" ");
  }
  if (!developer) return null;
  if (input.purpose === "contact_research") {
    return `"${developer}" official contact team ${geography}`;
  }
  return `"${developer}" official website solar ${geography}`;
}

export async function researchWithBrave(
  input: BraveResearchInput,
  dependencies: BraveResearchDependencies = {},
): Promise<BraveResearchEvidence[]> {
  const country = input.country === "NZ" ? "NZ" : "AU";
  const query = buildResearchQuery(input, country);
  if (!query) return [];
  const results = await (dependencies.search ?? braveWebSearch)({
    query,
    country,
    count: 5,
    purpose: input.purpose,
  });
  return results.slice(0, 5).map((result) => ({
    title: result.title,
    url: result.url,
    source: result.source,
    description: result.description,
    searchedAt: result.provenance.searchedAt,
    queryHash: result.provenance.queryHash,
    purpose: result.provenance.purpose,
  }));
}

export function researchProjectWithBrave(
  project: Omit<BraveResearchInput, "purpose">,
  dependencies: BraveResearchDependencies = {},
): Promise<BraveResearchEvidence[]> {
  return researchWithBrave({ ...project, purpose: "project_corroboration" }, dependencies);
}

export function researchDeveloperWithBrave(
  developer: string,
  country: "AU" | "NZ" = "AU",
  purpose: Extract<BraveSearchPurpose, "developer_website_discovery" | "contact_research"> = "developer_website_discovery",
  dependencies: BraveResearchDependencies = {},
): Promise<BraveResearchEvidence[]> {
  return researchWithBrave({ developer, country, purpose }, dependencies);
}
