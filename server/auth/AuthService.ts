import crypto from "node:crypto";
import { createRequire } from "node:module";
import { isPrincipalCurrent } from "./SessionAuthority.js";

const require = createRequire(import.meta.url);
const bcrypt = require("bcrypt");

const ACCESS_MINUTES = 15;
const REFRESH_DAYS = 30;
const CODE_MINUTES = 15;
const RESET_MINUTES = 15;
const SESSION_LIST_LIMIT = 25;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (v: any) =>
  String(v || "")
    .trim()
    .toLowerCase();
const token = () => crypto.randomBytes(32).toString("base64url");
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
const base64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

function jwtSecret() {
  const secret = String(process.env.ASHENFALL_JWT_SECRET || "").trim();
  if (
    secret &&
    secret.length >= 32 &&
    !/^(replace-with|change-me|your-secret)/i.test(secret)
  )
    return secret;
  throw Error(
    "ASHENFALL_JWT_SECRET must be configured with at least 32 characters of random secret material. Generate one with: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"",
  );
}

export function assertAuthConfigured() {
  jwtSecret();
}

function signJwt(payload: any) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const input = `${header}.${body}`;
  const sig = crypto
    .createHmac("sha256", jwtSecret())
    .update(input)
    .digest("base64url");
  return `${input}.${sig}`;
}

function verifyJwt(raw: string) {
  const parts = String(raw || "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", jwtSecret())
    .update(`${header}.${body}`)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      h.alg !== "HS256" ||
      h.typ !== "JWT" ||
      !Number.isFinite(Number(p.exp)) ||
      Number(p.exp) <= Math.floor(Date.now() / 1000)
    )
      return null;
    return p;
  } catch {
    return null;
  }
}

