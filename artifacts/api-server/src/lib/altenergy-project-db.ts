export interface AltEnergyProjectDbRecord {
  id: number;
  energy_id: number;
  type?: string | null;
  project_name?: string | null;
  country?: string | null;
  capacity?: string | number | null;
  capacity_mwh?: string | number | null;
  description?: string | null;
  developer?: string | null;
  owner?: string | null;
  location?: string | null;
  state?: string | null;
  status?: string | null;
  updated_at?: string | null;
}

export type AltEnergyProjectDbSkipReason =
  | "skipped_name"
  | "skipped_energy_type"
  | "skipped_status"
  | "skipped_capacity"
  | "skipped_country"
  | "skipped_date_window";

export type AltEnergyProjectDbOutcome = AltEnergyProjectDbSkipReason | "accepted";

export interface AltEnergyProjectDbDecision {
  outcome: AltEnergyProjectDbOutcome;
  capacityMw: number | null;
  country: "AU" | "NZ" | null;
  sourceUpdatedDate: string | null;
}

/**
 * AltEnergy technology IDs observed in the project database.
 *
 * 1 = Solar PV and 9 = Solar Thermal. ID 4 remains in the established
 * solar-related allow-list but requires an explicit solar signal because its
 * source label has not been verified. Live AltEnergy data confirms ID 5 is
 * standalone BESS and must remain excluded.
 */
export const ALTENERGY_SOLAR_ENERGY_IDS = new Set([1, 4, 9]);
export const ALTENERGY_WIND_ENERGY_IDS = new Set([2, 3]);
export const ALTENERGY_BATTERY_ENERGY_IDS = new Set([5]);

const INELIGIBLE_STATUS_RE = /\b(?:generating|operational|operating|commissioned|cancelled|canceled|withdrawn|decommissioned)\b/i;
const ELIGIBLE_STATUS_RE = /\b(?:in development|under development|announced|planning|proposed|approved|fid|under construction|commissioning|grid connection)\b/i;
const SOLAR_RE = /\b(?:solar|photovoltaic|pv)\b/i;
const WIND_RE = /\b(?:wind|turbine)\b/i;

export function parseAltEnergyCapacityMw(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAltEnergySourceUpdatedDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}

export function normalizeAltEnergyCountry(value: string | null | undefined): "AU" | "NZ" | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["au", "aus", "australia"].includes(normalized)) return "AU";
  if (["nz", "new zealand", "aotearoa new zealand"].includes(normalized)) return "NZ";
  return null;
}

export function classifyAltEnergyProjectDbRecord(
  record: AltEnergyProjectDbRecord,
  window: { startDate?: string | null; endDate?: string | null } = {},
): AltEnergyProjectDbDecision {
  const capacityMw = parseAltEnergyCapacityMw(record.capacity);
  const country = normalizeAltEnergyCountry(record.country);
  const sourceUpdatedDate = parseAltEnergySourceUpdatedDate(record.updated_at);
  const result = (outcome: AltEnergyProjectDbOutcome): AltEnergyProjectDbDecision => ({
    outcome,
    capacityMw,
    country,
    sourceUpdatedDate,
  });

  const name = (record.project_name ?? "").trim();
  if (!name) return result("skipped_name");

  const technologyText = `${name} ${record.description ?? ""}`;
  const knownSolarTechnology = ALTENERGY_SOLAR_ENERGY_IDS.has(record.energy_id);
  const explicitSolarTechnology = SOLAR_RE.test(technologyText) && !WIND_RE.test(technologyText);
  if (
    ALTENERGY_WIND_ENERGY_IDS.has(record.energy_id) ||
    ALTENERGY_BATTERY_ENERGY_IDS.has(record.energy_id) ||
    !knownSolarTechnology ||
    (record.energy_id === 4 && !explicitSolarTechnology)
  ) {
    return result("skipped_energy_type");
  }

  const lifecycle = `${record.type ?? ""} ${record.status ?? ""}`.trim();
  if (INELIGIBLE_STATUS_RE.test(lifecycle) || !ELIGIBLE_STATUS_RE.test(lifecycle)) {
    return result("skipped_status");
  }

  if (capacityMw == null || capacityMw < 5) return result("skipped_capacity");
  if (country == null) return result("skipped_country");

  if (window.startDate || window.endDate) {
    if (
      sourceUpdatedDate == null ||
      (window.startDate && sourceUpdatedDate < window.startDate) ||
      (window.endDate && sourceUpdatedDate > window.endDate)
    ) {
      return result("skipped_date_window");
    }
  }

  return result("accepted");
}

export function createAltEnergyProjectDbDiagnostics(): Record<AltEnergyProjectDbOutcome, number> {
  return {
    skipped_name: 0,
    skipped_energy_type: 0,
    skipped_status: 0,
    skipped_capacity: 0,
    skipped_country: 0,
    skipped_date_window: 0,
    accepted: 0,
  };
}
