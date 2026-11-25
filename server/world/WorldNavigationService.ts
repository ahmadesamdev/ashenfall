import type { World } from "./World.js";

export class WorldNavigationService {
  constructor(private readonly world: World) {}
  isBlocked(zoneId: string, x: number, y: number, p: any = null) {
    const world: any = this.world;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    const zc = world.zoneConfig(zoneId) || {};
    if (zc.dungeon && zc.dungeonData) {
      const d = zc.dungeonData;
      const discovered = new Set<number>(
        (p?.dungeon?.discoveredRooms || []).map(Number),
      );
      const roomById = new Map<number, any>(
        (d.rooms || []).map((r: any): [number, any] => [Number(r.id), r]),
      );
      const roomOpen = (r: any) => discovered.has(Number(r.id));
      const inRoom = (r: any) =>
        x >=
          Number(r.x) -
            Number(r.w || 0) / 2 -
            world.normalizedMeters(zoneId, 1.2) &&
        x <=
          Number(r.x) +
            Number(r.w || 0) / 2 +
            world.normalizedMeters(zoneId, 1.2) &&
        y >=
          Number(r.y) -
            Number(r.h || 0) / 2 -
            world.normalizedMeters(zoneId, 1.2) &&
        y <=
          Number(r.y) +
            Number(r.h || 0) / 2 +
            world.normalizedMeters(zoneId, 1.2);
      if ((d.rooms || []).some((r: any) => roomOpen(r) && inRoom(r)))
        return false;
      const nearPath = (pts: any, width: any) =>
        world.pointNearPolyline(
          x,
          y,
          pts,
          Math.max(
            world.normalizedMeters(zoneId, 1.5),
            Number(width || 0.022) / 2,
          ),
        );
      for (let i = 0; i < (d.paths || []).length; i++) {
        const path = d.paths[i],
          a = roomById.get(i + 1),
          b = roomById.get(i + 2);
        if (
          a &&
          b &&
          roomOpen(a) &&
          roomOpen(b) &&
          nearPath(path.points || path, path.width || 0.022)
        )
          return false;
      }
      const selected = p?.dungeon?.selectedRoute;
      if (selected) {
        const r = (d.routeChoices || []).find((x: any) => x.id === selected);
        const a = roomById.get(Number(r?.afterRoom)),
          b = roomById.get(Number(r?.nextRoom));
        if (
          a &&
          b &&
          roomOpen(a) &&
          roomOpen(b) &&
          nearPath(
            [
              [a.x, a.y],
              [b.x, b.y],
            ],
            0.022,
          )
        )
          return false;
      }
      const ent = d.entrance;
      if (
        ent &&
        discovered.has(1) &&
        Math.hypot(x - Number(ent.x), y - Number(ent.y)) <=
          world.normalizedMeters(zoneId, 10)
      )
        return false;
      return true;
    }
    const l = world.layoutFor(zoneId),
      pad = world.normalizedMeters(zoneId, 1.5),
      obstaclePad = world.normalizedMeters(zoneId, 1.5),
      waterPad = world.normalizedMeters(zoneId, 2);
    if (zoneId === "stonehold" && l.zoneBounds) {
      const b = l.zoneBounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return true;
    }
    if (
      (l.blockedRects || []).some((r: any) => world.pointInRect(x, y, r, pad))
    )
      return true;
    if (
      (l.obstacles || []).some(
        (o: any) =>
          Math.hypot(x - Number(o.x), y - Number(o.y)) <=
          Number(o.r || 0) + obstaclePad,
      )
    )
      return true;
    if (
      (l.water || []).some((pts: any) =>
        world.pointNearPolyline(x, y, pts, waterPad),
      )
    )
      return true;
    return false;
  }
  resolveWalkableStep(
    zoneId: string,
    x: number,
    y: number,
    nx: number,
    ny: number,
    p: any = null,
  ) {
    if (!this.isBlocked(zoneId, nx, ny, p))
      return { x: nx, y: ny, blocked: false };
    const xOnly = { x: nx, y: y },
      yOnly = { x: x, y: ny };
    const xFree = !this.isBlocked(zoneId, xOnly.x, xOnly.y, p),
      yFree = !this.isBlocked(zoneId, yOnly.x, yOnly.y, p);
    if (xFree && yFree) {
      const dx = Math.abs(nx - x),
        dy = Math.abs(ny - y);
      return dx >= dy
        ? { x: nx, y: y, blocked: false }
        : { x: x, y: ny, blocked: false };
    }
    if (xFree) return { x: nx, y: y, blocked: false };
    if (yFree) return { x: x, y: ny, blocked: false };
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 10; i++) {
      const t = (lo + hi) / 2,
        tx = x + (nx - x) * t,
        ty = y + (ny - y) * t;
      if (this.isBlocked(zoneId, tx, ty, p)) hi = t;
      else lo = t;
    }
    const t = Math.max(0, Math.min(1, lo));
    return { x: x + (nx - x) * t, y: y + (ny - y) * t, blocked: true };
  }
}