export async function makePasswordHash(password: string) {
  return await bcrypt.hash(String(password), BCRYPT_ROUNDS);
}
export async function verifyPassword(password: string, encoded: string) {
  try {
    return await bcrypt.compare(String(password), String(encoded || ""));
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(
    public repo: any,
    public mailer: any,
  ) {}
  async init() {
    await this.repo.authInit();
  }
  validatePassword(p: any) {
    const s = String(p || "");
    if (s.length < 8) return "Password must be at least 8 characters.";
    if (s.length > 128) return "Password is too long.";
    if (Buffer.byteLength(s, "utf8") > 72)
      return "Password is too long for the selected password hashing policy.";
    return null;
  }
  accessToken(principal: any) {
    const now = Math.floor(Date.now() / 1000);
    return signJwt({
      sub:
        principal.kind === "account" ? principal.accountId : principal.guestId,
      kind: principal.kind,
      email: principal.email || undefined,
      sv: principal.sessionVersion || undefined,
      iat: now,
      exp: now + ACCESS_MINUTES * 60,
      jti: crypto.randomUUID(),
    });
  }
  async issueSession(
    kind: string,
    id: string,
    email: any = null,
    bumpSessionVersion = true,
  ) {
    const raw = token();
    let sessionVersion: number | undefined;
    if (kind === "account") {
      const replace = this.repo.authReplaceAccountSession;
      if (typeof replace === "function")
        sessionVersion = Number(
          await replace.call(
            this.repo,
            hash(raw),
            id,
            Date.now() + REFRESH_DAYS * 86400000,
            !!bumpSessionVersion,
          ),
        );
      else {
        await this.repo.authDeleteAllSessions(id);
        await this.repo.authCreateSession(
          hash(raw),
          id,
          null,
          Date.now() + REFRESH_DAYS * 86400000,
        );
        if (bumpSessionVersion) await this.repo.authBumpSessionVersion(id);
        sessionVersion = Number(
          (await this.repo.authGetAccountById(id))?.sessionVersion || 1,
        );
      }
    } else
      await this.repo.authCreateSession(
        hash(raw),
        null,
        id,
        Date.now() + REFRESH_DAYS * 86400000,
      );
    const principal =
      kind === "account"
        ? {
            kind: "account",
            accountId: id,
            email,
            sessionVersion: Number(sessionVersion || 1),
          }
        : { kind: "guest", guestId: id };
    return {
      accessToken: this.accessToken(principal),
      refreshToken: raw,
      principal,
    };
  }
  private registrationLocks = new Map<string, Promise<any>>();
  private refreshLocks = new Map<string, Promise<any>>();
  private recentRefreshResults = new Map<
    string,
    { expiresAt: number; result: any }
  >();

  async register(email: any, password: any) {
    const e = normalizeEmail(email),
      p = String(password || "");
    if (!EMAIL_RE.test(e)) throw Error("Enter a valid email address.");
    const pe = this.validatePassword(p);
    if (pe) throw Error(pe);
    const running = this.registrationLocks.get(e);
    if (running) return await running;
    const operation = (async () => {
      let account = await this.repo.authGetAccountByEmail(e);
      if (account?.verified) {
        return {
          email: e,
          alreadyRegistered: true,
          message:
            'An account with this email already exists. Sign in instead, or use "Forgot password?" to reset it.',
        };
      }
      const passwordHash = await makePasswordHash(p);
      if (account) {
        await this.repo.authResetPassword(account.id, passwordHash);
      } else {
        account = {
          id: `account_${crypto.randomUUID()}`,
          email: e,
          passwordHash,
          verified: false,
          createdAt: Date.now(),
        };
        try {
          await this.repo.authCreateAccount(
            account,
            hash(token()),
            Date.now() + CODE_MINUTES * 60000,
          );
        } catch (error: any) {
          const raced = await this.repo.authGetAccountByEmail(e);
          if (!raced) throw error;
          account = raced;
          await this.repo.authResetPassword(account.id, passwordHash);
        }
      }
      const code = String(crypto.randomInt(100000, 1000000));
      await this.repo.authSetVerification(
        account.id,
        hash(code),
        Date.now() + CODE_MINUTES * 60000,
      );
      try {
        await this.mailer.sendVerification(account.email, code);
      } catch (error) {
        console.warn(
          "[auth] verification email failed:",
          (error as any)?.message || error,
        );
        throw new Error(
          "Your account is ready, but the verification email could not be sent. Please try again or check the server email configuration.",
        );
      }
      return { email: e, expiresInSeconds: CODE_MINUTES * 60 };
    })();
    this.registrationLocks.set(e, operation);
    try {
      return await operation;
    } finally {
      if (this.registrationLocks.get(e) === operation)
        this.registrationLocks.delete(e);
    }
  }
  async verify(email: any, code: any) {
    const a = await this.repo.authGetAccountByEmail(normalizeEmail(email));
    if (!a) throw Error("Invalid or expired verification code.");
    if (a.verified) return {};
    if (!a.verificationHash || Number(a.verificationExpiresAt) < Date.now())
      throw Error("Invalid or expired verification code.");
    if (!safeEqual(hash(String(code || "")), String(a.verificationHash)))
      throw Error("Invalid or expired verification code.");
    await this.repo.authVerifyAccount(a.id);
    return {};
  }
  async resendVerification(email: any) {
    const a = await this.repo.authGetAccountByEmail(normalizeEmail(email));
    if (!a || a.verified) return {};
    const previousHash = a.verificationHash,
      previousExpiry = a.verificationExpiresAt;
    const code = String(crypto.randomInt(100000, 1000000));
    await this.repo.authSetVerification(
      a.id,
      hash(code),
      Date.now() + CODE_MINUTES * 60000,
    );
    try {
      await this.mailer.sendVerification(a.email, code);
    } catch (error) {
      console.warn(
        "[auth] verification email failed:",
        (error as any)?.message || error,
      );
      try {
        await this.repo.authSetVerification(
          a.id,
          String(previousHash || ""),
          Number(previousExpiry || 0),
        );
      } catch {}
      throw new Error(
        "Could not send a new verification email. Please try again.",
      );
    }
    return {};
  }
  async requestPasswordReset(email: any) {
    const e = normalizeEmail(email);
    if (!EMAIL_RE.test(e)) throw Error("Enter a valid email address.");
    const a = await this.repo.authGetAccountByEmail(e);
    if (!a || !a.verified)
      return { email: e, expiresInSeconds: RESET_MINUTES * 60 };
    const code = String(crypto.randomInt(100000, 1000000));
    await this.repo.authSetPasswordReset(
      a.id,
      hash(code),
      Date.now() + RESET_MINUTES * 60000,
    );
    try {
      await this.mailer.sendPasswordReset(e, code);
    } catch (error) {
      console.warn(
        "[auth] password reset email failed:",
        (error as any)?.message || error,
      );
    }
    return { email: e, expiresInSeconds: RESET_MINUTES * 60 };
  }
  async resetPassword(email: any, code: any, password: any) {
    const e = normalizeEmail(email),
      p = String(password || "");
    const pe = this.validatePassword(p);
    if (pe) throw Error(pe);
    const a = await this.repo.authGetAccountByEmail(e);
    if (!a || !a.resetHash || Number(a.resetExpiresAt) < Date.now())
      throw Error("Password reset code expired. Request a new code.");
    if (!safeEqual(hash(String(code || "")), String(a.resetHash)))
      throw Error("Invalid password reset code.");
    await this.repo.authResetPassword(a.id, await makePasswordHash(p));
    await this.repo.authDeleteAllSessions(a.id);
    await this.repo.authBumpSessionVersion(a.id);
    return { email: e };
  }
  async listSessions(accountId: string) {
    return (await this.repo.authListAccountSessions(accountId))
      .slice(0, SESSION_LIST_LIMIT)
      .map((s: any) => ({
        createdAt: Number(s.createdAt),
        expiresAt: Number(s.expiresAt),
      }));
  }
  async logoutAll(accountId: string) {
    await this.repo.authDeleteAllSessions(accountId);
    await this.repo.authBumpSessionVersion(accountId);
  }
  async claimGuest(accountId: string, guestToken: string) {
    const raw = String(guestToken || "");
    if (!raw) throw Error("Guest session required.");
    const old = await this.repo.authGetSessionByHash(hash(raw));
    if (!old?.guestId || Number(old.expiresAt) <= Date.now())
      throw Error("Guest session expired or unavailable.");
    const oldOwner = `guest:${old.guestId}`,
      newOwner = `account:${accountId}`;
    const allPlayers = await Promise.resolve(this.repo.allPlayers());
    const players = allPlayers.filter((p: any) => p?.accountId === oldOwner);
    if (players.length > 1)
      throw Error(
        "Guest session contains more than one character; contact support before claiming it.",
      );
    const existing = allPlayers.find((p: any) => p?.accountId === newOwner);
    if (existing && players.length)
      throw Error(
        "This account already has a character. Guest progress cannot be merged automatically.",
      );
    for (const player of players) {
      player.accountId = newOwner;
      player.lastSeenAt = Date.now();
      await this.repo.savePlayerNow(player);
    }
    await this.repo.authDeleteSession(old.tokenHash);
    return {
      guestId: old.guestId,
      playerId: players[0]?.id || null,
      claimed: players.length > 0,
    };
  }
  async login(email: any, password: any) {
    const a = await this.repo.authGetAccountByEmail(normalizeEmail(email));
    const supplied = String(password || "");
    const passwordMatches = a
      ? await verifyPassword(supplied, a.passwordHash)
      : (await makePasswordHash(supplied), false);
    if (!a || !passwordMatches || !a.verified)
      throw Error("Invalid email or password.");
    return await this.issueSession("account", a.id, a.email);
  }
  async guest(existingToken: any = null) {
    if (existingToken) {
      const lockKey = `guest:${hash(String(existingToken))}`;
      const running = this.refreshLocks.get(lockKey);
      if (running) return await running;
      const op = this.guestUnlocked(existingToken);
      this.refreshLocks.set(lockKey, op);
      try {
        return await op;
      } finally {
        if (this.refreshLocks.get(lockKey) === op)
          this.refreshLocks.delete(lockKey);
      }
    }
    return await this.guestUnlocked(null);
  }
  private async guestUnlocked(existingToken: any = null) {
    if (existingToken) {
      const old = await this.repo.authGetSessionByHash(
        hash(String(existingToken)),
      );
      if (old?.guestId && Number(old.expiresAt) > Date.now()) {
        await this.repo.authDeleteSession(old.tokenHash);
        return await this.issueSession("guest", old.guestId);
      }
    }
    return await this.issueSession("guest", `guest_${crypto.randomUUID()}`);
  }
  async refresh(rawRefresh: any) {
    if (!rawRefresh) throw Error("Refresh token required.");
    const raw = String(rawRefresh),
      key = hash(raw);
    const recent = this.recentRefreshResults.get(key);
    if (recent && recent.expiresAt > Date.now()) return recent.result;
    if (recent) this.recentRefreshResults.delete(key);
    const inFlight = this.refreshLocks.get(key);
    if (inFlight) return await inFlight;
    const operation = (async () => {
      const old = await this.repo.authGetSessionByHash(key);
      if (!old || Number(old.expiresAt) <= Date.now()) {
        if (old) await this.repo.authDeleteSession(old.tokenHash);
        throw Error("Refresh session expired.");
      }
      await this.repo.authDeleteSession(old.tokenHash);
      if (old.accountId) {
        const a = await this.repo.authGetAccountById(old.accountId);
        if (!a || !a.verified) throw Error("Account is unavailable.");
        return await this.issueSession("account", a.id, a.email, false);
      }
      if (old.guestId) return await this.issueSession("guest", old.guestId);
      throw Error("Invalid refresh session.");
    })();
    this.refreshLocks.set(key, operation);
    try {
      const result = await operation;
      this.recentRefreshResults.set(key, {
        expiresAt: Date.now() + 10_000,
        result,
      });
      while (this.recentRefreshResults.size > 1024)
        this.recentRefreshResults.delete(
          this.recentRefreshResults.keys().next().value,
        );
      return result;
    } finally {
      if (this.refreshLocks.get(key) === operation)
        this.refreshLocks.delete(key);
    }
  }
  async principalFromAccessToken(raw: any) {
    const p = verifyJwt(raw);
    if (!p) return null;
    if (p.kind === "account" && p.sub) {
      const a = await this.repo.authGetAccountById(String(p.sub));
      if (!a || !a.verified) return null;
      if (Number(p.sv || 1) !== Number(a.sessionVersion || 1)) return null;
      return {
        kind: "account",
        accountId: a.id,
        email: a.email,
        sessionVersion: Number(a.sessionVersion || 1),
      };
    }
    if (p.kind === "guest" && p.sub) return { kind: "guest", guestId: p.sub };
    return null;
  }
  async isPrincipalCurrent(principal: any) {
    return await isPrincipalCurrent(this.repo, principal);
  }
  ownerId(principal: any) {
    return principal?.kind === "account"
      ? `account:${principal.accountId}`
      : `guest:${principal?.guestId || ""}`;
  }
}
