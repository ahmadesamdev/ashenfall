#!/usr/bin/env node
// Single entry point for every regression test.
//   node tests/run.mjs                 run everything
//   node tests/run.mjs combat pvp      run only tests whose path contains any term
//   node tests/run.mjs --list          list tests without running them
//   node tests/run.mjs --bail          stop at the first failure
// Tests live in tests/<area>/<topic>.test.mjs and must exit non-zero on failure.
// Run from the project root. Tests that import dist/ need `npm run build` first.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testsDir, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const terms = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.toLowerCase());

function discover(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return discover(full);
    return e.name.endsWith(".test.mjs") ? [full] : [];
  });
}

const all = discover(testsDir)
  .map((f) => path.relative(root, f).split(path.sep).join("/"))
  .sort();
const selected = terms.length
  ? all.filter((f) => terms.some((t) => f.toLowerCase().includes(t)))
  : all;
if (!selected.length) {
  console.error(`No tests match: ${terms.join(", ")}`);
  process.exit(2);
}
if (flags.has("--list")) {
  for (const f of selected) console.log(f);
  process.exit(0);
}

const needsDist = selected.filter((f) =>
  fs.readFileSync(path.join(root, f), "utf8").includes("dist/"),
);
if (needsDist.length && !fs.existsSync(path.join(root, "dist/server"))) {
  console.error(
    `dist/ is missing but ${needsDist.length} selected test(s) need it. Run "npm run build" first.`,
  );
  process.exit(2);
}

const nodeArgs = [
  "--no-warnings",
  "--experimental-strip-types",
  "--experimental-loader",
  "./scripts/ts-source-loader.mjs",
];
const failures = [];
const started = Date.now();
for (const file of selected) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [...nodeArgs, file], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  const ok = r.status === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  if (!ok) {
    failures.push(file);
    const out = `${r.stdout || ""}${r.stderr || ""}`
      .trim()
      .split("\n")
      .slice(-30)
      .join("\n");
    console.log(out.replace(/^/gm, "      "));
    if (flags.has("--bail")) break;
  }
}
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\n${selected.length - failures.length}/${selected.length} test files passed in ${secs}s`,
);
if (failures.length) {
  console.log(`Failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
