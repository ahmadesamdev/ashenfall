export const COMBAT_RANGES = Object.freeze({
  meleeMeters: 18,
  stopMeters: 18,
  disengageMeters: 140,
  returnMeters: 6,
  mobAggroMeters: 50,
  rangedAbilityMeters: 72,
  rangedMobAttackMeters: 72,
  selfCenteredAoeMeters: 36,
});

export function normalizeAbilityRange(
  raw: unknown,
  zoneMeters: number,
  fallbackMeters = COMBAT_RANGES.meleeMeters,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    return fallbackMeters / Math.max(1, zoneMeters);
  return value <= 1 ? value : value / Math.max(1, zoneMeters);
}

export function normalizeGameDistance(
  raw: unknown,
  zoneMeters: number,
  fallbackNormalized: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallbackNormalized;
  return value <= 1 ? value : value / Math.max(1, zoneMeters);
}

export const RANGED_CLASSES = Object.freeze(
  new Set(["ranger", "arcanist", "warden", "occultist", "hierophant"]),
);

export function classBasicAttackRangeMeters(classId: unknown): number {
  return RANGED_CLASSES.has(String(classId || ""))
    ? COMBAT_RANGES.rangedAbilityMeters
    : COMBAT_RANGES.meleeMeters;
}
