import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith(".") &&
    specifier.endsWith(".js") &&
    context.parentURL?.startsWith("file:")
  ) {
    const candidate = new URL(specifier, context.parentURL);
    const tsCandidate = new URL(candidate.href.slice(0, -3) + ".ts");
    if (fs.existsSync(fileURLToPath(tsCandidate))) {
      return {
        url: pathToFileURL(fileURLToPath(tsCandidate)).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
