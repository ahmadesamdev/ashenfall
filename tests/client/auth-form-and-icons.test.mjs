import fs from "node:fs";
import assert from "node:assert/strict";
const read = (f) => fs.readFileSync(f, "utf8");

// Enter submits: every panel is a <form>, primary buttons are submit buttons, the page never reloads.
const ob = read("client/react/Onboarding.ts");
assert.ok(
  ob.includes(
    "e('form',{className:'auth-form',noValidate:true,onSubmit:(ev:any)=>ev.preventDefault()},body)",
  ),
  "auth panels must be forms",
);
assert.ok(
  ob.includes(
    "const button=(label:string,kind:string,cls='primary wide')=>e('button',{type:'submit',",
  ),
  "primary auth button must be a submit button",
);
assert.ok(
  /links=\(items[^\n]*e\('button',\{type:'button'/.test(ob),
  "secondary links must stay type=button so Enter never triggers them",
);
assert.ok(
  ob.includes("onKeyDown:(ev:any)=>{if(ev.key==='Enter')"),
  "character name box submits on Enter",
);

// Confirm password on sign-up and on password reset.
for (const id of ["registerPasswordConfirm", "resetPasswordConfirm"])
  assert.ok(
    ob.includes(`input('${id}','password','new-password'`),
    `${id} field missing`,
  );
assert.ok(
  ob.includes("val('registerPassword')!==val('registerPasswordConfirm')"),
  "sign-up must compare passwords before calling the API",
);
assert.ok(
  ob.includes("val('resetPassword')!==val('resetPasswordConfirm')"),
  "reset must compare passwords before calling the API",
);
const mismatchIdx = ob.indexOf(
    "val('registerPassword')!==val('registerPasswordConfirm')",
  ),
  apiIdx = ob.indexOf("authApi('/api/auth/register'");
assert.ok(
  mismatchIdx > 0 && mismatchIdx < apiIdx,
  "mismatch check must run before the register request",
);

// Favicon set.
const html = read("client/index.html");
for (const needle of [
  'rel="icon" href="/assets/icons/favicon.svg"',
  'href="/favicon.ico"',
  'rel="apple-touch-icon"',
  'rel="manifest" href="/site.webmanifest"',
])
  assert.ok(html.includes(needle), `index.html missing ${needle}`);
for (const f of [
  "client/favicon.ico",
  "client/assets/icons/favicon.svg",
  "client/assets/icons/favicon-32.png",
  "client/assets/icons/apple-touch-icon.png",
  "client/assets/icons/icon-192.png",
  "client/assets/icons/icon-512.png",
])
  assert.ok(fs.statSync(f).size > 200, `${f} missing or empty`);
const ico = fs.readFileSync("client/favicon.ico");
assert.equal(ico.readUInt16LE(2), 1, "favicon.ico is a real ICO");
const manifest = JSON.parse(read("client/site.webmanifest"));
assert.equal(manifest.name, "Ashenfall");
assert.ok(
  read("scripts/copy-static.mjs").includes("client/favicon.ico") &&
    read("scripts/copy-static.mjs").includes("client/site.webmanifest"),
  "build must copy favicon.ico and the manifest",
);
console.log("auth-form-and-icons: PASS");
