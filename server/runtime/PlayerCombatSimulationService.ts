import { healingThreat } from "../combat/PartyCombat.js";
export class PlayerCombatSimulationService {
  combat: any;
  world: any;
  constructor({ combat, world }: { combat: any; world: any }) {
    this.combat = combat;
    this.world = world;
  }

  tick(p: any, now = Date.now()) {
    this.tickHot(p, now);
    this.tickHealth(p, now);
    this.tickResolve(p, now);
    if (!p.partyId || this.combat.shouldTickEncounter(p))
      this.combat.enemyTick(p, now);
    this.expireTimedBuffs(p, now);
  }

  private tickHot(p: any, now: number) {
    if (!p.statuses?.length) return;
    for (const st of [...p.statuses]) {
      if (!st?.id?.startsWith("hot_")) continue;
      if (now >= Number(st.until || 0)) {
        p.statuses = p.statuses.filter((x: any) => x !== st);
        continue;
      }
      if (now - Number(st.lastTick || 0) < 1000) continue;
      st.lastTick = now;
      const source = st.sourcePlayerId
        ? this.world.players.find((x: any) => x.id === st.sourcePlayerId)
        : p;
      const healingMultiplier = Number(
        st.snapshotHealingMultiplier ||
          Math.max(0.5, Number(source?.combatProfile?.healing || 1)),
      );
      const healingBonus = Number(st.snapshotHealingBonus || 0);
      const synergyMultiplier = Number(st.snapshotSynergyMultiplier || 1);
      const antiHeal = Math.max(
        0,
        1 + Number(this.combat.statusModifier(p, "healing", now) || 0) / 100,
      );
      const heal = Math.max(
        0,
        Math.round(
          p.maxHp *
            Number(st.tickHeal || 0) *
            healingMultiplier *
            (1 + healingBonus / 100) *
            synergyMultiplier *
            antiHeal,
        ),
      );
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + heal);
      const actual = p.hp - before;
      if (actual > 0 && source) {
        this.combat.gearAfterHeal(source, null, actual, now);
        if (source !== p && source.encounterId === p.encounterId) {
          const e = this.combat.get(source.encounterId);
          if (e && e.state === "running")
            e.threat[source.id] =
              (e.threat[source.id] || 0) + this.healingThreat(source, actual);
        }
      }
    }
  }

  private healingThreat(player: any, amount: number) {
    return healingThreat(player, amount);
  }

  private tickHealth(p: any, now: number) {
    if (!p || p.dead || Number(p.hp || 0) >= Number(p.maxHp || 0)) return;
    const mobId = p.worldCombatMobId;
    const mob = mobId ? this.world.byIdMob?.(mobId) : null;
    const activeWorldCombat =
      !!mobId &&
      !!mob &&
      mob.state === "engaged" &&
      (mob.aggroTarget === p.id || !!mob.attackers?.[p.id]);
    const activeEncounter = !!p.encounterId;
    if (activeWorldCombat || activeEncounter) {
      p._hpRegenAt = now;
      return;
    }
    p._hpRegenAt ??= now;
    const lastDamage = Number(p._lastDamageAt || 0);
    if (lastDamage && now - lastDamage < 5000) {
      p._hpRegenAt = now;
      return;
    }
    if (now - p._hpRegenAt < 1000) return;
    const ticks = Math.floor((now - p._hpRegenAt) / 1000);
    const regenPerSecond =
      Math.max(1, Number(p.maxHp || 1) * 0.02) +
      Math.max(0, Number(p.bonuses?.hpRegen || 0));
    p.hp = Math.min(
      Number(p.maxHp || 0),
      Number(p.hp || 0) + regenPerSecond * ticks,
    );
    p.hp = Math.round(p.hp * 100) / 100;
    p._hpRegenAt += ticks * 1000;
  }

  private tickResolve(p: any, now: number) {
    if (p.resolve < p.maxResolve) {
      p._resolveRegenAt ??= now;
      if (now - p._resolveRegenAt >= 500) {
        const ticks = Math.floor((now - p._resolveRegenAt) / 500);
        const regenPerSecond =
          Number(p.resourceSpec?.regenPerSecond || 4) +
          Number(p.bonuses?.resolveRegen || 0) * 2;
        p.resolve = Math.min(
          p.maxResolve,
          Math.round(
            (Number(p.resolve || 0) + (regenPerSecond / 2) * ticks) * 100,
          ) / 100,
        );
        p._resolveRegenAt += ticks * 500;
      }
    } else p._resolveRegenAt = now;
  }

  private expireTimedBuffs(p: any, now: number) {
    if (!p.combat) return;
    const map: any = {
      guardUntil: "guard",
      shieldWallUntil: "shield_wall",
      barrierUntil: "barrier",
      arcaneSurgeUntil: "arcane_surge",
      shadowDanceUntil: "shadow_dance",
      stealthUntil: "stealth",
      rootwardUntil: "rootward",
    };
    for (const key of Object.keys(map))
      if (p.combat[key] && p.combat[key] < now) {
        const id = map[key];
        p.combat[key] = 0;
        p.statuses = (p.statuses || []).filter(
          (s: any) => String(typeof s === "string" ? s : s?.id || "") !== id,
        );
      }
  }
}
