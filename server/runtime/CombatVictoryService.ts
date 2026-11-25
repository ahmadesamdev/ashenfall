export class CombatVictoryService {
  combat: any;
  world: any;
  quest: any;
  dungeonEngine: any;
  repo: any;
  rewardMobKill: any;
  reward: any;
  awardEncounterLoot: any;
  createDungeonCompletionRewards: any;
  dungeons: any;
  playerMutations: any;
  private resolvingEncounters = new Set<string>();
  constructor(ctx: any) {
    Object.assign(this, ctx);
  }

  worldMobKill(player: any, payload: any) {
    if (!player || !payload) return null;
    return this.rewardMobKill(player, payload);
  }

  async encounterVictory(player: any, encounterId: string) {
    const encounterKey = String(encounterId || "");
    if (!encounterKey || this.resolvingEncounters.has(encounterKey))
      return false;
    const e = this.combat.get(encounterKey);
    if (!e || e.state !== "won") return false;
    if (Number(e.victoryRetryAt || 0) > Date.now()) return false;
    this.resolvingEncounters.add(encounterKey);
    const participants = (this.world.players || [])
      .filter((m: any) => m && m.encounterId === e.id)
      .map((m: any) => String(m.id));
    const lockIds = [
      String(player.id),
      ...(e.participants || []).map((id: any) => String(id)),
      ...participants,
    ];
    const execute = async () => {
      const live = this.combat.get(encounterKey);
      if (!live || live.state !== "won") return false;
      const membersBefore = [...new Set(lockIds)]
        .map((id: string) => this.repo.getPlayer(id))
        .filter(Boolean);
      const dungeonInstanceId = String(player.dungeon?.instanceId || "");
      const dungeonInstanceBefore = dungeonInstanceId
        ? this.dungeonEngine?.instances?.get(dungeonInstanceId)
        : null;
      const dungeonInstanceSnapshot = dungeonInstanceBefore
        ? JSON.parse(JSON.stringify(dungeonInstanceBefore))
        : null;
      const snapshots = new Map(
        membersBefore.map((m: any) => [
          String(m.id),
          JSON.parse(JSON.stringify(m)),
        ]),
      );
      try {
        if (!e.dungeonId) {
          const rewardKey = `encounter-victory:${String(e.id)}:${String(player.id)}:reward`;
          const ledger = Array.isArray(player._rewardLedger)
            ? player._rewardLedger
            : [];
          if (ledger.includes(rewardKey)) {
            this.combat.encounters.delete(encounterKey);
            return true;
          }
          this.reward(player, e.enemy.xp, e.enemy.gold, e.enemy.loot || []);
          if (typeof this.repo.savePlayerRewardOnce !== "function")
            throw new Error(
              "Durable encounter reward persistence is unavailable.",
            );
          const committed = await this.repo.savePlayerRewardOnce(
            player,
            rewardKey,
          );
          if (!committed) {
            const snapshot = snapshots.get(String(player.id));
            if (snapshot) {
              for (const key of Object.keys(player)) delete player[key];
              Object.assign(player, snapshot);
            }
            this.combat.encounters.delete(encounterKey);
            return false;
          }
          this.combat.encounters.delete(encounterKey);
          return true;
        }
        const dungeonParticipants = participants.length
          ? participants
          : e.participants || [];
        if (e.dungeonId && !e.optionalRoomId) {
          const source =
            e.enemy.ai === "boss"
              ? "boss"
              : e.enemy.ai === "elite"
                ? "elite"
                : "normal";
          this.rewardMobKill(player, {
            enemyId: e.enemy.id,
            enemyName: e.enemy.name,
            level: e.enemy.level || player.level,
            xp: e.enemy.xp,
            gold: e.enemy.gold,
            lootPile: null,
            participants: dungeonParticipants,
            x: player.x,
            y: player.y,
            source,
          });
          this.awardEncounterLoot(
            dungeonParticipants,
            e.enemy.loot || [],
            source,
            e.enemy.level || player.level,
            e.enemy.name,
          );
        } else
          this.reward(player, e.enemy.xp, e.enemy.gold, e.enemy.loot || []);
        const dr = this.dungeonEngine.onVictory(player, e);
        if (dr) {
          player.lastDungeonResult = dr;
          if (dr.optionalComplete) {
            const members = (e.participants || [])
              .map((id: any) => this.repo.getPlayer(String(id)))
              .filter(Boolean);
            const chests = this.createDungeonCompletionRewards(
              members,
              dr.optionalReward,
              {
                instanceId: dr.instanceId || player.dungeon?.instanceId,
                dungeonId: player.dungeon?.id,
                dungeonName:
                  dr.name ||
                  this.dungeons.find((x: any) => x.id === dr.dungeonId)?.name ||
                  player.dungeon?.id ||
                  "Dungeon",
              },
            );
            for (const m of members) {
              const chest = chests.find(
                (x: any) =>
                  x.id ===
                  `dchest_${dr.instanceId || player.dungeon?.instanceId}_${m.id}`,
              );
              m.lastDungeonResult = {
                ...dr,
                rewardChestId: chest?.id || null,
                rewardChest: chest || null,
                at: Date.now(),
              };
            }
            const instanceId = String(
              dr.instanceId || player.dungeon?.instanceId || "unknown",
            );
            const keys = members.map(
              (m: any) =>
                `dungeon-completion:${instanceId}:${String(m.id)}:${String(dr.optionalRoomId || "optional")}:chest`,
            );
            if (typeof this.repo.savePlayersWithRewardsOnce !== "function")
              throw new Error(
                "Durable dungeon reward persistence is unavailable.",
              );
            const committed = await this.repo.savePlayersWithRewardsOnce(
              members,
              keys,
            );
            if (!committed)
              throw new Error(
                "Dungeon optional reward was already durably committed; refresh player state before retrying.",
              );
          } else if (dr.complete) {
            const members = (dr.rewardMemberIds || [])
              .map((id: any) => this.repo.getPlayer(String(id)))
              .filter(Boolean);
            const chests = this.createDungeonCompletionRewards(
              members,
              dr.reward,
              {
                instanceId: dr.instanceId,
                dungeonId: dr.dungeonId,
                dungeonName: dr.name,
                lootLevel: Number(
                  dr.reward?.lootLevel ||
                    members.reduce(
                      (n: number, m: any) => Math.max(n, Number(m.level || 1)),
                      1,
                    ),
                ),
                gearRolls: Number(dr.reward?.gearRolls || 1),
                bossId: e?.enemy?.id || null,
              },
            );
            for (const [memberId, returnZone] of Object.entries(
              dr.returnZones || {},
            )) {
              const member = this.repo.getPlayer(String(memberId));
              if (member) this.world.travel(member, returnZone, false);
            }
            for (const m of members) {
              const chest = chests.find(
                (x: any) => x.id === `dchest_${dr.instanceId}_${m.id}`,
              );
              m.lastDungeonResult = {
                ...dr,
                returnedTo: dr.returnZones?.[m.id] || m.homeCity || "stonehold",
                rewardChestId: chest?.id || null,
                rewardChest: chest || null,
                at: Date.now(),
              };
            }
            const instanceId = String(dr.instanceId || "unknown");
            const keys = members.map(
              (m: any) =>
                `dungeon-completion:${instanceId}:${String(m.id)}:final:chest`,
            );
            if (typeof this.repo.savePlayersWithRewardsOnce !== "function")
              throw new Error(
                "Durable dungeon reward persistence is unavailable.",
              );
            const committed = await this.repo.savePlayersWithRewardsOnce(
              members,
              keys,
            );
            if (!committed)
              throw new Error(
                "Dungeon completion reward was already durably committed; refresh player state before retrying.",
              );
          }
        }
        this.combat.encounters.delete(encounterKey);
        return true;
      } catch (error) {
        for (const m of membersBefore) {
          const snapshot = snapshots.get(String(m.id));
          if (snapshot) {
            for (const key of Object.keys(m)) delete m[key];
            Object.assign(m, snapshot);
          }
        }
        player.lastDungeonResult = {
          ...(player.lastDungeonResult || {}),
          completionPersistenceFailed: true,
          at: Date.now(),
        };
        e.victoryFailures = Number(e.victoryFailures || 0) + 1;
        e.victoryRetryAt =
          e.victoryFailures >= 2
            ? Date.now() + Math.min(30000, 1000 * 2 ** (e.victoryFailures - 2))
            : 0;
        this.combat.encounters.set(encounterKey, e);
        if (
          dungeonInstanceId &&
          dungeonInstanceSnapshot &&
          this.dungeonEngine?.instances
        ) {
          this.dungeonEngine.instances.set(
            dungeonInstanceId,
            dungeonInstanceSnapshot,
          );
        }
        console.error(
          "Encounter victory persistence failed; encounter retained for retry:",
          encounterKey,
          error,
        );
        return false;
      }
    };
    try {
      return this.playerMutations?.withPlayers
        ? await this.playerMutations.withPlayers(lockIds, execute)
        : await execute();
    } finally {
      this.resolvingEncounters.delete(encounterKey);
    }
  }
}
