import type { World } from "./World.js";
import {
  worldMeters as normalizeWorldMeters,
  normalizedMeters as normalizeMeters,
  pointNearPolyline,
  pointInRect,
} from "./WorldGeometry.js";

export class WorldConfigurationService {
  constructor(private readonly world: World) {}
  normalizeGates(input: any) {
    const world: any = this.world,
      out: any = {};
    for (const zone of world.zones) out[zone.id] = [];
    for (const [zone, list] of Object.entries(input || {}) as [string, any][]) {
      const seen: any[] = [];
      for (const raw of list || []) {
        if (!raw?.to || !out[raw.to]) continue;
        const gx = Number(raw.x),
          gy = Number(raw.y),
          destination = String(raw.to);
        if (
          seen.some(
            (x: any) =>
              x.destination === destination &&
              Math.hypot(gx - x.x, gy - x.y) <= 0.025,
          )
        )
          continue;
        const copy = { ...raw };
        out[zone].push(copy);
        seen.push({ x: gx, y: gy, destination });
      }
    }
    for (const [zone, list] of Object.entries(input || {}) as [string, any][])
      for (const gate of list || []) {
        if (!gate?.to || !out[gate.to]) continue;
        if (out[gate.to].some((x: any) => x?.to === zone)) continue;
        const offset = this.normalizedMeters(gate.to, 8);
        const pos =
          gate.x > 0.8
            ? { x: Math.max(0.02, offset), y: gate.y }
            : gate.x < 0.2
              ? { x: Math.min(0.98, 1 - offset), y: gate.y }
              : gate.y < 0.2
                ? { x: gate.x, y: Math.min(0.98, 1 - offset) }
                : { x: gate.x, y: Math.max(0.02, offset) };
        out[gate.to].push({
          id: `${gate.id}_return`,
          linkId: gate.id,
          name: `${world.byId[zone]?.name || zone} Road`,
          icon: gate.icon || "🚪",
          x: pos.x,
          y: pos.y,
          to: zone,
        });
      }
    return out;
  }
  registerRuntimeZone(id: string, config: any = {}) {
    const world: any = this.world;
    world.runtimeZones.set(id, {
      id,
      worldMeters: Number(config.worldMeters || 1200),
      dungeon: true,
      dungeonBounds: config.dungeonBounds || {
        minX: 0.08,
        maxX: 0.92,
        minY: 0.04,
        maxY: 0.94,
      },
    });
    return world.runtimeZones.get(id);
  }
  zoneConfig(zoneId: string) {
    const world: any = this.world;
    return world.byId[zoneId] || world.runtimeZones.get(zoneId) || {};
  }
  layoutFor(zoneId: string) {
    const world: any = this.world;
    return world.layout?.[zoneId] || { roads: [], blockedRects: [], water: [] };
  }
  worldMetersFor(zoneId: string) {
    return normalizeWorldMeters(this.zoneConfig(zoneId)?.worldMeters);
  }
  normalizedMeters(zoneId: string, meters: number) {
    return normalizeMeters(meters, this.zoneConfig(zoneId)?.worldMeters);
  }
  pointNearPolyline(x: number, y: number, pts: any, threshold: number) {
    return pointNearPolyline(x, y, pts, threshold);
  }
  pointInRect(x: number, y: number, rect: any, pad = 0) {
    return pointInRect(x, y, rect, pad);
  }
}
