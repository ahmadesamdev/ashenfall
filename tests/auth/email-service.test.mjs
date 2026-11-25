import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { EmailService } = await import(
  pathToFileURL(path.join(root, "dist/server/auth/EmailService.js")).href
);

const realFetch = globalThis.fetch;
const realNodeEnv = process.env.NODE_ENV;
const calls = [];
function mockFetch(response) {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (response instanceof Error) throw response;
    return response;
  };
}
const ok = (status = 202) => new Response(null, { status });
const failure = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.test",
    EMAIL_FROM: "Ashenfall <no-reply@example.test>",
  });
  assert.equal(svc.provider, "sendgrid");
  assert.equal(svc.configured, true);
  mockFetch(ok(202));
  await svc.sendVerification("player@example.com", "123456");
  assert.equal(calls.length, 1, "one HTTPS request is made");
  assert.equal(
    calls[0].url,
    "https://api.sendgrid.com/v3/mail/send",
    "SendGrid mail-send endpoint over HTTPS",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer SG.test",
    "API key is sent as a bearer token",
  );
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(
    body.personalizations,
    [{ to: [{ email: "player@example.com" }] }],
    "recipient is set",
  );
  assert.deepEqual(
    body.from,
    { email: "no-reply@example.test", name: "Ashenfall" },
    "sender display name and address are split",
  );
  assert.match(body.subject, /Verify your email/);
  assert.ok(
    body.content.some(
      (c) => c.type === "text/plain" && c.value.includes("123456"),
    ),
    "plain text part carries the code",
  );
  assert.ok(
    body.content.some(
      (c) => c.type === "text/html" && c.value.includes("123456"),
    ),
    "html part carries the code",
  );
}

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.test",
    EMAIL_FROM: "no-reply@example.test",
  });
  mockFetch(ok(202));
  await svc.sendPasswordReset("player@example.com", "654321");
  assert.deepEqual(
    JSON.parse(calls[0].init.body).from,
    { email: "no-reply@example.test" },
    "a bare address needs no display name",
  );
  assert.match(JSON.parse(calls[0].init.body).subject, /Password reset/);
}

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.test",
    SMTP_HOST: "smtp.sendgrid.net",
    SMTP_USER: "apikey",
    SMTP_PASS: "SG.test",
    SMTP_FROM: "Ashenfall <no-reply@example.test>",
  });
  assert.equal(
    svc.provider,
    "sendgrid",
    "the HTTPS API wins over SMTP when both are configured",
  );
  assert.equal(
    svc.from,
    "Ashenfall <no-reply@example.test>",
    "SMTP_FROM is still honoured as the sender",
  );
}

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.test",
    SMTP_USER: "apikey",
    EMAIL_FROM: "",
  });
  assert.notEqual(
    svc.from,
    "apikey",
    'the literal SMTP username "apikey" is never used as the sender address',
  );
}

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.bad",
    EMAIL_FROM: "no-reply@example.test",
  });
  mockFetch(
    failure(403, {
      errors: [
        {
          message:
            "The from address does not match a verified Sender Identity.",
        },
      ],
    }),
  );
  await assert.rejects(
    () => svc.sendVerification("player@example.com", "111111"),
    (error) => {
      assert.match(error.message, /SendGrid rejected the email \(HTTP 403\)/);
      assert.match(
        error.message,
        /verified Sender Identity/,
        "the provider reason is surfaced for the server log",
      );
      return true;
    },
  );
}

{
  const svc = new EmailService({
    SENDGRID_API_KEY: "SG.test",
    EMAIL_FROM: "no-reply@example.test",
  });
  mockFetch(new Error("network down"));
  await assert.rejects(
    () => svc.sendVerification("player@example.com", "111111"),
    /network down/,
    "transport failures propagate",
  );
}

{
  const svc = new EmailService({
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Ashenfall <no-reply@example.test>",
  });
  assert.equal(svc.provider, "resend");
  mockFetch(new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
  await svc.sendVerification("player@example.com", "222222");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, "Ashenfall <no-reply@example.test>");
  assert.deepEqual(body.to, ["player@example.com"]);
}

{
  const svc = new EmailService({
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    SMTP_FROM: "Ashenfall <no-reply@example.test>",
  });
  assert.equal(svc.provider, "smtp");
  assert.equal(svc.configured, true);
  assert.equal(svc.from, "Ashenfall <no-reply@example.test>");
}

{
  const svc = new EmailService({});
  assert.equal(svc.provider, "none");
  assert.equal(svc.configured, false);
  process.env.NODE_ENV = "production";
  await assert.rejects(
    () => svc.sendVerification("player@example.com", "333333"),
    /SENDGRID_API_KEY/,
    "production without a provider fails with an actionable message",
  );
  process.env.NODE_ENV = "development";
  await svc.sendVerification("player@example.com", "333333");
}

globalThis.fetch = realFetch;
if (realNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = realNodeEnv;
console.log(
  "email-service: PASS — SendGrid/Resend HTTPS delivery, provider precedence, sender parsing and failure reporting",
);
