import fs from "node:fs";
import assert from "node:assert/strict";

const index = fs.readFileSync(
  new URL("../server/index.ts", import.meta.url),
  "utf8",
);
const runtime = fs.readFileSync(
  new URL("../server/runtime/ServerRuntime.ts", import.meta.url),
  "utf8",
);
const handlers = fs.readFileSync(
  new URL("../server/runtime/CommandHandlers.ts", import.meta.url),
  "utf8",
);
const commandHandler = fs.readFileSync(
  new URL("../server/runtime/CommandHandler.ts", import.meta.url),
  "utf8",
);

function objectCall(source, callName) {
  const start = source.indexOf(`${callName}({`);
  assert.notEqual(start, -1, `Could not find ${callName}({...}) call`);
  const bodyStart = start + callName.length + 2;
  let depth = 1,
    i = bodyStart,
    quote = null,
    escaped = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(bodyStart, i);
  }
  throw new Error(`Unclosed ${callName} object`);
}
function destructuredNames(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `Could not find ${marker}`);
  const destructure = source.indexOf("const {", at);
  const open = destructure + "const ".length,
    closeCtx = source.indexOf("} = context", open),
    closeShort = source.indexOf("} = ctx", open);
  const close =
    closeCtx < 0
      ? closeShort
      : closeShort < 0
        ? closeCtx
        : Math.min(closeCtx, closeShort);
  assert.ok(
    open >= 0 && close > open,
    `Could not parse context destructuring in ${marker}`,
  );
  return source
    .slice(open + 1, close)
    .split(",")
    .map((x) => x.trim().split(/\s*:/)[0])
    .filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
}
function providedNames(body) {
  return new Set(
    body
      .split(",")
      .map((x) => x.trim())
      .map((x) => x.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/)?.[1])
      .filter(Boolean),
  );
}
const runtimeNeeds = destructuredNames(
  runtime,
  "export function createServerRuntime",
);
const runtimeProvided = providedNames(objectCall(index, "createServerRuntime"));
const runtimeMissing = runtimeNeeds.filter(
  (name) => !runtimeProvided.has(name),
);
assert.deepEqual(
  runtimeMissing,
  [],
  `createServerRuntime context is missing: ${runtimeMissing.join(", ")}`,
);

const commandNeeds = destructuredNames(
  handlers,
  "export function createCommandHandlers",
);
const commandCall = objectCall(index, "createCommandHandler");
const commandProvided = providedNames(commandCall);
const commandMissing = commandNeeds.filter(
  (name) => !commandProvided.has(name),
);
assert.deepEqual(
  commandMissing,
  [],
  `createCommandHandler context is missing: ${commandMissing.join(", ")}`,
);

console.log(
  `Wiring lint passed: ${runtimeNeeds.length} runtime dependencies and ${commandNeeds.length} command-handler dependencies are wired.`,
);
