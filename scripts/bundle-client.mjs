import fs from "node:fs";
import { build } from "esbuild";

const input = "dist/client/app.js";
const output = "dist/client/app.bundle.js";
if (!fs.existsSync(input)) throw new Error(`bundle-client: missing ${input}`);
await build({
  entryPoints: [input],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: output,
  sourcemap: true,
  legalComments: "none",
});
fs.renameSync(output, input);
const map = `${output}.map`;
if (fs.existsSync(map)) fs.renameSync(map, `${input}.map`);
console.log("bundle-client: PASS");
