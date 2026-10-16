import path from "node:path";

const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE = "public, max-age=0, must-revalidate";

export function staticCacheControl(filePath: string, publicDir: string): string {
  const assetsDir = path.join(publicDir, "assets") + path.sep;
  return filePath.startsWith(assetsDir) ? IMMUTABLE_ASSET_CACHE : REVALIDATE_CACHE;
}
