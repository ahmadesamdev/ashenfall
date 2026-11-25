export class WorldCombatSimulationService {
  world: any;
  combat: any;
  rewardMobKill: (player: any, payload: any) => any;
  emitMobAction: (zone: any, message: any) => void;
  constructor({
    world,
    combat,
    rewardMobKill,
    emitMobAction,
  }: {
    world: any;
    combat: any;
    rewardMobKill: (player: any, payload: any) => any;
    emitMobAction: (zone: any, message: any) => void;
  }) {
    this.world = world;
    this.combat = combat;
    this.rewardMobKill = rewardMobKill;
    this.emitMobAction = emitMobAction;
  }
  tick(dtSeconds: number, now = Date.now()) {
    const players = (this.world.players || []).filter(
      (p: any) => !this.world.playerMutations?.isLocked?.(p?.id),
    );
    this.tickMobStatuses(now, players);
    this.world.updateMobs(dtSeconds, players, (zone: any, msg: any) =>
      this.emitMobAction(zone, msg),
    );
  }
  private tickMobStatuses(now: number, players: any[]) {
    for (const m of this.world.mobs.values()) {
      if (m.state === "dead" || !m.statuses?.length) continue;
      const sourceId =
        m.statuses.find((s: any) => s.sourcePlayerId)?.sourcePlayerId ||
        m.aggroTarget;
      const source =
        players.find((x: any) => x.id === sourceId) ||
        players.find((x: any) =>
          Object.prototype.hasOwnProperty.call(m.attackers || {}, x.id),
        );
      const result = this.combat.processMobStatuses(
        m,
        now,
        source,
        source?.worldCombatLog || [],
      );
      if (result?.killed && m.state !== "dead" && !source) {
        this.world.finalizeMobDeath(null, m);
        continue;
      }
      if (result?.killed && m.state !== "dead" && source) {
        const pile = this.world.finalizeMobDeath(source, m);
        if (pile?.[1]?.killed)
          this.rewardMobKill(source, {
            enemyId: m.type,
            enemyName: m.name,
            level: m.level,
            xp: m.xp,
            gold: m.gold,
            lootPile: pile[1].lootPile,
            participants: pile[1].participants,
            mobId: m.id,
            x: m.x,
            y: m.y,
            source:
              m.ai === "boss" ? "boss" : m.ai === "elite" ? "elite" : "normal",
          });
      }
    }
  }
}
