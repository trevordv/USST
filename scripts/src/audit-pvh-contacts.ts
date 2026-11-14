/**
 * Find (and optionally clear) project contacts that were copied from the PVH
 * contacts list for a *different* company.
 *
 * Before 2026-10-16 the scan-time PVH fallback matched company names by
 * substring/word overlap, so e.g. "Spark Renewables" received Ark Energy's
 * contact. Such contacts were then reused for later projects of the same
 * developer. This script flags every project whose contact email is a PVH
 * email belonging to an organisation that does not exactly match the project's
 * developer (same normalisation as the scanner's exact matcher).
 *
 * Dry run (default, read-only):   pnpm --filter @workspace/scripts run audit-pvh-contacts
 * Clear flagged contact fields:    pnpm --filter @workspace/scripts run audit-pvh-contacts -- --apply
 */
import { db, projectsTable, pvhContactsTable, eq } from "@workspace/db";

const COMMON_ORG_WORDS = new Set([
  "pty", "ltd", "limited", "group", "holdings", "inc", "corp", "co", "company", "australia",
  "energy", "solar", "power", "renewables", "renewable", "green", "clean", "au", "nz",
]);

// Keep identical to normalizeKnownOrganization in api-server/src/lib/contact-fallback.ts.
function normalizeOrganization(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((word) => word && !COMMON_ORG_WORDS.has(word)).join(" ");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const pvh = await db.select().from(pvhContactsTable);
  const orgsByEmail = new Map<string, Set<string>>();
  for (const row of pvh) {
    if (!row.email1 || !row.organizationName) continue;
    const email = row.email1.trim().toLowerCase();
    const orgs = orgsByEmail.get(email) ?? new Set<string>();
    orgs.add(normalizeOrganization(row.organizationName));
    orgsByEmail.set(email, orgs);
  }

  const projects = await db.select({
    id: projectsTable.id, name: projectsTable.name, developer: projectsTable.developer,
    contactName: projectsTable.contactName, contactEmail: projectsTable.contactEmail,
  }).from(projectsTable);

  const flagged = projects.filter((project) => {
    const email = project.contactEmail?.trim().toLowerCase();
    if (!email) return false;
    const orgs = orgsByEmail.get(email);
    if (!orgs) return false; // not a PVH contact (e.g. Lusha or manually entered)
    return !orgs.has(normalizeOrganization(project.developer));
  });

  console.log(`Checked ${projects.length} projects; ${flagged.length} carry a PVH contact from a different company.`);
  for (const project of flagged) {
    console.log(`#${project.id}\t${project.name}\tdeveloper=${project.developer ?? "(none)"}\tcontact=${project.contactName ?? ""} <${project.contactEmail}>`);
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to clear contactName/contactEmail/contactPhone on these rows.");
    return;
  }
  for (const project of flagged) {
    await db.update(projectsTable)
      .set({ contactName: null, contactEmail: null, contactPhone: null, updatedAt: new Date() })
      .where(eq(projectsTable.id, project.id));
  }
  console.log(`Cleared contact fields on ${flagged.length} projects.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
