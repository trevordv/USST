import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { staticCacheControl } from "./http-cache.ts";

test("fingerprinted assets are immutable while HTML revalidates", () => {
  const publicDir = path.resolve("dist/public");

  assert.equal(
    staticCacheControl(path.join(publicDir, "assets", "index-abc123.js"), publicDir),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    staticCacheControl(path.join(publicDir, "index.html"), publicDir),
    "public, max-age=0, must-revalidate",
  );
});
