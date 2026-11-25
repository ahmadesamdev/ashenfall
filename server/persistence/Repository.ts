export type PlayerRecord = Record<string, any>;

export interface PlayerRepository {
  players: Map<string, PlayerRecord>;
  getPlayer(id: string): PlayerRecord | undefined;
  allPlayers(): PlayerRecord[];
  savePlayer(player: PlayerRecord): void;
  reserveCharacterName(nameKey: string, playerId: string): void | Promise<void>;
  releaseCharacterName(
    nameKey: string,
    playerId?: string,
  ): void | Promise<void>;
  savePlayerNow(player: PlayerRecord): void | Promise<void>;
  savePlayerRewardOnce(
    player: PlayerRecord,
    rewardKey: string,
  ): boolean | Promise<boolean>;
  savePlayerRewardOnce(
    player: PlayerRecord,
    rewardKey: string,
    outboxEvent?: {
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    },
  ): boolean | Promise<boolean>;
  savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
  ): boolean | Promise<boolean>;
  savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
    outboxEvents?: Array<{
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    }>,
  ): boolean | Promise<boolean>;
  savePlayersAtomically(players: PlayerRecord[]): void | Promise<void>;
  savePlayersAndEconomyAtomically(
    players: PlayerRecord[],
    economy: any,
    id?: string,
  ): void | Promise<void>;
  checkpoint(): void | Promise<void>;
  loadEconomyState(id?: string): any;
  saveEconomyState(data: any, id?: string): void | Promise<void>;
  loadWorldState(id?: string): any;
  saveWorldState(data: any, id?: string): void | Promise<void>;
  saveWorldStateNow?(data: any, id?: string): void | Promise<void>;
  stats(): any;
  close(): void | Promise<void>;
  integrityCheck?(): boolean | Promise<boolean>;
  authInit(): void | Promise<void>;
  authReplaceAccountSession?(
    tokenHash: string,
    accountId: string,
    expiresAt: number,
    bumpSessionVersion?: boolean,
  ): number | Promise<number>;
  setWorldLeaseContext?(
    worldId: string,
    ownerId: string,
    fencingToken: number,
  ): void;
  acquireWorldLease?(
    worldId: string,
    ownerId: string,
    now: number,
    leaseMs: number,
  ):
    | { acquired: boolean; fencingToken: number; expiresAt: number }
    | Promise<{ acquired: boolean; fencingToken: number; expiresAt: number }>;
  renewWorldLease?(
    worldId: string,
    ownerId: string,
    fencingToken: number,
    now: number,
    leaseMs: number,
  ): boolean | Promise<boolean>;
  releaseWorldLease?(
    worldId: string,
    ownerId: string,
    fencingToken: number,
  ): void | Promise<void>;
  enqueueOutbox?(event: {
    id: string;
    type: string;
    aggregateId: string;
    payload: unknown;
    createdAt?: number;
  }): void | Promise<void>;
  claimOutbox?(
    consumer: string,
    limit?: number,
    now?: number,
  ): any[] | Promise<any[]>;
  completeOutbox?(
    eventId: string,
    consumer: string,
    now?: number,
  ): void | Promise<void>;
  failOutbox?(
    eventId: string,
    consumer: string,
    error: string,
    now?: number,
  ): void | Promise<void>;
}
