import { rollDamage } from "./CombatFormula.js";
import { applyDiminishingReturns, rollAvoidance } from "./CombatTable.js";
import { pushFx } from "./CombatEffects.js";
import {
  validateCombatActor,
  validateAbilityOwnership,
  validateResourceAndCooldown,
  validateTargetRule,
} from "./CombatAuthority.js";

export class PvpCombatService {
  engine: any;
  constructor(engine: any) {
    this.engine = engine;
  }

  private pvpAvoided(p: any, target: any, n: number, abilityId: any = null) {
    const outcome = rollAvoidance(target, Number(p.level || 1));
    if (!outcome) return null;
    target._lastDamageAt = n;
    target._hpRegenAt = n;
    pushFx(target, "avoid", p.id, target.id, abilityId, {
      outcome,
      durationMs: 900,
    });
    pushFx(p, "miss", p.id, target.id, abilityId, { outcome, durationMs: 900 });
    return outcome;
  }
  executePvpBasic(p, target: any, n = Date.now()) {
    const actor = validateCombatActor(p, n);
    if (!actor[0]) return actor;
    if (!target || target.dead || !target.online || target.zone !== p.zone)
      return [false, "Your opponent is unavailable."];
    const attackRangeMeters = Math.max(
      1,
      Number(this.engine.world.combatRangeMeters?.(p) || 18),
    );
    const attackRange = this.engine.world.normalizedMeters(
      p.zone,
      attackRangeMeters,
    );
    if (Math.hypot(p.x - target.x, p.y - target.y) > attackRange)
      return [false, "Move into attack range."];
    if (Number(p.combat?.gcdReadyAt || 0) > n)
      return [false, "Global cooldown active."];
    const basicAbility = { id: "basic_strike", name: "Basic Strike", power: 1 };
    const gearCast = this.engine.gearBeforeCast(p, basicAbility, target, n);
    const nextPowerPct = Number(p.combat?.gearNextPowerPct || 0);
    p.combat.gearNextPowerPct = 0;
    const pvpPower =
      (p.combat?.shadowDanceUntil > n ? 1.2 : 1) *
      (p.combat?.pvpStealthUntil > n ? 1.35 : 1) *
      this.engine.gearAbilityMultiplier(p, "basic_strike") *
      (1 + nextPowerPct / 100) *
      (1 + Number(gearCast.powerPct || 0) / 100);
    {
      const avoided = this.pvpAvoided(p, target, n, "basic_strike");
      if (avoided) {
        p.statuses = (p.statuses || []).filter(
          (x: any) => (typeof x === "string" ? x : x?.id) !== "stealth",
        );
        p.combat.pvpStealthUntil = 0;
        p.combat.gcdReadyAt = n + 1200;
        return [
          true,
          avoided === "dodge"
            ? `${target.name} dodges your attack.`
            : `You miss ${target.name}.`,
          { pvp: true, damage: 0, avoided, targetId: target.id },
        ];
      }
    }
    const rolled = rollDamage({
      attack: Number(p.pvpRuntimeStats?.attack || p.attack || 0),
      power: pvpPower,
      armor: Number(target.pvpRuntimeStats?.armor || target.armor || 0),
      attackerLevel: Number(p.level || 1),
      critChance: p.bonuses?.crit || 0,
      damageBonus:
        Number(p.bonuses?.damage || 0) +
        (p.statuses || [])
          .filter((s: any) => s?.until > n && s.modifiers)
          .reduce(
            (m: number, s: any) => m + Number(s.modifiers?.damage || 0),
            0,
          ),
    });
    const mitigation = target.combat?.barrierUntil > n ? 0.55 : 1;
    const takenMult =
      Number(this.engine.targetDamageTakenMultiplier?.(target)) || 1;
    const pvpCap = Math.max(1, Math.round(Number(target.maxHp || 1) * 0.18));
    const damage = Math.min(
      pvpCap,
      Math.max(
        1,
        Math.round(
          (Number(rolled.damage) || 0) * 0.65 * mitigation * takenMult,
        ),
      ),
    );
    target._lastDamageAt = n;
    target._hpRegenAt = n;
    target.hp = Math.max(0, target.hp - damage);
    p.statuses = (p.statuses || []).filter(
      (x: any) => (typeof x === "string" ? x : x?.id) !== "stealth",
    );
    p.combat.pvpStealthUntil = 0;
    p.combat.gcdReadyAt = n + 1200;
    pushFx(p, "slash", p.id, target.id);
    pushFx(p, "damage", p.id, target.id, null, {
      amount: damage,
      crit: rolled.crit,
    });
    if (target.hp <= 0) {
      target.dead = true;
      target.respawnAt = n + 5000;
      target.respawnReady = false;
      target.respawnMessage = `Defeated by ${p.name}.`;
    }
    this.engine.gearAfterHit(
      p,
      basicAbility,
      target,
      { damage, crit: !!rolled.crit, killed: target.hp <= 0 },
      n,
    );
    return [
      true,
      `You hit ${target.name} for ${damage}.`,
      {
        pvp: true,
        damage,
        targetId: target.id,
        killed: target.dead,
        crit: rolled.crit,
      },
    ];
  }

