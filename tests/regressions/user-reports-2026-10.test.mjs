import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const economy = fs.readFileSync(
  path.join(root, "server/economy/Economy.ts"),
  "utf8",
);
const coordinator = fs.readFileSync(
  path.join(root, "server/runtime/AuthoritativeSimulationCoordinator.ts"),
  "utf8",
);
const mobs = fs.readFileSync(
  path.join(root, "server/world/MobSimulationService.ts"),
  "utf8",
);
if (
  !economy.includes("if(now<this.nextCleanupAt)return false;") ||
  !economy.includes("this.nextCleanupAt=now+1000;")
)
  throw new Error("auction cleanup is not throttled to once per second");
if (
  !economy.includes("this.cleanupWarnedAt.get(warningKey)") ||
  !economy.includes("now-lastWarn>=30_000")
)
  throw new Error("auction cleanup warning is not rate-limited per listing");
if (
  !economy.includes(
    "The seller’s mailbox is full of unclaimed auction attachments. The seller must claim their mail before this buyout can complete.",
  )
)
  throw new Error("buyout does not explain full seller mailbox");
if (
  !coordinator.includes(
    "(p.combat?.autoAttack || p.combat?.queuedWorldAbility || p.combat?.autoApproach)",
  )
)
  throw new Error(
    "combat approach does not continuously reconcile attack intent",
  );
if (
  !coordinator.includes(
    "const approachMeters=Math.max(basicRange,queuedRange>0?queuedRange:0);",
  )
)
  throw new Error(
    "combat approach does not account for basic-attack and queued-skill ranges",
  );
const returning = mobs.slice(
  mobs.indexOf("if(m.state==='returning')"),
  mobs.indexOf("if(m.state==='idle'&&!m.roaming&&now>m.wanderUntil)"),
);
const wandering = mobs.slice(
  mobs.indexOf("if(m.state==='idle'&&!m.roaming){const d="),
);
if (!returning.includes("this.world.resolveWalkableStep("))
  throw new Error("return-home movement bypasses walkability");
if (!wandering.includes("this.world.resolveWalkableStep("))
  throw new Error("idle wandering bypasses walkability");
console.log(
  "user-fixes-2026-10-15: PASS — cleanup throttling, per-listing warning rate limit, actionable mailbox error, dynamic combat-range pursuit, and mob return/wander collision checks",
);
