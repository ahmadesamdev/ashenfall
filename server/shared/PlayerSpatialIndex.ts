export class PlayerSpatialIndex<
  T extends {
    id: unknown;
    zone: unknown;
    x: number;
    y: number;
    online?: boolean;
  },
> {
  private readonly cells = new Map<string, T[]>();
  private readonly order = new Map<T, number>();
  constructor(players: T[], cellSize = 0.05) {
    const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 0.05;
    let ordinal = 0;
    for (const player of players || []) {
      const currentOrder = ordinal++;
      if (player) this.order.set(player, currentOrder);
      if (
        !player ||
        !player.online ||
        !Number.isFinite(Number(player.x)) ||
        !Number.isFinite(Number(player.y))
      )
        continue;
      const key = this.cellKey(
        String(player.zone ?? ""),
        Math.floor(Number(player.x) / size),
        Math.floor(Number(player.y) / size),
      );
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(player);
      else this.cells.set(key, [player]);
    }
    this.actualCellSize = size;
  }
  private readonly actualCellSize: number;
  private cellKey(zone: string, x: number, y: number) {
    return `${zone}\u0000${x}\u0000${y}`;
  }
  nearby(
    zone: unknown,
    x: number,
    y: number,
    radius: number,
    excludeId?: unknown,
    limit = 250,
  ): T[] {
    const r = Number(radius),
      px = Number(x),
      py = Number(y);
    if (![r, px, py].every(Number.isFinite) || r < 0) return [];
    const minX = Math.floor((px - r) / this.actualCellSize),
      maxX = Math.floor((px + r) / this.actualCellSize);
    const minY = Math.floor((py - r) / this.actualCellSize),
      maxY = Math.floor((py + r) / this.actualCellSize);
    const candidates: Array<{
      player: T;
      distanceSquared: number;
      ordinal: number;
    }> = [];
    const zoneKey = String(zone ?? "");
    for (let gx = minX; gx <= maxX; gx++)
      for (let gy = minY; gy <= maxY; gy++) {
        for (const player of this.cells.get(this.cellKey(zoneKey, gx, gy)) ||
          []) {
          if (String(player.id) === String(excludeId ?? "")) continue;
          const dx = Number(player.x) - px,
            dy = Number(player.y) - py,
            distanceSquared = dx * dx + dy * dy;
          if (distanceSquared <= r * r)
            candidates.push({
              player,
              distanceSquared,
              ordinal: this.order.get(player) ?? 0,
            });
        }
      }
    candidates.sort(
      (a, b) => a.distanceSquared - b.distanceSquared || a.ordinal - b.ordinal,
    );
    return candidates
      .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
      .map((x) => x.player);
  }
}
