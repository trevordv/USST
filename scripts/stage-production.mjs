import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const frontendPublicDir = path.join(
  repoRoot,
  "artifacts",
  "solar-tracker",
  "dist",
  "public",
);
const apiPublicDir = path.join(
  repoRoot,
  "artifacts",
  "api-server",
  "dist",
  "public",
);

async function assertDirectory(directory) {
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(
      `Expected frontend build output at ${directory}. Run the frontend build before staging production assets.`,
    );
  }
}

await assertDirectory(frontendPublicDir);
await rm(apiPublicDir, { recursive: true, force: true });
await mkdir(path.dirname(apiPublicDir), { recursive: true });
await cp(frontendPublicDir, apiPublicDir, { recursive: true });

console.log(`Staged frontend assets in ${apiPublicDir}`);
