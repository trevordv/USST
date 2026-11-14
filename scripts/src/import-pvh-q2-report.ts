/**
 * Import the PVH quarterly report (Green Energy Markets solar PV lists) into USST.
 *
 * USST is the source of truth:
 *   - missing pipeline projects are added (approved, yet to be approved, under
 *     construction, in commissioning, PPA not committed, underwritten);
 *   - projects USST already has are enriched — blank fields only (developer,
 *     EPC/construction firm, location, description); nothing is overwritten;
 *   - uncertain matches go to a Review tab and are never inserted, so no
 *     project is duplicated.
 *
 * Dry run (default, read-only — writes only the Excel report):
 *   railway run pnpm --filter @workspace/scripts run import-pvh-q2-report -- --file="C:\path\PVH_Q2_Report.xlsx"
 * Apply after reviewing the report:
 *   railway run pnpm --filter @workspace/scripts run import-pvh-q2-report -- --file="C:\path\PVH_Q2_Report.xlsx" --apply
 *
 * The report workbook is commercial data: keep it outside the (public) repository.
 */
import path from "node:path";
import XLSX from "xlsx";
import { db, eq, projectsTable, sql } from "@workspace/db";
import {
  dedupeReport, findAmbiguousAdditions, matchToUsst, newProjectValues, parseReportRows, planEnrichment,
  reportDifferences, reportIneligibility, reportLocation, REPORT_SOURCE_NAME,
  type ReportProject, type UsstProject,
} from "./pvh-report-matching";

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=").replace(/^"|"$/g, "");
const apply = args.includes("--apply");
const file = option("file");
if (!file) {
  console.error('Usage: ... import-pvh-q2-report -- --file="path/to/PVH_Q2_Report.xlsx" [--apply] [--report=out.xlsx]');
  process.exit(2);
}
const reportPath = option("report") ?? path.join(path.dirname(file), `${path.basename(file, path.extname(file))} - USST import ${apply ? "applied" : "dry run"}.xlsx`);

const workbook = XLSX.readFile(file);
const sheets = workbook.SheetNames.map((name) => ({
  name, rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null }),
}));
const parsed = parseReportRows(sheets);
const reportProjects = dedupeReport(parsed);

type Row = Record<string, string | number | null>;
const base = (project: ReportProject): Row => ({
  "Report sheet": project.sheet, "Project": project.name, "Also known as": project.altNames.join("; ") || null,
  "State": project.state, "MW": project.capacityMw, "Owner": project.owner, "Report status": project.reportStatus,
  "Construction firm": project.epc, "Battery": project.battery,
});
const usstCols = (row: UsstProject): Row => ({
  "USST id": row.id, "USST name": row.name, "USST MW": Number(row.capacityMw), "USST developer": row.developer,
  "USST location": row.location, "USST status": row.status, "USST source": row.sourceName,
});

async function planImport(database: Pick<typeof db, "select">) {
  const usst: UsstProject[] = (await database.select({
    id: projectsTable.id, name: projectsTable.name, description: projectsTable.description,
    capacityMw: projectsTable.capacityMw, developer: projectsTable.developer, epc: projectsTable.epc,
    location: projectsTable.location, country: projectsTable.country, status: projectsTable.status,
    sourceName: projectsTable.sourceName,
  }).from(projectsTable)).map((row) => ({ ...row, country: row.country ?? "AU" }));

  const missing: ReportProject[] = [];
  const toEnrich: Array<{ project: ReportProject; usst: UsstProject; fields: ReturnType<typeof planEnrichment>; notes: string[] }> = [];
  const alreadyComplete: Row[] = [];
  const review: Row[] = [];
  const notImported: Row[] = [];
  const matchedIds = new Set<number>();

  for (const project of reportProjects) {
    const match = matchToUsst(project, usst);
    if (match.kind === "match") {
      if (matchedIds.has(match.usst.id)) {
        review.push({ ...base(project), "Reason": "another report row already matched this USST project", ...usstCols(match.usst) });
        continue;
      }
      matchedIds.add(match.usst.id);
      const fields = planEnrichment(match.usst, project);
      const notes = reportDifferences(match.usst, project);
      if (Object.keys(fields).length) toEnrich.push({ project, usst: match.usst, fields, notes });
      else alreadyComplete.push({ ...base(project), ...usstCols(match.usst), "Notes (not changed)": notes.join("; ") || null });
      continue;
    }
    if (match.kind === "review") {
      // Rows that would never be imported (operational, withdrawn...) are not review work.
      const ineligibleReview = reportIneligibility(project);
      if (ineligibleReview) { notImported.push({ ...base(project), "Reason": ineligibleReview }); continue; }
      review.push({
        ...base(project), "Reason": match.reason,
        "Possible USST matches": match.candidates.slice(0, 5).map((row) => `#${row.id} ${row.name} (${Number(row.capacityMw)} MW, ${row.location ?? "?"})`).join(" | ") || null,
      });
      continue;
    }
    const ineligible = reportIneligibility(project);
    if (ineligible) { notImported.push({ ...base(project), "Reason": ineligible }); continue; }
    missing.push(project);
  }

  const ambiguous = findAmbiguousAdditions(reportProjects);
  const toAdd = [];
  for (const project of missing) {
    if (ambiguous.has(project)) {
      review.push({ ...base(project), "Reason": "report contains an overlapping name, alias or stage" });
    } else {
      toAdd.push({ project, values: newProjectValues(project) });
    }
  }

  return { usstCount: usst.length, toAdd, toEnrich, alreadyComplete, review, notImported };
}