  executePvpCast(
    p,
    a0: any,
    targetId: any = null,
    opponents: any[] = [],
    allies: any[] = [],
    n = Date.now(),
  ) {
    const a = this.engine.transformedAbility(p, a0);
    const actor = validateCombatActor(p, n);
    if (!actor[0]) return actor;
    const own = validateAbilityOwnership(p, a.id, a);
    if (!own[0]) return own;
    if (a?.combatAudit?.pvp === "disabled")
      return [false, "That ability is not available in PvP."];
    const rc = validateResourceAndCooldown(
      p,
      a,
      n,
      this.engine.abilityResourceCost(p, a),
    );
    if (!rc[0]) return rc;
    const haste = this.engine.cooldownHaste(p);
    if (a.gcd > 0 && Number(p.combat?.gcdReadyAt || 0) > n)
      return [false, "Global cooldown is active."];

    const liveOpponents = opponents.filter(
      (x: any) =>
        x && x.online && !x.dead && x.zone === p.zone && x.id !== p.id,
    );
    const liveAllies = allies.filter(
      (x: any) => x && x.online && !x.dead && x.zone === p.zone,
    );
    const movementTarget = targetId
      ? liveOpponents.find((x: any) => x.id === targetId)
      : liveOpponents[0];
    const rule = String(
      a?.combatAudit?.targetRule ||
        (a?.heal || a?.partyBuff || a?.hot
          ? "ally"
          : a?.selfBuff
            ? "self"
            : "enemy"),
    );
    const isSelfAoe = !!(
      a.aoe?.center === "self" && Number(a.aoe?.radius || 0) > 0
    );

    let target: any = null;
    if (isSelfAoe) {
      target = p;
    } else if (
      a.movement === "dash" ||
      a.movement === "charge" ||
      a.id === "blink"
    ) {
      if (movementTarget) {
        const movementRange =
          Number(a.range || 0) > 0
            ? this.engine.abilityRangeNormalized(p, a)
            : Infinity;
        if (
          Number.isFinite(movementRange) &&
          Math.hypot(p.x - movementTarget.x, p.y - movementTarget.y) >
            movementRange
        )
          return [false, `You are out of range for ${a.name}.`];
      } else if (a.movement !== "dash" && a.movement !== "charge")
        return [false, "No valid movement target."];
    }

    if (!isSelfAoe && rule === "enemy") {
      target = targetId
        ? liveOpponents.find((x: any) => x.id === targetId)
        : movementTarget;
      if (!target) return [false, "No valid enemy target."];
      const check = validateTargetRule(
        p,
        {
          ...a,
          combatAudit: { ...(a.combatAudit || {}), targetRule: "enemy" },
        },
        target,
        this.engine.world,
      );
      if (!check[0]) return check;
    } else if (!isSelfAoe && rule === "ally") {
      target = targetId ? liveAllies.find((x: any) => x.id === targetId) : p;
      const check = validateTargetRule(p, a, target, this.engine.world, {
        allowedAllyIds: new Set(liveAllies.map((x: any) => x.id)),
      });
      if (!check[0]) return check;
    } else if (!isSelfAoe && rule === "self") {
      const check = validateTargetRule(p, a, p, this.engine.world);
      if (!check[0]) return check;
    } else if (!isSelfAoe) return [false, "Invalid PvP target rule."];

    if (
      isSelfAoe &&
      !(
        a.selfBuff ||
        a.heal ||
        a.hot ||
        a.partyBuff ||
        a.revive ||
        a.cleanse ||
        a.dispel
      )
    ) {
      const aoeReach = this.engine.rangeMeters(p, Number(a.aoe.radius || 0));
      if (
        !liveOpponents.some(
          (x: any) => Math.hypot(x.x - p.x, x.y - p.y) <= aoeReach,
        )
      )
        return [false, "No enemy is inside the area."];
    }
    const pvpCompleting = this.engine.consumeCompletion(p, a.id, n);
    if (p.combat?.casting && !pvpCompleting)
      return [false, "You are already casting."];
    if (!pvpCompleting && this.engine.castMs(p, a) > 0)
      return this.engine.beginCast(p, a, n, {
        kind: "pvp",
        command: {
          action: "pvp_cast",
          abilityId: a.id,
          targetId: isSelfAoe ? null : target?.id || null,
        },
      });
    if (target && !isSelfAoe) this.engine.faceTarget(p, target);
    const gearCast = this.engine.gearBeforeCast(p, a, target, n);
    const cost = this.engine.abilityResourceCost(p, a);
    p.resolve -= cost;
    if (a.cooldown)
      p.cooldowns[a.id] = n + (Number(a.cooldown) * 1000) / (1 + haste / 100);
    if (a.gcd)
      p.combat.gcdReadyAt =
        n +
        Math.max(
          Math.min(750, Number(a.gcd) * 1000),
          (Number(a.gcd) * 1000) / (1 + Math.max(0, haste) / 100),
        );

    if (a.movement === "dash" || a.movement === "charge" || a.id === "blink") {
      if (movementTarget) {
        const dx = movementTarget.x - p.x,
          dy = movementTarget.y - p.y,
          d = Math.hypot(dx, dy) || 1;
        const dashMeters = Number(
          a.movementDistance ?? (a.movement === "charge" ? 12 : 18),
        );
        const dash = this.engine.rangeMeters(p, dashMeters);
        const stop = this.engine.world.combatStopDistanceNormalized(p.zone);
        const amount = Math.max(0, Math.min(dash, Math.max(0, d - stop)));
        p.x = Math.max(0.01, Math.min(0.99, p.x + (dx / d) * amount));
        p.y = Math.max(0.01, Math.min(0.99, p.y + (dy / d) * amount));
      } else {
        const dash = this.engine.rangeMeters(
          p,
          Number(a.movementDistance || 18),
        );
        const dir = p.combat?.movementDirection || { x: 1, y: 0 };
        p.x = Math.max(0.01, Math.min(0.99, p.x + dir.x * dash));
        p.y = Math.max(0.01, Math.min(0.99, p.y + dir.y * dash));
      }
      p.targetX = p.x;
      p.targetY = p.y;
      p.moveState = "idle";
      if (Number(a.power || 0) <= 0)
        return [
          true,
          `${a.name} activated.`,
          {
            pvp: true,
            abilityId: a.id,
            moved: true,
            targetId: movementTarget?.id || null,
          },
        ];
    }

    if (a.selfBuff) {
      const status = this.engine.applySelfBuffStatus(p, a, n);
      const until = status?.until || n + 5000;
      if (a.selfBuff === "guard") p.combat.guardUntil = until;
      if (a.selfBuff === "shield_wall") p.combat.shieldWallUntil = until;
      if (a.selfBuff === "arcane_surge") p.combat.arcaneSurgeUntil = until;
      if (a.selfBuff === "arcane_echo") p.combat.arcaneEchoUntil = until;
      if (a.selfBuff === "trueshot") p.combat.trueshotUntil = until;
      if (a.selfBuff === "shadow_dance") p.combat.shadowDanceUntil = until;
      if (a.selfBuff === "barrier" || a.selfBuff === "smoke_bomb") {
        p.combat.barrierUntil = until;
        if (status) {
          status.absorbRemaining = this.engine.barrierAmount(p, a);
          status.absorbMax = status.absorbRemaining;
        }
      }
      if (a.selfBuff === "stealth") {
        p.combat.stealthUntil = until;
        p.combat.pvpStealthUntil = until;
      }
      if (a.selfBuff === "frenzy") p.combat.frenzyUntil = until;
      pushFx(p, "skill", p.id, p.id, a.id, {
        abilityName: a.name,
        icon: a.icon,
      });
      return [
        true,
        `${a.name} activated.`,
        { pvp: true, abilityId: a.id, targetId: p.id, support: true },
      ];
    }

    if (a.heal || a.hot || a.partyBuff || a.revive || a.cleanse || a.dispel) {
      const targets = a.partyBuff ? liveAllies : [target];
      let totalHeal = 0;
      for (const t of targets) {
        if (!t) continue;
        let actualHeal = 0;
        if (a.heal) {
          const before = t.hp;
          const antiHeal = this.engine.statusModifier(t, "healing");
          const effective = Math.max(0, 1 + antiHeal / 100);
          t.hp = Math.min(
            t.maxHp,
            t.hp +
              Math.round(
                t.maxHp *
                  Number(a.heal || 0) *
                  this.engine.healingMultiplier(p) *
                  (1 + (p.bonuses?.healing || 0) / 100) *
                  effective,
              ),
          );
          actualHeal = Math.max(0, t.hp - before);
          totalHeal += actualHeal;
        }
        if (a.cleanse) {
          this.engine.cleanseStatuses(t, Number(a.cleanse), "harmful");
        }
        if (a.dispel) {
          this.engine.cleanseStatuses(t, Number(a.dispel), "beneficial");
        }
        if (a.hot) {
          t.statuses = t.statuses || [];
          const duration =
            Number(a.hot.duration || 5) *
            (1 + Number(p.bonuses?.hotDuration || 0) / 100);
          t.statuses.push({
            id: `hot_${a.id}`,
            until: n + duration * 1000,
            tickHeal: a.hot.tickHeal,
            lastTick: n,
            sourcePlayerId: p.id,
            icon: a.icon,
            snapshotHealingMultiplier: this.engine.healingMultiplier(p),
            snapshotHealingBonus: Number(p.bonuses?.healing || 0),
          });
        }
        if (a.partyBuff) {
          const b = a.partyBuff;
          const duration = Math.max(
            1000,
            Number(b.duration || 10) *
              1000 *
              (1 + Number(p.bonuses?.buffDuration || 0) / 100),
          );
          t.statuses = (t.statuses || []).filter(
            (st: any) => st.id !== `buff_${b.id}`,
          );
          t.statuses.push({
            id: `buff_${b.id}`,
            until: n + duration,
            sourcePlayerId: p.id,
            description: `Blessed by ${p.name}.`,
            icon: a.icon,
            modifiers: { ...(b.modifiers || {}) },
          });
        }
        this.engine.gearAfterHeal(p, a, actualHeal, n);
        pushFx(p, a.heal || a.hot ? "heal" : "skill", p.id, t.id, a.id, {
          amount: a.heal ? Math.max(0, totalHeal) : undefined,
          abilityName: a.name,
          icon: a.icon,
        });
      }
      return [
        true,
        `${a.name}${totalHeal ? ` restores ${totalHeal} health` : a.partyBuff ? " blesses the party" : ""}.`,
        {
          pvp: true,
          abilityId: a.id,
          support: true,
          heal: totalHeal,
          targets: targets.map((x: any) => x.id),
        },
      ];
    }

    const targets = isSelfAoe
      ? liveOpponents.filter(
          (x: any) =>
            Math.hypot(x.x - p.x, x.y - p.y) <=
            this.engine.rangeMeters(p, Number(a.aoe.radius || 0)),
        )
      : [target];
    if (!targets.length) return [false, "No enemy is inside the area."];
    const nextPowerPct = Number(p.combat?.gearNextPowerPct || 0);
    p.combat.gearNextPowerPct = 0;
    let total = 0;
    let kills = 0;
    const hitIds: any[] = [];
    const avoidedIds: string[] = [];
    for (const t of targets) {
      if (Number(a.power) > 0 && this.pvpAvoided(p, t, n, a.id)) {
        avoidedIds.push(t.id);
        continue;
      }
      let power =
        Number(a.power || 0) *
        this.engine.buildAbilityMultiplier(p, a.id) *
        this.engine.gearAbilityMultiplier(p, a.id) *
        (1 + nextPowerPct / 100) *
        (1 + Number(gearCast.powerPct || 0) / 100);
      if (p.combat.shadowDanceUntil > n) power *= 1.2;
      if (p.combat.pvpStealthUntil > n) power *= 1.35;
      if (a.selfBuff === "arcane_surge") power *= 1.3;
      const offensiveStat =
        a.scaling === "spell"
          ? Number(p.spellPower || p.pvpRuntimeStats?.attack || p.attack)
          : Number(p.pvpRuntimeStats?.attack || p.attack);
      const damageBonus =
        Number(p.bonuses?.damage || 0) +
        Number(p.bonuses?.rangeDamage || 0) +
        (isSelfAoe ? Number(p.bonuses?.aoeDamage || 0) : 0);
      const rolled = rollDamage({
        attack: offensiveStat,
        power,
        armor: Number(t.pvpRuntimeStats?.armor || t.armor || 0),
        attackerLevel: Number(p.level || 1),
        critChance: Number(p.bonuses?.crit || 0),
        damageBonus,
      });
      const taken = this.engine.targetDamageTakenMultiplier(t);
      const barrier = t.combat?.barrierUntil > n ? 0.55 : 1;
      const pvpCap = Math.max(1, Math.round(Number(t.maxHp || 1) * 0.18));
      const hitDamage = Math.min(
        pvpCap,
        Math.max(1, Math.round(rolled.damage * 0.65 * taken * barrier)),
      );
      t._lastDamageAt = n;
      t._hpRegenAt = n;
      t.hp = Math.max(0, t.hp - hitDamage);
      total += hitDamage;
      hitIds.push(t.id);
      pushFx(p, "damage", p.id, t.id, a.id, {
        amount: hitDamage,
        crit: !!rolled.crit,
        abilityName: a.name,
        icon: a.icon,
      });
      if (a.stun && t.hp > 0) {
        const duration = applyDiminishingReturns(
          t,
          "stun",
          Number(a.stun) * (1 + Number(p.bonuses?.stunDuration || 0) / 100),
          n,
        );
        if (duration <= 0) {
          pushFx(p, "status", p.id, t.id, a.id, {
            status: "stun_immune",
            statusName: "Immune",
            duration: 0,
          });
        } else {
          t.statuses = (t.statuses || []).filter(
            (x: any) => x?.id !== "stunned",
          );
          t.statuses.push({
            id: "stunned",
            name: "Stunned",
            effect: "Cannot act until the stun expires.",
            duration,
            until: n + duration * 1000,
            sourcePlayerId: p.id,
            description: "Cannot act until the stun expires.",
            icon: "💫",
          });
        }
      }
      if (a.status && t.hp > 0) {
        const st = a.status;
        const duration =
          Number(st.duration || 5) *
          (1 +
            Number(
              p.bonuses?.[
                st.id === "bleeding"
                  ? "bleedDuration"
                  : st.id === "poisoned"
                    ? "poisonDuration"
                    : "dotDuration"
              ] || 0,
            ) /
              100);
        const dot = Math.max(
          1,
          Math.round(
            Number(st.damage || 0) *
              (1 +
                Number(
                  p.bonuses?.[
                    st.id === "bleeding"
                      ? "bleedDamage"
                      : st.id === "poisoned"
                        ? "poisonDamage"
                        : "dotDamage"
                  ] || 0,
                ) /
                  100),
          ),
        );
        t.statuses = (t.statuses || []).filter((x: any) => x?.id !== st.id);
        t.statuses.push({
          id: st.id,
          name: st.name || st.id,
          effect: `Deals ${dot} damage each second.`,
          duration,
          until: n + duration * 1000,
          damage: dot,
          damagePerTick: dot,
          lastTick: n,
          sourcePlayerId: p.id,
          description: `${a.name} deals ${dot} damage each second for ${duration.toFixed(1)} seconds.`,
          icon: a.icon,
        });
      }
      this.engine.applyOffensiveDebuff(t, a, p, n);
      if (t.hp <= 0) {
        t.dead = true;
        t.respawnAt = n + 5000;
        t.respawnReady = false;
        t.respawnMessage = `Defeated by ${p.name}.`;
        kills++;
      }
      this.engine.gearAfterHit(
        p,
        a,
        t,
        { damage: hitDamage, crit: !!rolled.crit, killed: t.hp <= 0 },
        n,
      );
    }
    if (p.combat.pvpStealthUntil > n) {
      p.combat.pvpStealthUntil = 0;
      p.statuses = (p.statuses || []).filter(
        (x: any) => (typeof x === "string" ? x : x?.id) !== "stealth",
      );
    }
    this.engine.trackRotation(p, a);
    if ((a.tags || []).includes("interrupt")) {
      for (const t of targets) {
        if (hitIds.includes(t.id) && t.combat?.casting) {
          this.engine.cancelCast(t, `Interrupted by ${p.name}.`, n);
          t.combat.castLockUntil = n + 3000;
        }
      }
    }
    if (!hitIds.length && avoidedIds.length)
      return [
        true,
        `${a.name} ${targets.length > 1 ? "was avoided by every target" : `misses ${targets[0]?.name || "the target"}`}.`,
        {
          pvp: true,
          abilityId: a.id,
          damage: 0,
          targets: [],
          avoided: avoidedIds,
          kills: 0,
        },
      ];
    return [
      true,
      `${a.name} hits for ${total}${isSelfAoe ? ` across ${hitIds.length} targets` : ""}${avoidedIds.length ? ` (${avoidedIds.length} avoided)` : ""}.`,
      {
        pvp: true,
        abilityId: a.id,
        damage: total,
        targets: hitIds,
        kills,
        avoided: avoidedIds,
      },
    ];
  }
}
