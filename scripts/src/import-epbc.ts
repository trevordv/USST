/**
 * One-off script: import EPBC Public Portal solar project data from an xlsx download.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run import-epbc
 *
 * The xlsx file is expected at:
 *   attached_assets/EPBC_Public_portal-Solar_only_<timestamp>.xlsx
 *
 * Columns in the sheet:
 *   EPBC Number | Project | Proposer/Approval Holder | Location | Industry Type | Valid Date | Project Status | Primary Jurisdiction
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import xlsx from "xlsx";
import { db, projectsTable } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../");

// ── Find the XLSX file ────────────────────────────────────────────────────────

function findXlsx(): string {
  const dir = path.join(WORKSPACE_ROOT, "attached_assets");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("EPBC_Public_portal") && f.endsWith(".xlsx"));
  if (files.length === 0) throw new Error(`No EPBC xlsx file found in ${dir}`);
  files.sort(); // pick latest if multiple
  return path.join(dir, files[files.length - 1]);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Convert Excel serial date number to YYYY-MM-DD string. */
function excelDateToIso(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0, 10);
}

// ── Status mapping ────────────────────────────────────────────────────────────

const SKIP_STATUSES = new Set([
  "Project Withdrawn",
  "Clearly Unacceptable",
  "Project Lapsed",
]);

function mapStatus(epbcStatus: string): "announced" | "under_development" {
  const s = epbcStatus.toLowerCase();
  if (
    s.includes("under assessment") ||
    s.includes("guidelines issued") ||
    s.includes("assessment approach determined") ||
    s.includes("assessment commenced") ||
    s.includes("considering variation") ||
    s.includes("approval decision") ||
    s.includes("condition variation") ||
    s.includes("final preliminary") ||
    s.includes("considering final decision")
  ) {
    return "under_development";
  }
  return "announced";
}

// ── State/jurisdiction → country ──────────────────────────────────────────────

const NZ_JURISDICTIONS = new Set(["new zealand"]);

function jurisdictionToCountry(jurisdiction: string): "AU" | "NZ" {
  return NZ_JURISDICTIONS.has(jurisdiction.toLowerCase()) ? "NZ" : "AU";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const xlsxPath = findXlsx();
  console.log(`Reading: ${xlsxPath}`);

  const wb = xlsx.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

  console.log(`Rows in sheet: ${rows.length}`);

  // Load existing project names for deduplication (case-insensitive)
  const existing = await db.select({ name: projectsTable.name }).from(projectsTable);
  const existingNames = new Set(existing.map((p) => p.name.toLowerCase().trim()));
  console.log(`Existing projects in DB: ${existingNames.size}`);

  let inserted = 0;
  let skipped = 0;
  let duplicate = 0;
  let noName = 0;

  for (const row of rows) {
    const epbcNumber = String(row["EPBC Number"] ?? "").trim();
    const rawName = String(row["Project"] ?? "").trim();
    const developer = String(row["Proposer/Approval Holder"] ?? "").trim();
    const location = String(row["Location"] ?? "").trim();
    const jurisdiction = String(row["Primary Jurisdiction"] ?? "").trim();
    const epbcStatus = String(row["Project Status"] ?? "").trim();
    const validDateRaw = row["Valid Date"];

    // Skip empty names
    if (!rawName) { noName++; continue; }

    // Skip withdrawn / lapsed / clearly unacceptable
    if (SKIP_STATUSES.has(epbcStatus)) { skipped++; continue; }

    // Deduplicate by name
    if (existingNames.has(rawName.toLowerCase())) { duplicate++; continue; }

    // Date
    let announcedDate = new Date().toISOString().slice(0, 10);
    if (typeof validDateRaw === "number" && validDateRaw > 1) {
      announcedDate = excelDateToIso(validDateRaw);
    } else if (typeof validDateRaw === "string" && validDateRaw.length >= 8) {
      const d = new Date(validDateRaw);
      if (!isNaN(d.getTime())) announcedDate = d.toISOString().slice(0, 10);
    }

    const country = jurisdictionToCountry(jurisdiction);
    const status = mapStatus(epbcStatus);

    // Source URL using EPBC number (referral detail page)
    const sourceUrl = epbcNumber
      ? `https://epbcpublicportal.environment.gov.au/referral/detail/${encodeURIComponent(epbcNumber)}`
      : "https://epbcpublicportal.environment.gov.au/all-referrals/";

    await db.insert(projectsTable).values({
      name: rawName,
      description: `EPBC Referral ${epbcNumber}. Status: ${epbcStatus}. Jurisdiction: ${jurisdiction}.`,
      capacityMw: "0",           // unknown — EPBC listing does not include MW
      developer: developer || null,
      location: location || null,
      country,
      status,
      sourceUrl,
      sourceName: "EPBC Public Portal",
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      scanId: null,
    });

    existingNames.add(rawName.toLowerCase()); // prevent duplicates within the same file
    inserted++;
  }

  console.log("\n── Import complete ──────────────────────────────");
  console.log(`  Inserted : ${inserted}`);
  console.log(`  Skipped  : ${skipped}  (withdrawn / lapsed / unacceptable)`);
  console.log(`  Duplicate: ${duplicate}  (name already in DB)`);
  console.log(`  No name  : ${noName}`);
  console.log("────────────────────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
