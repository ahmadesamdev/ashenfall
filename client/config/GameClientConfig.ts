export const CLASS_PORTRAITS: Record<string, string> = {
  vanguard: "Vanguard.png",
  arcanist: "Arcanist.png",
  warden: "Warden.png",
  shadowblade: "Rogue.png",
  ranger: "Ranger.png",
  templar: "Templar.png",
  occultist: "Occultist.png",
  reaver: "Reaver.png",
  hierophant: "hierophant.png",
};

export const CLASS_CARD_PORTRAITS = { ...CLASS_PORTRAITS };

export const CLASS_SHORT_DESCRIPTIONS: Record<string, string> = {
  vanguard: "A durable frontline defender built to hold enemy attention.",
  arcanist: "A ranged spellcaster focused on burst and control.",
  warden: "A nature-bound guardian with strong defense and recovery.",
  shadowblade: "A fast melee rogue built around mobility and pressure.",
  ranger: "A ranged hunter specializing in sustained physical damage.",
  templar: "A holy warrior combining defense, healing and melee pressure.",
  occultist: "A dark caster focused on curses, damage over time and control.",
  reaver: "An aggressive melee bruiser that converts pressure into damage.",
  hierophant: "A support-focused mystic specializing in healing and utility.",
};

export const CLASS_FALLBACK = Object.entries(CLASS_PORTRAITS).map(
  ([id, portrait]) => ({
    id,
    name: id.replace(/^\w/, (m) => m.toUpperCase()),
    icon: "⚔️",
    role: "DPS",
    description: CLASS_SHORT_DESCRIPTIONS[id],
    portrait,
  }),
);

export const BOSS_VISUALS: Record<string, string> = {
  sunken_catacombs: "Eldrith-Sunken-Catacombs-Horror-64x64px.png",
  black_citadel: "Morgrath-Black-Citadel-Demon-Knight-64x64px.png",
  dreadvault: "Vyraxis-Dreadvault-Dungeon-Boss-64x64px.png",
  watcher_hollow: "Forest-Heart-Corrupted-Guardian-64x64px.png",
  royal_catacombs: "Ashen-Titan-Royal-Catacombs-64x64px.png",
};

export const BOSS_BY_ENEMY: Record<string, string> = {
  hollow_saint: BOSS_VISUALS.sunken_catacombs,
  vault_tyrant: BOSS_VISUALS.dreadvault,
  watcher_hollowwarden: BOSS_VISUALS.watcher_hollow,
  royal_catacomb_king: BOSS_VISUALS.royal_catacombs,
};
