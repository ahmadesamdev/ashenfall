import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { RateLimiter } from "../auth/RateLimiter.js";
import {
  boundedInt,
  boundedString,
  createRequestDedupe,
  createSerialExecutor,
  createWindowRateLimiter,
} from "../shared/Hardening.js";
import { GAME_RUNTIME } from "../shared/GameRuntimeConfig.js";
import { sweepGeneratedItemRegistry } from "../shared/GeneratedItemRegistry.js";
import {
  sectionsForCommand,
  TRANSIENT_COMMANDS,
} from "../shared/CommandStateSections.js";
import { createFixedTickScheduler } from "../shared/TickScheduler.js";
import { PlayerCombatSimulationService } from "./PlayerCombatSimulationService.js";
import { WorldCombatSimulationService } from "./WorldCombatSimulationService.js";
import { CombatVictoryService } from "./CombatVictoryService.js";
import { AuthoritativeSimulationCoordinator } from "./AuthoritativeSimulationCoordinator.js";
import { DurableOutboxWorker } from "../shared/DurableOutboxWorker.js";

export function createServerRuntime(context: Record<string, any>) {
  const {
    root,
    bus,
    telemetry,
    repo,
    emailService,
    authService,
    inv,
    world,
    quest,
    combat,
    worldLease,
    worldLeaseOwnerId,
    WORLD_LEASE_ID,
    dungeonEngine,
    economy,
    profession,
    social,
    regionEngine,
    worldEvents,
    worldSimulation,
    npcMemory,
    factionSimulation,
    worldEcology,
    emergentWorldEvents,
    discoveryEngine,
    regionalEconomy,
    guildOrganizations,
    worldIntegration,
    chronicle,
    openWorld,
    clients,
    activeSessions,
    reservedCharacterNames,
    VERSION,
    REPOSITORY_BACKEND,
    SESSION_CHECKPOINT_MS,
    lastPersistenceCheckpointAtRef,
    AUTO_TARGET_MAX_METERS,
    NPC_INTERACTION_METERS,
    NPC_STAND_METERS,
    pvpZone,
    pvpAllowed,
    queues,
    dungeonQueue,
    battlegroundQueue,
    battlegrounds,
    pvpQueueTimes,
    arenaQueues,
    arenaMatches,
    enqueueArena,
    leaveArenaQueue,
    tryMatchArena,
    finishArena,
    dungeonQueueSnapshot,
    dungeonQueueService,
    dungeonQueueRole,
    enqueueDungeonQueue,
    acceptDungeonMatch,
    declineDungeonMatch,
    removeDungeonQueue,
    leaveDungeonPartyQueue,
    tryMatchDungeonQueue,
    pvpQueueSnapshot,
    pvpStats,
    finishDuel,
    battlegroundSnapshot,
    startBattleground,
    state,
    stateBroadcast,
    broadcastMotion,
    partyState,
    storyProgressForPlayer,
    npcDetail,
    handle,
    rewardMobKill,
    reward,
    gainXp,
    rebuildTalents,
    normalizeXpTrack,
    repositoryStatsSnapshot,
    makeGearInstance,
    randomAffix,
    findTradeSession,
    tradeRequests,
    tradeDistanceOk,
    tradeSessions,
    tradeOffer,
    completeTrade,
    resolveLootRollForParty,
    claimDungeonRewardChest,
    partyRole,
    worldMobDefs,
    classStories,
    lore,
    worldRegions,
    worldPoi,
    worldZoneProgression,
    mmo,
    quests,
    zones,
    npcs,
    dungeons,
    shops,
    recipes,
    classes,
    abilities,
    items,
    itemization,
    storyline,
    worldStory,
    storyIntro,
    talents,
    talentTrees,
    talentTransformations,
    classBuilds,
    buildEncounterProfiles,
    combatResources,
    combatRotations,
    dynamicItemsForPlayer,
    stateRevisionRef,
    uiRevisionRef,
    motionSequenceRef,
    networkMetrics,
    tickMetrics,
    addChat,
    chatService,
    storyChoices,
    npcDialogue,
    MOVEMENT_SPEEDS,
    COMBAT_RANGES,
    normalizeAbilityRange,
    normalizeGameDistance,
    finiteNumber,
    rollDamage,
    guardPlayerRuntime,
    normalizeMovement,
    normalizeStoryQuest,
    reconcileTravelQuestState,
    awardEncounterLoot,
    createDungeonCompletionRewards,
    resolveExpiredLootRolls,
    createPlayer,
    wsSend,
    tradeState,
    playerMutations,
  } = context;
  const playerCombatSimulation = new PlayerCombatSimulationService({
    combat,
    world,
  });
  const worldCombatSimulation = new WorldCombatSimulationService({
    world,
    combat,
    rewardMobKill,
    emitMobAction: (zone: any, msg: any) => {
      bus.emit("combat.mob_action", { zone, message: msg });
      if (msg.kind !== "combat")
        addChat(zone, {
          from: msg.from,
          text: msg.text,
          kind: msg.kind || "system",
        });
    },
  });
  const combatVictory = new CombatVictoryService({
    combat,
    world,
    quest,
    dungeonEngine,
    repo,
    rewardMobKill,
    reward,
    awardEncounterLoot,
    createDungeonCompletionRewards,
    dungeons,
    playerMutations,
  });
  function send(c, m) {
    try {
      wsSend(c, m);
    } catch {}
  }

  function performWorldBasicAttack(p, m, now) {
    if (p?.combat?.casting) return null;
    if (!m || m.state === "dead" || !p.worldCombatMobId) return null;
    if (p.combat?.manualMove) {
      const range = world.normalizedMeters(p.zone, world.combatRangeMeters(p));
      if (Math.hypot(p.x - m.x, p.y - m.y) > range) {
        if (now - Number(p.combat.rangeNoticeAt || 0) > 2500) {
          p.combat.rangeNoticeAt = now;
          p.worldCombatLog = p.worldCombatLog || [];
          p.worldCombatLog.push({
            t: new Date().toLocaleTimeString(),
            msg: "⚠️ Out of range — move closer or click the target to chase it.",
          });
          p.worldCombatLog = p.worldCombatLog.slice(-80);
        }
        return null;
      }
    }
    return combat.requestWorldCast(p, "basic_strike", m, null, {
      automatic: true,
    });
  }

  function awaitOrSyncCheckpoint() {
    // Only changed world state is written (a clean world costs one slow safety write every 5 minutes), not five full documents every 5s.
    worldSimulation.checkpointIfDirty(Date.now());
    regionalEconomy?.checkpointIfDirty?.(Date.now());
    worldEcology?.checkpointIfDirty?.(Date.now());
    emergentWorldEvents?.checkpointIfDirty?.(Date.now());
    chronicle?.checkpointIfDirty?.(Date.now());
    npcMemory?.persist?.(false, Date.now());
    const result = repo.checkpoint();
    if (result && typeof result.then === "function")
      result
        .then(() => telemetry.recordCheckpoint(true))
        .catch((error: any) => {
          telemetry.recordCheckpoint(false);
          console.warn("Async persistence checkpoint failed:", error);
        });
    else telemetry.recordCheckpoint(true);
  }

  const app = express();
  app.disable("x-powered-by");
  app.use((_req: any, res: any, next: any) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });
  // TLS is terminated by the host's proxy. In production: send plain-HTTP visitors to HTTPS and tell browsers to keep using it.
  app.use((req: any, res: any, next: any) => {
    const forced = process.env.FORCE_HTTPS
      ? !/^(false|0|no)$/i.test(process.env.FORCE_HTTPS)
      : process.env.NODE_ENV === "production";
    if (!forced) return next();
    const proto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (proto === "http" && req.path !== "/health") {
      const host = String(
        req.headers["x-forwarded-host"] || req.headers.host || "",
      )
        .split(",")[0]
        .trim();
      if (/^[a-z0-9.-]+(:\d+)?$/i.test(host))
        return res.redirect(308, `https://${host}${req.originalUrl}`);
    }
    if (proto === "https")
      res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  {
    const raw = String(process.env.TRUST_PROXY || "").trim();
    const trust =
      !raw || /^(false|0|no)$/i.test(raw)
        ? false
        : /^(true|yes)$/i.test(raw)
          ? true
          : /^\d+$/.test(raw)
            ? Number(raw)
            : raw;
    app.set("trust proxy", trust);
  }
  const authIpLimiter = new RateLimiter(60_000, 20);
  const authIdentityLimiter = new RateLimiter(15 * 60_000, 10);
  const authRegisterIpLimiter = new RateLimiter(60 * 60_000, 5);
  const authRegisterIdentityLimiter = new RateLimiter(60 * 60_000, 5);
  function requestIp(req: any) {
    return String(req.ip || req.socket?.remoteAddress || "unknown").slice(
      0,
      100,
    );
  }
  function authRateLimit(
    req: any,
    res: any,
    kind: "general" | "sensitive" | "register",
    identity = "",
  ) {
    const ip = requestIp(req);
    const normalizedIdentity = String(identity || "")
      .trim()
      .toLowerCase()
      .slice(0, 120);
    const ipLimiter =
      kind === "register" ? authRegisterIpLimiter : authIpLimiter;
    const identityLimiter =
      kind === "register" ? authRegisterIdentityLimiter : authIdentityLimiter;
    const ipKey = `${kind}:ip:${ip}`;
    const identityKey = normalizedIdentity
      ? `${kind}:identity:${normalizedIdentity}`
      : "";
    const ipAllowed = ipLimiter.allow(ipKey);
    const identityAllowed = !identityKey || identityLimiter.allow(identityKey);
    if (ipAllowed && identityAllowed) return true;
    const retry = Math.max(
      ipAllowed ? 0 : ipLimiter.retryAfterSeconds(ipKey),
      identityAllowed || !identityKey
        ? 0
        : identityLimiter.retryAfterSeconds(identityKey),
    );
    res.setHeader("Retry-After", String(retry));
    res
      .status(429)
      .json({
        ok: false,
        error: "Too many authentication attempts. Please try again later.",
        retryAfterSeconds: retry,
      });
    return false;
  }
  function parseCookies(req: any) {
    const raw = String(req.headers.cookie || "");
    const out: any = {};
    for (const part of raw.split(";")) {
      const i = part.indexOf("=");
      if (i <= 0) continue;
      const key = part.slice(0, i).trim();
      try {
        out[key] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {}
    }
    return out;
  }
  function cookieSecure() {
    return process.env.NODE_ENV === "production" ? " Secure" : "";
  }
  function setAuthCookies(res: any, accessToken: string, refreshToken: string) {
    const secure = cookieSecure();
    res.setHeader("Set-Cookie", [
      `ashenfall_access=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
      `ashenfall_refresh=${encodeURIComponent(refreshToken)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
    ]);
  }
  function setGuestAccessCookie(res: any, accessToken: string) {
    const secure = cookieSecure();
    res.setHeader(
      "Set-Cookie",
      `ashenfall_access=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
    );
  }
  function setGuestRefreshCookie(res: any, refreshToken: string) {
    const secure = cookieSecure();
    res.append?.(
      "Set-Cookie",
      `ashenfall_guest_refresh=${encodeURIComponent(refreshToken)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
    );
  }
  function clearGuestRefreshCookie(res: any) {
    const secure = cookieSecure();
    res.append?.(
      "Set-Cookie",
      `ashenfall_guest_refresh=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    );
  }
  function clearAuthCookies(res: any) {
    const secure = cookieSecure();
    res.setHeader("Set-Cookie", [
      `ashenfall_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      `ashenfall_refresh=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      `ashenfall_guest_refresh=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    ]);
  }
  async function httpPrincipal(req: any) {
    return authService.principalFromAccessToken(
      parseCookies(req).ashenfall_access,
    );
  }
  function authOk(res: any, data: any = {}) {
    res.json({ ok: true, ...data });
  }
  function authFail(res: any, error: any, status = 400) {
    res
      .status(status)
      .json({
        ok: false,
        error: String(error?.message || error || "Request failed"),
      });
  }
  app.post("/api/auth/register", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "register", req.body?.email)) return;
    try {
      const data = await authService.register(
        req.body?.email,
        req.body?.password,
      );
      authOk(res, {
        message: "Verification code sent. Check your email.",
        ...data,
      });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/verify", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "sensitive", req.body?.email)) return;
    try {
      const data = await authService.verify(req.body?.email, req.body?.code);
      authOk(res, { message: "Email verified. You can now sign in.", ...data });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/resend", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "sensitive", req.body?.email)) return;
    try {
      await authService.resendVerification(req.body?.email);
      authOk(res, { message: "A new verification code was sent." });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/password-reset/request", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "sensitive", req.body?.email)) return;
    try {
      const data = await authService.requestPasswordReset(req.body?.email);
      authOk(res, {
        message: "If that account exists, a reset code has been sent.",
        ...data,
      });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/password-reset/confirm", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "sensitive", req.body?.email)) return;
    try {
      await authService.resetPassword(
        req.body?.email,
        req.body?.code,
        req.body?.password,
      );
      authOk(res, { message: "Password changed. Please sign in again." });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/login", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "sensitive", req.body?.email)) return;
    try {
      const data = await authService.login(req.body?.email, req.body?.password);
      for (const c of clients) {
        if (
          c?.principal?.kind === "account" &&
          c.principal.accountId === data.principal.accountId
        ) {
          try {
            c.socket.close(4409, "This account signed in elsewhere.");
          } catch {}
        }
      }
      setAuthCookies(res, data.accessToken, data.refreshToken);
      authOk(res, { user: { email: data.principal.email, guest: false } });
    } catch (e) {
      authFail(res, e, 401);
    }
  });
  app.post("/api/auth/guest", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "general")) return;
    try {
      const cookies = parseCookies(req);
      const data = await authService.guest(
        req.body?.guestToken || cookies.ashenfall_guest_refresh,
      );
      setGuestAccessCookie(res, data.accessToken);
      setGuestRefreshCookie(res, data.refreshToken);
      authOk(res, { guestId: data.principal.guestId, guest: true });
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/refresh", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "general")) return;
    try {
      const cookies = parseCookies(req);
      const rawRefresh =
        cookies.ashenfall_refresh ||
        cookies.ashenfall_guest_refresh ||
        req.body?.guestToken;
      const data = await authService.refresh(rawRefresh);
      if (data.principal.kind === "guest") {
        setGuestAccessCookie(res, data.accessToken);
        setGuestRefreshCookie(res, data.refreshToken);
      } else setAuthCookies(res, data.accessToken, data.refreshToken);
      authOk(res, {
        user:
          data.principal.kind === "account"
            ? { email: data.principal.email, guest: false }
            : { guest: true, guestId: data.principal.guestId },
      });
    } catch (e) {
      clearAuthCookies(res);
      authFail(res, e, 401);
    }
  });
  app.get("/api/auth/sessions", async (req: any, res: any) => {
    try {
      const p = await httpPrincipal(req);
      if (!p || p.kind !== "account")
        return res
          .status(401)
          .json({ ok: false, error: "Account session required." });
      authOk(res, { sessions: await authService.listSessions(p.accountId) });
    } catch (e) {
      authFail(res, e, 500);
    }
  });
  app.post("/api/auth/logout-all", async (req: any, res: any) => {
    try {
      const p = await httpPrincipal(req);
      if (!p || p.kind !== "account")
        return res
          .status(401)
          .json({ ok: false, error: "Account session required." });
      await authService.logoutAll(p.accountId);
      for (const c of clients) {
        if (
          c?.principal?.kind === "account" &&
          c.principal.accountId === p.accountId
        ) {
          try {
            c.socket.close(1000, "Sessions revoked");
          } catch {}
        }
      }
      clearAuthCookies(res);
      authOk(res, { message: "All account sessions revoked." });
    } catch (e) {
      authFail(res, e, 500);
    }
  });
  app.post("/api/auth/claim-guest", async (req: any, res: any) => {
    try {
      if (!worldLeaseActive || Date.now() >= Number(worldLease?.expiresAt || 0))
        return res
          .status(503)
          .json({
            ok: false,
            error:
              "The game server is changing ownership. Please try again shortly.",
          });
      const p = await httpPrincipal(req);
      if (!p || p.kind !== "account")
        return res
          .status(401)
          .json({ ok: false, error: "Sign in to an account first." });
      const cookies = parseCookies(req);
      const guestToken = String(
        req.body?.guestToken || cookies.ashenfall_guest_refresh || "",
      );
      const result = await authService.claimGuest(p.accountId, guestToken);
      for (const c of clients) {
        if (
          c?.principal?.kind === "guest" &&
          c.principal.guestId === result.guestId
        ) {
          try {
            c.socket.close(1000, "Guest account claimed");
          } catch {}
        }
      }
      clearGuestRefreshCookie(res);
      authOk(res, result);
    } catch (e) {
      authFail(res, e);
    }
  });
  app.post("/api/auth/session", async (req: any, res: any) => {
    if (!authRateLimit(req, res, "general")) return;
    try {
      const p = await httpPrincipal(req);
      if (p)
        return authOk(res, {
          authenticated: true,
          user:
            p.kind === "account"
              ? { email: p.email, guest: false }
              : { guest: true, guestId: p.guestId },
        });
      const cookies = parseCookies(req);
      const rawRefresh =
        cookies.ashenfall_refresh || cookies.ashenfall_guest_refresh;
      if (!rawRefresh) return authOk(res, { authenticated: false });
      try {
        const data = await authService.refresh(rawRefresh);
        if (data.principal.kind === "guest") {
          setGuestAccessCookie(res, data.accessToken);
          setGuestRefreshCookie(res, data.refreshToken);
        } else setAuthCookies(res, data.accessToken, data.refreshToken);
        return authOk(res, {
          authenticated: true,
          user:
            data.principal.kind === "account"
              ? { email: data.principal.email, guest: false }
              : { guest: true, guestId: data.principal.guestId },
        });
      } catch {
        clearAuthCookies(res);
        return authOk(res, { authenticated: false });
      }
    } catch (e) {
      authFail(res, e, 500);
    }
  });
  app.get("/api/auth/me", async (req: any, res: any) => {
    try {
      const p = await httpPrincipal(req);
      if (!p) return res.status(401).json({ ok: false });
      authOk(res, {
        user:
          p.kind === "account"
            ? { email: p.email, guest: false }
            : { guest: true, guestId: p.guestId },
      });
    } catch (e) {
      authFail(res, e, 500);
    }
  });
  app.post("/api/auth/logout", async (req: any, res: any) => {
    try {
      const raw = parseCookies(req).ashenfall_refresh;
      const principal = await httpPrincipal(req);
      if (raw) {
        const crypto = (await import("node:crypto")).default;
        const tokenHash = crypto
          .createHash("sha256")
          .update(String(raw))
          .digest("hex");
        await repo.authDeleteSession(tokenHash);
      }
      if (principal?.kind === "account")
        await repo.authBumpSessionVersion(principal.accountId);
      if (principal) {
        for (const c of clients) {
          if (
            c?.principal?.kind === principal.kind &&
            (principal.kind === "account"
              ? c.principal.accountId === principal.accountId
              : c.principal.guestId === principal.guestId)
          ) {
            try {
              c.socket.close(1000, "Signed out");
            } catch {}
          }
        }
      }
      clearAuthCookies(res);
      authOk(res, { message: "Signed out." });
    } catch (e) {
      authFail(res, e, 500);
    }
  });

  // Static client: gzip text assets (cached in memory per file+mtime) and let browsers revalidate (ETag/304) instead of re-downloading every visit.
  const clientRoot = path.join(root, "client");
  const gzipCache = new Map<string, { mtime: number; buf: Buffer }>();
  const GZIP_TYPES: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".map": "application/json; charset=utf-8",
  };
  app.use((req: any, res: any, next: any) => {
    try {
      if (
        req.method !== "GET" ||
        !/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))
      )
        return next();
      let rel = decodeURIComponent(String(req.path || "/"));
      if (rel.endsWith("/")) rel += "index.html";
      const ext = path.extname(rel).toLowerCase();
      const type = GZIP_TYPES[ext];
      if (!type) return next();
      const file = path.join(clientRoot, rel);
      if (!file.startsWith(clientRoot + path.sep)) return next();
      const st = fs.statSync(file);
      if (!st.isFile()) return next();
      let hit = gzipCache.get(file);
      if (!hit || hit.mtime !== st.mtimeMs) {
        hit = {
          mtime: st.mtimeMs,
          buf: zlib.gzipSync(fs.readFileSync(file), { level: 6 }),
        };
        gzipCache.set(file, hit);
      }
      const etag = `W/"${st.mtimeMs.toString(36)}-${hit.buf.length.toString(36)}"`;
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-cache");
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(hit.buf.length));
      return res.end(hit.buf);
    } catch {
      return next();
    }
  });
  app.use(
    express.static(clientRoot, {
      etag: true,
      lastModified: true,
      setHeaders: (res: any, file: string) => {
        res.setHeader(
          "Cache-Control",
          /\.(png|jpe?g|webp|gif|ico|woff2?|mp3|ogg|wav)$/i.test(file)
            ? "public, max-age=604800"
            : "no-cache",
        );
      },
    }),
  );
  app.get("/game-data/world-layout.json", (req: any, res: any, next: any) =>
    res.sendFile(
      path.join(root, "game-data", "world-layout.json"),
      { etag: false, cacheControl: false },
      (error: any) => {
        if (error) next(error);
      },
    ),
  );
  app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION }));
  app.get("/metrics.json", (req: any, res: any) => {
    const token = String(process.env.ASHENFALL_METRICS_TOKEN || "");
    if (!token) return res.status(404).json({ ok: false });
    const given = String(req.headers?.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const a = Buffer.from(given),
      b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return res.status(401).json({ ok: false });
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      characters: repo.allPlayers().filter((x: any) => x?.hasCharacter).length,
      onlineConnections: clients.size,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
    });
  });
  app.get("/ready", async (_req, res) => {
    try {
      const stats = await Promise.resolve(repo.stats?.());
      const ready = !!stats && telemetry.persistence.failures < 5;
      res.status(ready ? 200 : 503).json({ ok: ready, version: VERSION });
    } catch {
      res.status(503).json({ ok: false, version: VERSION });
    }
  });
  const server = http.createServer(app);
  const MAX_WS_CONNECTIONS = boundedInt(
    process.env.ASHENFALL_MAX_WS_CONNECTIONS,
    1,
    10_000,
    1000,
  );
  const MAX_WS_MESSAGE_BYTES = GAME_RUNTIME.maxWsMessageBytes;
  const COMMANDS_PER_SECOND = boundedInt(
    process.env.ASHENFALL_COMMANDS_PER_SECOND,
    10,
    1000,
    GAME_RUNTIME.commandsPerSecond,
  );
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    clientTracking: true,
    perMessageDeflate: {
      threshold: 512,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 3 },
      concurrencyLimit: 8,
    },
    maxPayload: MAX_WS_MESSAGE_BYTES,
  });
  const activeAccountConnections = new Map<string, any>();

  const LIGHTWEIGHT_ACK_COMMANDS = new Set([
    "move",
    "move_input",
    "stop",
    "target_mob",
    "select_mob",
  ]);
  const FANOUT_COALESCE_MS = 100;
  let fanoutTimer: any = null,
    fanoutSections: any = {},
    fanoutChatZones = new Set<any>(),
    fanoutOrigins = new Set<any>();
  function scheduleStateFanout(origin: any, sections: any) {
    Object.assign(fanoutSections, sections || {});
    fanoutOrigins.add(origin);
    if (sections?.chat && origin?.player?.zone)
      fanoutChatZones.add(origin.player.zone);
    if (fanoutTimer) return;
    fanoutTimer = setTimeout(() => {
      const merged = fanoutSections,
        chatZones = fanoutChatZones,
        origins = fanoutOrigins;
      fanoutTimer = null;
      fanoutSections = {};
      fanoutChatZones = new Set();
      fanoutOrigins = new Set();
      for (const other of clients) {
        if (!other?.player) continue;
        if (origins.size === 1 && origins.has(other)) continue;
        const otherSections = { ...merged };
        if (merged.chat) otherSections.chat = chatZones.has(other.player.zone);
        if (merged.worldMapNpcs) otherSections.worldMapNpcs = false;
        try {
          wsSend(other, {
            type: "state",
            data: state(other, false, otherSections),
          });
        } catch (error: any) {
          console.warn("[ws] state fan-out failed", error?.message || error);
        }
      }
    }, FANOUT_COALESCE_MS);
    fanoutTimer.unref?.();
  }
  const accountCharacterIndex = new Map<string, string>();
  function findAccountCharacter(ownerId: any) {
    const key = String(ownerId || "");
    const cachedId = accountCharacterIndex.get(key);
    if (cachedId) {
      const hit = repo.getPlayer(cachedId);
      if (hit?.hasCharacter && hit.accountId === ownerId) return hit;
      accountCharacterIndex.delete(key);
    }
    const found =
      repo
        .allPlayers()
        .find((x: any) => x?.hasCharacter && x?.accountId === ownerId) || null;
    if (found) accountCharacterIndex.set(key, String(found.id));
    return found;
  }
  const ALLOWED_WS_ORIGINS = new Set(
    String(process.env.ASHENFALL_ALLOWED_ORIGINS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  function wsOriginAllowed(request: any) {
    const origin = String(request.headers?.origin || "").trim();
    if (!origin) return true;
    try {
      const u = new URL(origin);
      if (
        u.host.toLowerCase() ===
        String(request.headers?.host || "").toLowerCase()
      )
        return true;
      return (
        ALLOWED_WS_ORIGINS.has(origin.toLowerCase()) ||
        ALLOWED_WS_ORIGINS.has(u.host.toLowerCase())
      );
    } catch {
      return false;
    }
  }
  wss.on("connection", (socket, request) => {
    if (!wsOriginAllowed(request)) {
      try {
        socket.close(4403, "Origin not allowed");
      } catch {}
      return;
    }
    let setupClosed = false;
    let connectionContext: any = null;
    socket.once("close", () => {
      setupClosed = true;
    });
    void (async () => {
      if (
        !worldLeaseActive ||
        Date.now() >= Number(worldLease?.expiresAt || 0)
      ) {
        socket.close(
          4410,
          "This server no longer owns the authoritative world.",
        );
        return;
      }
      if (clients.size >= MAX_WS_CONNECTIONS) {
        telemetry.recordSocket(false);
        socket.close(4429, "Server is full. Please try again later.");
        return;
      }
      const principal = await authService.principalFromAccessToken(
        parseCookies(request).ashenfall_access,
      );
      if (setupClosed || socket.readyState !== WebSocket.OPEN) return;
      if (!principal) {
        telemetry.recordSocket(false);
        socket.close(4401, "Authentication required");
        return;
      }
      const startZone = zones[0],
        ownerId = authService.ownerId(principal);
      const persistedCharacter = findAccountCharacter(ownerId);
      telemetry.recordSocket(true);
      const c: any = {
        socket,
        principal,
        player: persistedCharacter || createPlayer("", null, startZone),
        isAlive: true,
        isAliveAt: Date.now(),
      };
      connectionContext = c;
      if (principal.kind === "account") {
        const previous = activeAccountConnections.get(
          String(principal.accountId),
        );
        if (previous && previous !== c) {
          try {
            previous.socket.close(
              4411,
              "This account is already active in another tab or browser.",
            );
          } catch {}
        }
        activeAccountConnections.set(String(principal.accountId), c);
      }
      guardPlayerRuntime(c.player);
      c.player.accountId = ownerId;
      if (persistedCharacter) {
        const active = activeSessions.get(persistedCharacter.id);
        if (active && active !== c) {
          try {
            active.socket.close(
              4009,
              "Character connected from another session.",
            );
          } catch {}
          activeSessions.delete(persistedCharacter.id);
        }
        c.player.online = true;
        c.player.lastLoginAt = Date.now();
        c.player.lastSeenAt = c.player.lastLoginAt;
        c.player.sessionEpoch = Number(c.player.sessionEpoch || 0) + 1;
        c.player.combatFx = c.player.combatFx || [];
        c.player.combat = c.player.combat || {};
        const dungeonResume = dungeonEngine.reconnect(c.player);
        if (!dungeonResume[0]) {
          console.warn(
            `Persisted character ${c.player.id} could not resume dungeon state: ${dungeonResume[1] || "unknown error"}`,
          );
          c.player.dungeon = null;
          c.player.encounterId = null;
          c.player.worldCombatMobId = null;
        }
        const cls =
          classes[c.player.classId] ||
          (Array.isArray(classes)
            ? classes.find((x: any) => x?.id === c.player.classId)
            : null);
        if (cls) {
          c.player.icon = cls.icon || c.player.icon;
          c.player.role = cls.role || c.player.role;
          c.player.partyRole = cls.partyRole || c.player.partyRole;
          c.player.resourceName = cls.resource || c.player.resourceName;
          c.player.resourceIcon = cls.resourceIcon || c.player.resourceIcon;
          const allowed = new Set(cls.abilities || []);
          const starter =
            cls.startSkills && cls.startSkills.length
              ? cls.startSkills
              : (cls.abilities || [])
                  .filter((id: any) => (cls.abilityUnlocks || {})[id] <= 1)
                  .slice(0, 3);
          const known = (c.player.abilityIds || []).filter((id: any) =>
            allowed.has(id),
          );
          for (const id of starter) {
            if (known.length >= 3) break;
            if (!known.includes(id)) known.push(id);
          }
          c.player.abilityIds = known;
          c.player.learnedSkills = [
            ...new Set([
              ...(c.player.learnedSkills || []).filter((id: any) =>
                allowed.has(id),
              ),
              ...known,
            ]),
          ];
          c.player.knownAbilities = [...known];
        }
        quest.ensure(c.player);
        normalizeXpTrack(c.player);
        inv.recalc(c.player);
        normalizeMovement(c.player);
        normalizeStoryQuest(c.player);
        reconcileTravelQuestState(c.player);
        await repo.savePlayerNow(c.player);
        if (setupClosed || socket.readyState !== WebSocket.OPEN) {
          c.player.online = false;
          if (activeAccountConnections.get(String(principal.accountId)) === c)
            activeAccountConnections.delete(String(principal.accountId));
          return;
        }
        activeSessions.set(c.player.id, c);
      } else {
        c.player.combatFx = [];
        quest.ensure(c.player);
        inv.recalc(c.player);
      }
      clients.add(c);
      console.log(
        `[net] connect player=${String(c.player?.id || "?").slice(0, 12)} kind=${c.principal?.kind || "?"} ip=${requestIp(request)} total=${clients.size}`,
      );
      socket.on("pong", () => {
        c.isAlive = true;
        c.isAliveAt = Date.now();
      });
      wsSend(c, {
        type: "welcome",
        data: {
          message: "Welcome to Ashenfall",
          protocol: "ashenfall-v1",
          serverTime: Date.now(),
        },
      });
      try {
        wsSend(c, { type: "state", data: state(c, true) });
      } catch (error) {
        console.error("Initial state generation failed:", error);
        try {
          socket.close(1011, "Initial state unavailable.");
        } catch {}
        clients.delete(c);
        if (
          principal.kind === "account" &&
          activeAccountConnections.get(String(principal.accountId)) === c
        )
          activeAccountConnections.delete(String(principal.accountId));
        return;
      }
      const requestDedupe = createRequestDedupe(
        GAME_RUNTIME.requestDedupeLimit,
        GAME_RUNTIME.requestDedupeTtlMs,
      );
      const commandLimiter = createWindowRateLimiter(COMMANDS_PER_SECOND, 1000);
      const commandExecutor = createSerialExecutor(
        GAME_RUNTIME.maxSerialQueueDepth,
      );
      socket.on("message", (raw) => {
        void commandExecutor
          .run(async () => {
            try {
              if (
                !worldLeaseActive ||
                Date.now() >= Number(worldLease?.expiresAt || 0)
              ) {
                worldLeaseActive = false;
                try {
                  socket.close(
                    4410,
                    "This server no longer owns the authoritative world.",
                  );
                } catch {}
                return;
              }
              const text = raw.toString();
              if (Buffer.byteLength(text, "utf8") > MAX_WS_MESSAGE_BYTES)
                throw new Error("Message too large.");
              if (!commandLimiter.allow())
                throw new Error("Too many commands. Slow down.");
              const cmd = JSON.parse(text);
              if (cmd?.type === "ping") {
                wsSend(c, {
                  type: "pong",
                  serverTime: Date.now(),
                  clientSentAt: Number.isFinite(Number(cmd.clientSentAt))
                    ? Number(cmd.clientSentAt)
                    : null,
                });
                return;
              }
              if (
                c.principal?.kind === "account" &&
                !(await authService.isPrincipalCurrent(c.principal))
              ) {
                try {
                  socket.close(
                    4409,
                    "This account session has been replaced. Sign in again.",
                  );
                } catch {}
                return;
              }
              if (
                !cmd ||
                typeof cmd.action !== "string" ||
                cmd.action.length > 64 ||
                !/^[a-z][a-z0-9_]*$/.test(cmd.action)
              )
                throw new Error("Invalid command.");
              const requestId = boundedString(cmd.requestId, 96, "");
              if (requestId) {
                const cached = requestDedupe.get(requestId);
                if (cached) {
                  wsSend(c, cached);
                  return;
                }
              }
              const r = await handle(c.player, cmd);
              telemetry.recordCommand(cmd.action, !!r[0]);
              if (
                r[0] &&
                (cmd.action === "create_character" ||
                  cmd.action === "resume_character") &&
                c.player?.hasCharacter
              ) {
                activeSessions.set(c.player.id, c);
              }
              const detail =
                r.length > 2
                  ? r[2]
                  : typeof r[1] === "object"
                    ? r[1]
                    : undefined;
              const msg = typeof r[1] === "string" ? r[1] : "Done.";
              if (!TRANSIENT_COMMANDS.has(cmd.action)) {
                uiRevisionRef.value++;
              }
              stateRevisionRef.value++;
              const sections = sectionsForCommand(cmd.action);
              const lightweightAck =
                !!r[0] &&
                LIGHTWEIGHT_ACK_COMMANDS.has(cmd.action) &&
                !(
                  Date.now() - Number(c.player.combat?.castEventAt || 0) <
                  1500
                );
              const authoritative = lightweightAck
                ? undefined
                : state(
                    c,
                    cmd.action === "create_character" ||
                      cmd.action === "resume_character",
                    sections,
                  );
              const response = {
                type: "command_result",
                data: {
                  ok: r[0],
                  message: msg,
                  detail,
                  state: authoritative,
                  action: cmd.action,
                  requestId: requestId || null,
                  createCharacter: cmd.action === "create_character",
                },
              };
              if (requestId) requestDedupe.set(requestId, response);
              wsSend(c, response);
              if (!TRANSIENT_COMMANDS.has(cmd.action))
                scheduleStateFanout(c, sections);
            } catch (err) {
              telemetry.recordCommand("unknown", false, true);
              console.error("ws command error", err);
              wsSend(c, {
                type: "error",
                data: { message: err?.message || "Command failed" },
              });
            }
          })
          .catch((error: any) => {
            if (
              String(error?.message || error).includes("Command queue is full.")
            ) {
              try {
                socket.close(
                  4429,
                  "Too many queued commands. Please slow down.",
                );
              } catch {}
              return;
            }
            console.error("ws command executor failed:", error);
            try {
              if (socket.readyState === WebSocket.OPEN)
                wsSend(c, {
                  type: "error",
                  data: {
                    message:
                      "Command could not be processed. Please try again.",
                  },
                });
            } catch {}
          });
      });
      socket.on("close", () => {
        const isCurrentSession = activeSessions.get(c.player.id) === c;
        if (isCurrentSession) activeSessions.delete(c.player.id);
        if (isCurrentSession) {
          tradeRequests.delete(c.player.id);
          for (const [id, t] of tradeSessions)
            if (t.a === c.player.id || t.b === c.player.id)
              tradeSessions.delete(id);
        }
        clients.delete(c);
        if (
          c.principal?.kind === "account" &&
          activeAccountConnections.get(String(c.principal.accountId)) === c
        )
          activeAccountConnections.delete(String(c.principal.accountId));
        telemetry.recordClose();
        c.isAlive = false;
        if (isCurrentSession) {
          void (async () => {
            const disconnect = async () => {
              if (
                activeSessions.has(String(c.player.id)) ||
                [...clients].some(
                  (o: any) => o !== c && o.player?.id === c.player.id,
                ) ||
                (c.principal?.kind === "account" &&
                  activeAccountConnections.has(String(c.principal.accountId)) &&
                  activeAccountConnections.get(
                    String(c.principal.accountId),
                  ) !== c)
              )
                return;
              dungeonEngine.markDisconnected(c.player);
              social.onDisconnect(c.player);
              if (c.player?.hasCharacter) {
                c.player.lastSeenAt = Date.now();
                c.player.online = false;
              }
              if (
                c.player.hasCharacter &&
                worldLeaseActive &&
                Date.now() < Number(worldLease?.expiresAt || 0)
              )
                await repo.savePlayerNow(c.player);
            };
            try {
              if (playerMutations?.withPlayer)
                await playerMutations.withPlayer(
                  String(c.player.id),
                  disconnect,
                );
              else await disconnect();
            } catch (error) {
              console.error("Disconnected player save failed:", error);
            }
            try {
              const registryPlayers = repo.allPlayers?.() || world.players;
              const sweepAndPersist = async () => {
                const result = sweepGeneratedItemRegistry({
                  players: registryPlayers,
                  items,
                  economy,
                  now: Date.now(),
                });
                for (const changedPlayer of result.changedPlayers || [])
                  await repo.savePlayerNow(changedPlayer);
              };
              if (playerMutations?.withPlayers)
                await playerMutations.withPlayers(
                  registryPlayers.map((x: any) => String(x.id)),
                  sweepAndPersist,
                );
              else await sweepAndPersist();
            } catch (error) {
              console.error("Generated item registry sweep failed:", error);
            }
            uiRevisionRef.value++;
            bus.emit("player.disconnected", { playerId: c.player.id });
            broadcast();
          })();
        }
      });
      socket.on("error", (err) => {
        console.error("ws socket error", err);
      });
    })().catch((error: any) => {
      console.error("WebSocket connection setup failed:", error);
      const c = connectionContext;
      if (c) {
        clients.delete(c);
        if (activeSessions.get(c.player?.id) === c)
          activeSessions.delete(c.player.id);
        if (
          c.principal?.kind === "account" &&
          activeAccountConnections.get(String(c.principal.accountId)) === c
        )
          activeAccountConnections.delete(String(c.principal.accountId));
        if (c.player?.hasCharacter) {
          const markOffline = () => {
            if (
              activeSessions.has(String(c.player.id)) ||
              (c.principal?.kind === "account" &&
                activeAccountConnections.has(String(c.principal.accountId)) &&
                activeAccountConnections.get(String(c.principal.accountId)) !==
                  c)
            )
              return;
            c.player.online = false;
          };
          const operation = playerMutations?.withPlayer
            ? playerMutations.withPlayer(String(c.player.id), markOffline)
            : Promise.resolve().then(markOffline);
          void operation.catch((mutationError: any) =>
            console.error(
              "Failed to clear player online state after setup failure:",
              mutationError,
            ),
          );
        }
      }
      try {
        if (socket.readyState === WebSocket.OPEN)
          socket.close(1011, "Connection setup failed. Please reconnect.");
      } catch {}
    });
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      const socket = c.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (c.isAlive === false) {
        try {
          socket.terminate();
        } catch {}
        continue;
      }
      c.isAlive = false;
      try {
        socket.ping();
      } catch {
        try {
          socket.terminate();
        } catch {}
      }
    }
  }, 30000);
  heartbeat.unref?.();
  // Ops visibility: one log line a minute while anyone is connected, so unexpected traffic (open tabs, bots) shows up in Railway logs.
  let lastNetLog = { full: 0, motion: 0 };
  const netLog = setInterval(() => {
    try {
      const nm: any = networkMetrics;
      const full = Number(nm.fullBytes || 0),
        motion = Number(nm.motionBytes || 0);
      if (
        clients.size > 0 ||
        full + motion > lastNetLog.full + lastNetLog.motion
      ) {
        const kb = (n: number) => Math.round(n / 1024);
        console.log(
          `[net] connections=${clients.size} sent_last_min: state=${kb(full - lastNetLog.full)}KB motion=${kb(motion - lastNetLog.motion)}KB skipped(state/motion)=${nm.fullSkipped || 0}/${nm.motionSkipped || 0}`,
        );
      }
      const dbs: any = (repo as any).takeWriteStats?.();
      if (dbs && (dbs.players || dbs.economy || dbs.world)) {
        const mb = (n: number) => (n / 1048576).toFixed(1);
        console.log(
          `[db] written_last_min: players=${mb(dbs.players)}MB economy=${mb(dbs.economy)}MB world=${mb(dbs.world)}MB`,
        );
      }
      lastNetLog = { full, motion };
    } catch {}
  }, 60000);
  netLog.unref?.();
  const TICK_MS = GAME_RUNTIME.tickMs;
  const FULL_STATE_BROADCAST_MS = GAME_RUNTIME.stateBroadcastMs;

  let lastBroadcastAt = 0;
  const rawBroadcast = stateBroadcast;
  const broadcast = () => {
    const n = Date.now();
    if (n - lastBroadcastAt < FULL_STATE_BROADCAST_MS) return;
    lastBroadcastAt = n;
    rawBroadcast();
  };

  bus.on("command.received", (e) => {});
  bus.on("skill.used", (e) => {});
  bus.on("combat.attack", (e) => {});
  bus.on("zone.changed", (e) => {});

  const simulationCoordinator = new AuthoritativeSimulationCoordinator(
    {
      ...context,
      playerCombatSimulation,
      worldCombatSimulation,
      combatVictory,
    },
    {
      send,
      performWorldBasicAttack,
      awaitOrSyncCheckpoint,
      broadcast: () => broadcast(),
      broadcastMotion: (serverNow: number) => broadcastMotion(serverNow),
    },
  );

  let worldLeaseActive = true;
  const outboxWorker = new DurableOutboxWorker(
    repo,
    worldSimulation,
    () => worldLeaseActive && Date.now() < Number(worldLease?.expiresAt || 0),
  );
  const LEASE_MS = 30_000;
  let leaseRenewInFlight = false;
  const renewWorldLeaseWithRecovery = async () => {
    if (leaseRenewInFlight) return;
    leaseRenewInFlight = true;
    try {
      const now = Date.now();
      const renewed = await Promise.resolve(
        repo.renewWorldLease?.(
          WORLD_LEASE_ID,
          worldLeaseOwnerId,
          Number(worldLease?.fencingToken || 0),
          now,
          LEASE_MS,
        ),
      );
      if (renewed) {
        worldLeaseActive = true;
        worldLease.expiresAt = now + LEASE_MS;
        return;
      }
      worldLeaseActive = false;
      const acquired = await Promise.resolve(
        repo.acquireWorldLease?.(
          WORLD_LEASE_ID,
          worldLeaseOwnerId,
          Date.now(),
          LEASE_MS,
        ),
      );
      if (acquired?.acquired) {
        worldLease.fencingToken = Number(acquired.fencingToken);
        worldLease.expiresAt = Number(acquired.expiresAt);
        repo.setWorldLeaseContext?.(
          WORLD_LEASE_ID,
          worldLeaseOwnerId,
          Number(acquired.fencingToken),
        );
        worldLeaseActive = true;
        console.warn(
          "Authoritative world lease reacquired after a missed renewal.",
          { fencingToken: worldLease.fencingToken },
        );
        return;
      }
      console.error(
        "Authoritative world lease is owned by another process; simulation remains fenced off.",
      );
      for (const c of clients) {
        try {
          c.socket.close(
            4410,
            "Authoritative world ownership was lost. Reconnecting when available.",
          );
        } catch {}
      }
    } catch (error) {
      worldLeaseActive = false;
      console.error(
        "Authoritative world lease renewal/reacquisition failed; simulation fenced off:",
        error,
      );
      for (const c of clients) {
        try {
          c.socket.close(
            4410,
            "Authoritative world ownership is temporarily unavailable. Reconnecting when available.",
          );
        } catch {}
      }
    } finally {
      leaseRenewInFlight = false;
    }
  };
  const leaseRenewTimer = setInterval(() => {
    void renewWorldLeaseWithRecovery();
  }, 10_000);
  leaseRenewTimer.unref?.();
  const tickScheduler = createFixedTickScheduler((scheduledAt) => {
    if (!worldLeaseActive || Date.now() >= Number(worldLease?.expiresAt || 0)) {
      worldLeaseActive = false;
      return;
    }
    try {
      simulationCoordinator.tick(scheduledAt);
    } catch (error) {
      console.error("Authoritative tick failure:", error);
    }
  }, TICK_MS);
  tickScheduler.start();
  outboxWorker.start();
  const authCleanupTimer = setInterval(() => {
    try {
      Promise.resolve(repo.authCleanup?.()).catch((e: any) =>
        console.warn("Auth session cleanup failed:", e?.message || e),
      );
    } catch (e: any) {
      console.warn("Auth session cleanup failed:", e?.message || e);
    }
  }, GAME_RUNTIME.authCleanupMs);
  authCleanupTimer.unref?.();
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(
      `Ashenfall v${VERSION} running on 0.0.0.0:${process.env.PORT || 3000}`,
    ),
  );
  const shutdown = () => {
    tickScheduler.stop();
    outboxWorker.stop();
    clearInterval(authCleanupTimer);
    clearInterval(heartbeat);
    clearInterval(netLog);
    clearInterval(leaseRenewTimer);
  };
  server.once("close", shutdown);
  return {
    app,
    server,
    wss,
    tick: (scheduledAt = Date.now()) => {
      if (!worldLeaseActive || Date.now() >= Number(worldLease?.expiresAt || 0))
        throw new Error(
          "This process no longer owns the authoritative world lease.",
        );
      return simulationCoordinator.tick(scheduledAt);
    },
    shutdown,
  };
}
