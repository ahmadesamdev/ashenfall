import fs from "node:fs";
import assert from "node:assert/strict";

const read = (f) => fs.readFileSync(f, "utf8");

// Registering with an email that already has a verified account must say so, not pretend a code was sent.
const auth = read("server/auth/AuthService.ts");
assert.match(
  auth,
  /alreadyRegistered:true,message:'An account with this email already exists/,
  "server reports an existing verified account",
);
const reg = auth.slice(
  auth.indexOf("async register("),
  auth.indexOf("async verify("),
);
const verifiedBranch = reg.slice(
  reg.indexOf("if(account?.verified)"),
  reg.indexOf("const passwordHash"),
);
assert.ok(
  !verifiedBranch.includes("sendVerification") &&
    !verifiedBranch.includes("authSetVerification"),
  "no verification code for an existing verified account",
);
const route = read("server/runtime/ServerRuntime.ts");
assert.ok(
  route.includes("message:'Verification code sent. Check your email.',...data"),
  "route lets the service message override the default",
);
const onboarding = read("client/react/Onboarding.ts");
assert.ok(
  onboarding.includes("if(d.alreadyRegistered){") &&
    onboarding.includes("d.message||"),
  "client shows the existing-account message and switches to sign in",
);

// "Sign out all sessions" must not call a detached fetch (Illegal invocation).
const ctl = read("client/runtime/AccountSessionController.ts");
assert.ok(
  !/d\.fetcher\s*\?\?\s*fetch\s*;/.test(ctl),
  "bare fetch must not be stored on the controller",
);
assert.ok(
  ctl.includes("globalThis.fetch(input, init)"),
  "default fetcher calls fetch with the right receiver",
);
console.log(
  "register-existing-email-and-logout-all: PASS — existing email is reported (no code sent); logout-all uses a correctly bound fetch",
);
