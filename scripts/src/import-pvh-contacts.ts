import { readFileSync } from "fs";
import { join } from "path";
import { db, pvhContactsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const CSV_PATH = join(process.cwd(), "../../attached_assets/PVH_Contacts_1781492355787.CSV");

function parseCSV(raw: string) {
  const lines = raw.split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

async function main() {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const rows = parseCSV(raw);

  await db.execute(sql`TRUNCATE TABLE pvh_contacts RESTART IDENTITY`);

  let inserted = 0;
  const batch: (typeof pvhContactsTable.$inferInsert)[] = [];

  for (const row of rows) {
    const email1 = row["E-mail 1 - Value"]?.trim() || null;
    const email2 = row["E-mail 2 - Value"]?.trim() || null;
    const orgName = row["Organization Name"]?.trim() || null;

    if (!email1 && !email2) continue;

    batch.push({
      firstName: row["First Name"]?.trim() || null,
      middleName: row["Middle Name"]?.trim() || null,
      lastName: row["Last Name"]?.trim() || null,
      organizationName: orgName,
      organizationTitle: row["Organization Title"]?.trim() || null,
      email1: email1,
      email2: email2,
    });
  }

  if (batch.length > 0) {
    await db.insert(pvhContactsTable).values(batch);
    inserted = batch.length;
  }

  console.log(`Imported ${inserted} contacts into pvh_contacts table`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
