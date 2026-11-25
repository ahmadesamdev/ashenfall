import assert from "node:assert/strict";
import fs from "node:fs";
const s = fs.readFileSync(
  new URL("../../server/runtime/ServerRuntime.ts", import.meta.url),
  "utf8",
);
assert.ok(
  s.includes("zlib.gzipSync") && s.includes("'Content-Encoding','gzip'"),
  "static text assets are gzipped",
);
assert.ok(
  s.includes("etag:true") && s.includes("max-age=604800"),
  "static assets are cacheable / revalidated",
);
console.log("static compression + caching wired");
