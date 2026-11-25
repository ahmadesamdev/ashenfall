export const CHARACTER_SCHEMA_VERSION = 3;

export function migrateCharacterSchema(
  player: any,
  classes: Record<string, any>,
  inv: { recalc: (p: any) => void },
): boolean {
  if (!player || typeof player !== "object") return false;
  const current = Number(player.schemaVersion || 0);
  if (current >= CHARACTER_SCHEMA_VERSION) return false;

  let changed = false;
  const classDef = classes[player.classId] || classes.vanguard;

  if (
    classDef &&
    (Number(player.baseHp || 0) > 500 ||
      Number(player.baseAttack || 0) > 50 ||
      Number(player.baseArmor || 0) > 20)
  ) {
    player.baseHp = classDef.baseHp;
    player.baseAttack = classDef.baseAttack;
    player.baseArmor = classDef.baseArmor;
    player.baseResolve = classDef.baseResolve;
    player.maxHp = classDef.baseHp;
    player.hp = Math.min(Number(player.hp || classDef.baseHp), classDef.baseHp);
    player.attack = classDef.baseAttack;
    player.armor = classDef.baseArmor;
    player.maxResolve = classDef.baseResolve;
    player.resolve = Math.min(
      Number(player.resolve || classDef.baseResolve),
      classDef.baseResolve,
    );
    inv.recalc(player);
    changed = true;
  }

  if (
    !Number.isInteger(player.schemaVersion) ||
    player.schemaVersion < CHARACTER_SCHEMA_VERSION
  ) {
    player.schemaVersion = CHARACTER_SCHEMA_VERSION;
    changed = true;
  }
  return changed;
}
