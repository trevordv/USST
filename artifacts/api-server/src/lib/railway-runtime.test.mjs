import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build as esbuild } from "esbuild";
import { parseAemoGenerationRows } from "./source-repair-parsers.ts";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const apiServerDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workspaceDir = path.resolve(apiServerDir, "../..");

async function bundleRailwayEntry(entryPoint, outputDir) {
  await esbuild({
    entryPoints: [entryPoint],
    platform: "node",
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: outputDir,
    entryNames: "entry",
    chunkNames: "chunk-[hash]",
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
    banner: {
      js: `import { createRequire as __bannerCrReq } from "node:module";
globalThis.require = __bannerCrReq(import.meta.url);`,
    },
  });
  return path.join(outputDir, "entry.mjs");
}

test("Railway OpenAI bundle uses only OPENAI_API_KEY and the standard endpoint", async () => {
  const integrationDir = path.join(
    workspaceDir,
    "lib/integrations-openai-ai-server/src",
  );
  const clientSources = await Promise.all(
    ["client.ts", "image/client.ts", "audio/client.ts"].map((relativePath) =>
      readFile(path.join(integrationDir, relativePath), "utf8"),
    ),
  );
  assert.doesNotMatch(
    clientSources.join("\n"),
    /AI_INTEGRATIONS_OPENAI_(?:BASE_URL|API_KEY)/,
  );

  const outputDir = await mkdtemp(path.join(tmpdir(), "usst-openai-bundle-"));
  try {
    const bundledEntry = await bundleRailwayEntry(
      path.join(integrationDir, "index.ts"),
      outputDir,
    );
    const environment = {
      ...process.env,
      OPENAI_API_KEY: "railway-regression-test-key",
    };
    delete environment.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete environment.AI_INTEGRATIONS_OPENAI_API_KEY;

    const script = `
      const { openai } = await import(${JSON.stringify(pathToFileURL(bundledEntry).href)});
      process.stdout.write(JSON.stringify({ baseURL: openai.baseURL }));
    `;
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { env: environment },
    );
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {
      baseURL: "https://api.openai.com/v1",
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("production ESM bundle resolves XLSX and parses the AEMO sheet", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "usst-xlsx-bundle-"));
  try {
    const bundledEntry = await bundleRailwayEntry(
      path.join(apiServerDir, "src/lib/aemo-workbook.ts"),
      outputDir,
    );
    const bundledWorkbook = await import(pathToFileURL(bundledEntry).href);
    const xlsx = require("xlsx");
    const workbook = xlsx.utils.book_new();
    const rows = [
      ["Generator information"],
      [
        "Site Name",
        "Site Owner",
        "Region",
        "Max Site Capacity (AC)",
        "Technology Type",
        "Technology Detail",
        "Aggregated Nameplate Capacity (MW AC)",
        "Commitment Status",
      ],
      [
        "Railway Solar Farm",
        "Solar Co",
        "NSW1",
        180,
        "Solar",
        "PV tracking",
        175,
        "Publicly Announced",
      ],
    ];
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet(rows),
      "Generator Information",
    );
    const workbookBuffer = xlsx.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const parsedRows =
      await bundledWorkbook.readAemoGenerationWorkbookRows(workbookBuffer);
    const candidates = parseAemoGenerationRows(
      parsedRows,
      "https://www.aemo.com.au/generation.xlsx",
      "2026-08-12",
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].name, "Railway Solar Farm");
    assert.equal(candidates[0].capacityMw, 180);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