async function applyImport() {
  return db.transaction(async (tx) => {
    // Plan under the same lock as the writes so another import or project writer
    // cannot invalidate the duplicate checks or fill a blank field mid-import.
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`lock table ${projectsTable} in share row exclusive mode`);
    const plan = await planImport(tx);
    const now = new Date();
    for (const { values } of plan.toAdd) {
      await tx.insert(projectsTable).values({ ...values, lastSeenAt: now });
    }
    for (const { usst: row, fields } of plan.toEnrich) {
      await tx.update(projectsTable).set({ ...fields, updatedAt: now }).where(eq(projectsTable.id, row.id));
    }
    return plan;
  }, { isolationLevel: "read committed" });
}

const { usstCount, toAdd, toEnrich, alreadyComplete, review, notImported } =
  await (apply ? applyImport() : planImport(db));

const out = XLSX.utils.book_new();
const summary = [
  ["USST import of PVH Q2 report", apply ? "APPLIED" : "DRY RUN — nothing written"],
  ["Report rows read", parsed.length],
  ["After merging duplicates inside the report", reportProjects.length],
  ["USST projects before import", usstCount],
  ["Missing pipeline projects " + (apply ? "added" : "to add"), toAdd.length],
  ["Existing USST projects " + (apply ? "enriched" : "to enrich (blank fields only)"), toEnrich.length],
  ["Already in USST, nothing to add", alreadyComplete.length],
  ["Needs review (not imported)", review.length],
  ["Not imported (status or eligibility)", notImported.length],
  ["New projects' source name", REPORT_SOURCE_NAME],
];
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(summary), "Summary");
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(toAdd.map(({ project, values }) => ({
  ...base(project), "USST status": values.status, "USST location": reportLocation(project),
}))), apply ? "Added" : "To add");
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(toEnrich.map(({ project, usst: row, fields, notes }) => ({
  ...usstCols(row), "Report project": project.name, "Report sheet": project.sheet,
  "Fill developer": fields.developer ?? null, "Fill EPC": fields.epc ?? null, "Fill location": fields.location ?? null,
  "Fill description": fields.description ?? null, "Notes (not changed)": notes.join("; ") || null,
}))), apply ? "Enriched" : "To enrich");
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(review), "Review");
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(alreadyComplete), "Already complete");
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(notImported), "Not imported");
try {
  XLSX.writeFile(out, reportPath);
} catch (error) {
  if (apply) {
    console.error(`Database changes committed: ${toAdd.length} added and ${toEnrich.length} enriched. Could not write the report.`);
  }
  throw error;
}

console.log(summary.map(([label, value]) => `${label}: ${value}`).join("\n"));
if (apply) console.log(`\nWrote ${toAdd.length} new and ${toEnrich.length} enriched projects.`);
else console.log("\nDry run only. Review the report, then re-run with --apply.");
console.log(`Report: ${reportPath}`);
process.exit(0);
