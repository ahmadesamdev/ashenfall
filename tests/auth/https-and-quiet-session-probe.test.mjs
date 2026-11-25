import fs from "node:fs";
import assert from "node:assert/strict";
const read = (f) => fs.readFileSync(f, "utf8");
const rt = read("server/runtime/ServerRuntime.ts");

// HTTPS: production redirects plain-HTTP visitors (as seen by the proxy) and sends HSTS; /health stays reachable for the platform probe.
assert.ok(
  rt.includes(
    "process.env.FORCE_HTTPS?!/^(false|0|no)$/i.test(process.env.FORCE_HTTPS):process.env.NODE_ENV==='production'",
  ),
  "HTTPS enforcement defaults on in production, FORCE_HTTPS can override",
);
assert.ok(
  rt.includes("proto==='http'&&req.path!=='/health'") &&
    rt.includes("res.redirect(308,`https://${host}${req.originalUrl}`)"),
  "http -> https redirect",
);
assert.ok(
  rt.includes("res.setHeader('Strict-Transport-Security','max-age=15552000')"),
  "HSTS on https responses",
);
assert.ok(
  !/includeSubDomains|preload/.test(
    rt.match(/Strict-Transport-Security[^;]*/)[0],
  ),
  "HSTS must not claim sibling subdomains",
);
assert.ok(
  rt.indexOf("Strict-Transport-Security") < rt.indexOf("app.use(express.json"),
  "redirect runs before body parsing",
);
assert.ok(
  rt.includes("/^[a-z0-9.-]+(:\\d+)?$/i.test(host)"),
  "redirect host is validated (no open redirect via Host header)",
);

// Logged-out visitors: one session probe that always answers 200, no red 401s in the console.
assert.ok(
  rt.includes("app.post('/api/auth/session'") &&
    rt.includes("authOk(res,{authenticated:false})"),
  "session probe answers 200 when logged out",
);
const ob = read("client/react/Onboarding.ts");
assert.ok(
  ob.includes("fetch('/api/auth/session'") &&
    !ob.includes("fetch('/api/auth/me'") &&
    !/check=async[\s\S]{0,900}authApi\('\/api\/auth\/refresh'/.test(ob),
  "client boot uses the quiet probe only",
);
// the strict endpoints keep their 401 contract for API clients
assert.ok(
  rt.includes("if(!p)return res.status(401).json({ok:false})"),
  "/api/auth/me still returns 401 when logged out",
);
console.log("https-and-quiet-session-probe: PASS");
