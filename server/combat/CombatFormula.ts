const PLAYER_GROWTH = Object.freeze({
  hpPerLevel: 18,
  attackPerLevel: 2.1,
  armorPerLevel: 0.9,
  resolvePerLevel: 4,
});
const STAT_SCALE = Object.freeze({
  strengthAttack: 0.8,
  agilityArmor: 0.3,
  intellectAttack: 0.2,
  vitalityHp: 6,
  willpowerResolve: 1.5,
});
const GEAR_SCALE = Object.freeze({ weaponPower: 0.4, armor: 0.35 });

export function playerMaxHp(
  p: any,
  aff: Record<string, number> = {},
  talent: Record<string, number> = {},
) {
  const levelGrowth =
    Math.max(0, Number(p.level || 1) - 1) * PLAYER_GROWTH.hpPerLevel;
  const stats = p.stats || {};
  return Math.round(
    Number(p.baseHp || 100) +
      levelGrowth +
      (Number(stats.vitality || 10) - 10) * STAT_SCALE.vitalityHp +
      Number(aff.vitality || 0) * STAT_SCALE.vitalityHp +
      Number(aff.maxHp || 0) +
      Number(aff.hp || 0) +
      Number(talent.maxHp || 0),
  );
}

export function playerAttack(
  p: any,
  weaponPower = 0,
  aff: Record<string, number> = {},
  talent: Record<string, number> = {},
) {
  const levelGrowth =
    Math.max(0, Number(p.level || 1) - 1) * PLAYER_GROWTH.attackPerLevel;
  const stats = p.stats || {};
  return (
    Math.round(
      (Number(p.baseAttack || 10) +
        levelGrowth +
        Number(weaponPower || 0) * GEAR_SCALE.weaponPower +
        (Number(stats.strength || 10) - 10) * STAT_SCALE.strengthAttack +
        Number(aff.strength || 0) * STAT_SCALE.strengthAttack +
        (Number(stats.intellect || 10) - 10) * STAT_SCALE.intellectAttack +
        Number(aff.intellect || 0) * STAT_SCALE.intellectAttack +
        Number(aff.attack || 0) +
        Number(talent.attack || 0)) *
        1.15 *
        10,
    ) / 10
  );
}

export function playerArmor(
  p: any,
  gearArmor = 0,
  aff: Record<string, number> = {},
  talent: Record<string, number> = {},
) {
  const levelGrowth =
    Math.max(0, Number(p.level || 1) - 1) * PLAYER_GROWTH.armorPerLevel;
  const stats = p.stats || {};
  return (
    Math.round(
      (Number(p.baseArmor || 4) +
        levelGrowth +
        Number(gearArmor || 0) * GEAR_SCALE.armor +
        (Number(stats.agility || 10) - 10) * STAT_SCALE.agilityArmor +
        Number(aff.agility || 0) * STAT_SCALE.agilityArmor +
        Number(aff.armor || 0) +
        Number(talent.armor || 0)) *
        10,
    ) / 10
  );
}

export function playerMaxResolve(
  p: any,
  aff: Record<string, number> = {},
  talent: Record<string, number> = {},
) {
  const levelGrowth =
    Math.max(0, Number(p.level || 1) - 1) * PLAYER_GROWTH.resolvePerLevel;
  const stats = p.stats || {};
  return Math.round(
    Number(p.baseResolve || 100) +
      levelGrowth +
      (Number(stats.willpower || 10) - 10) * STAT_SCALE.willpowerResolve +
      Number(aff.willpower || 0) * STAT_SCALE.willpowerResolve +
      Number(talent.maxResolve || 0),
  );
}

export function armorConstant(attackerLevel = 1) {
  return 100 + Math.max(0, (Number(attackerLevel) || 1) - 15) * 17;
}
export function mobArmorScale(mob: any) {
  return armorConstant(Number(mob?.level) || 1) / 100;
}
export function mitigationMultiplier(
  armor = 0,
  attackerLevel = 1,
  armorScale = 1,
) {
  const k = armorConstant(attackerLevel);
  return (
    k /
    (k + Math.max(0, Number(armor) || 0) * Math.max(0, Number(armorScale) || 0))
  );
}

export function rollDamage({
  attack,
  power = 1,
  armor = 0,
  critChance = 0,
  critMultiplier = 1.5,
  damageBonus = 0,
  attackerLevel = 1,
  armorScale = 1,
}: any) {
  let damage = Math.max(
    1,
    Math.round(
      Number(attack || 0) *
        Number(power || 0) *
        mitigationMultiplier(armor, attackerLevel, armorScale),
    ),
  );
  const crit = Math.random() < Math.max(0, Number(critChance || 0)) / 100;
  if (crit) damage = Math.round(damage * critMultiplier);
  damage = Math.max(
    1,
    Math.round(damage * (1 + Number(damageBonus || 0) / 100)),
  );
  return { damage, crit };
}

export function expectedDamage(
  attack,
  power = 1,
  armor = 0,
  critChance = 0,
  damageBonus = 0,
  attackerLevel = 1,
  armorScale = 1,
) {
  const base = Math.max(
    1,
    Number(attack || 0) *
      Number(power || 0) *
      mitigationMultiplier(armor, attackerLevel, armorScale),
  );
  return (
    base *
    (1 + (Math.max(0, Number(critChance || 0)) / 100) * 0.5) *
    (1 + Number(damageBonus || 0) / 100)
  );
}

export const COMBAT_SCALE = Object.freeze({
  version: 2,
  philosophy:
    "Level 1 attacks are roughly 10-15 damage and early creatures are roughly 50-100 HP. Values grow gradually into the low hundreds.",
  critMultiplier: 1.5,
  armorFormula: "K / (K + armor), K = 100 + 17 * max(0, attackerLevel - 15)",
  levelGrowth: PLAYER_GROWTH,
  statScale: STAT_SCALE,
  gearScale: GEAR_SCALE,
});
