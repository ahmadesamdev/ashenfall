export const LOADOUT_SLOTS = Object.freeze([
  "leveling",
  "dungeon",
  "boss",
  "pvp",
]);

export function normalizeLoadoutSlot(value: unknown): string {
  const slot = String(value || "")
    .trim()
    .toLowerCase();
  return LOADOUT_SLOTS.includes(slot) ? slot : LOADOUT_SLOTS[0];
}

export function cloneLoadout(player: any, slot: string, name: string) {
  const normalized = normalizeLoadoutSlot(slot);
  return {
    id: `loadout_${normalized}`,
    slot: normalized,
    name:
      String(name || normalized)
        .trim()
        .slice(0, 28) || normalized,
    buildId: player?.activeBuildId || null,
    stats: { ...(player?.stats || {}) },
    talents: (player?.talents || [])
      .map((x: any) => ({ id: x.id, rank: Number(x.rank || 0) }))
      .filter((x: any) => x.rank > 0),
    equipment: { ...(player?.equipment || {}) },
    savedAt: Date.now(),
  };
}

export function allocatedStatPoints(stats: any) {
  return ["strength", "agility", "intellect", "vitality", "willpower"].reduce(
    (n, key) => n + Math.max(0, Number(stats?.[key] || 10) - 10),
    0,
  );
}
