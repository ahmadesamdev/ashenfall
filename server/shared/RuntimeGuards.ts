export interface RuntimePlayer {
  x?: number;
  y?: number;
  targetX?: number;
  targetY?: number;
  hp?: number;
  maxHp?: number;
  resolve?: number;
  maxResolve?: number;
  attack?: number;
  armor?: number;
  level?: number;
  xp?: number;
  gold?: number;
  combat?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  inventory?: unknown[];
  quests?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function guardPlayerRuntime<T extends RuntimePlayer>(
  p: T | null | undefined,
): T | null | undefined {
  if (!p) return p;

  const maxHp = Math.max(1, finite(p.maxHp, 100));
  const maxResolve = Math.max(0, finite(p.maxResolve, 100));

  p.x = finite(p.x, 0.5);
  p.y = finite(p.y, 0.5);
  p.targetX = finite(p.targetX, p.x);
  p.targetY = finite(p.targetY, p.y);
  p.maxHp = maxHp;
  p.hp = Math.max(0, Math.min(finite(p.hp, maxHp), maxHp));
  p.maxResolve = maxResolve;
  p.resolve = Math.max(0, Math.min(finite(p.resolve, maxResolve), maxResolve));
  p.attack = Math.max(0, finite(p.attack, 0));
  p.armor = Math.max(0, finite(p.armor, 0));
  p.level = Math.max(1, Math.floor(finite(p.level, 1)));
  p.xp = Math.max(0, finite(p.xp, 0));
  p.gold = Math.max(0, Math.floor(finite(p.gold, 0)));

  if (!p.combat || typeof p.combat !== "object") p.combat = {};
  if (!p.stats || typeof p.stats !== "object") p.stats = {};
  if (!Array.isArray(p.inventory)) p.inventory = [];
  if (!p.quests || typeof p.quests !== "object") p.quests = {};
  return p;
}
