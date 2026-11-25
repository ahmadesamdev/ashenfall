import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const copy = (from, to) => {
  const src = path.join(root, from),
    dst = path.join(root, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
};

for (const file of [
  "client/index.html",
  "client/style.css",
  "client/favicon.ico",
  "client/site.webmanifest",
])
  copy(file, `dist/${file}`);
if (fs.existsSync(path.join(root, "client/assets"))) {
  fs.cpSync(
    path.join(root, "client/assets"),
    path.join(root, "dist/client/assets"),
    { recursive: true },
  );
}
if (fs.existsSync(path.join(root, "game-data"))) {
  fs.cpSync(path.join(root, "game-data"), path.join(root, "dist/game-data"), {
    recursive: true,
  });
}
console.log("copy-static: PASS");
