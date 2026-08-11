import app from "./app";
import { logger } from "./lib/logger";
import { db, scansTable, contactEnrichmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logIntegrationConfiguration } from "./lib/integration-diagnostics";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

logIntegrationConfiguration();

/**
 * On startup, mark any scans or enrichment runs that were left in "running"
 * state as failed. This happens when the server is restarted mid-scan.
 */
async function recoverStaleJobs(): Promise<void> {
  try {
    const staleScans = await db
      .update(scansTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Scan interrupted — server restarted while scan was in progress. Please start a new scan.",
      })
      .where(eq(scansTable.status, "running"))
      .returning({ id: scansTable.id });

    if (staleScans.length > 0) {
      logger.warn(
        { scanIds: staleScans.map((s) => s.id) },
        "Marked stale running scans as failed on startup"
      );
    }

    const staleEnrichments = await db
      .update(contactEnrichmentsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Enrichment interrupted — server restarted. Please re-run contact enrichment.",
      })
      .where(eq(contactEnrichmentsTable.status, "running"))
      .returning({ id: contactEnrichmentsTable.id });

    if (staleEnrichments.length > 0) {
      logger.warn(
        { enrichmentIds: staleEnrichments.map((e) => e.id) },
        "Marked stale running enrichments as failed on startup"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to recover stale jobs on startup");
  }
}

recoverStaleJobs().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
