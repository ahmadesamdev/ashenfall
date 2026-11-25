import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
assert.equal(
  pkg.dependencies?.express,
  "^5.3.0",
  "Express must remain on the patched 5.3 line",
);
assert.equal(
  pkg.dependencies?.nodemailer,
  "^10.1.1",
  "Nodemailer must remain on a release newer than the September 2026 security fixes",
);
assert.equal(
  pkg.devDependencies?.esbuild,
  "^0.28.2",
  "esbuild must remain on a release newer than the install-time critical advisory",
);
assert.equal(
  pkg.allowScripts?.["bcrypt@6.0.0"],
  true,
  "bcrypt native install script must be explicitly approved",
);
assert.equal(
  pkg.allowScripts?.["esbuild@0.28.2"],
  true,
  "esbuild binary verification install script must be explicitly approved",
);
assert.equal(
  pkg.scripts?.["audit:security"],
  "npm audit --audit-level=high",
  "security audit command must be available",
);
console.log(
  "dependency security policy: PASS — patched dependency ranges, narrowly scoped install-script approvals, and high/critical audit command",
);
