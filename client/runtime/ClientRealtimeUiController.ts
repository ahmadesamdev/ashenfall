export interface ClientRealtimeUiDeps {
  getState: () => any;
  renderCombatPresentation: () => void;
  renderTarget?: () => void;
  renderDeath?: () => void;
  getLocalFx: () => any[];
  setLocalFx: (fx: any[]) => void;
  renderRegionHud: () => void;
  renderHeader?: () => void;
  renderQuestHelper?: () => void;
  renderPartyHud?: () => void;
  renderChat?: () => void;
  renderLootRolls: () => void;
  renderDungeonQueueHud: () => void;
  renderArenaQueueHud: () => void;
  renderDungeonMatch: () => void;
  renderWorldIntel: () => void;
  isWorldIntelOpen: () => boolean;
  isWorldMapOpen: () => boolean;
  getWorldMapDrawAt: () => number;
  setWorldMapDrawAt: (value: number) => void;
  drawWorldMap: () => void;
  syncStoryModal: () => void;
  isNpcModalOpen: () => boolean;
  refreshNpcModal: () => void;
}

export class ClientRealtimeUiController {
  constructor(private readonly d: ClientRealtimeUiDeps) {}
  tick(): void {
    const state = this.d.getState();
    if (state?.player) {
      this.d.renderCombatPresentation();
      this.d.renderTarget?.();
      this.d.renderDeath?.();
    }
    const now = Date.now();
    this.d.setLocalFx(
      this.d.getLocalFx().filter((f) => Number(f?.expiresAt || 0) > now),
    );
    if (!state?.player) return;
    this.d.renderRegionHud();
    this.d.renderHeader?.();
    this.d.renderQuestHelper?.();
    this.d.renderPartyHud?.();
    this.d.renderChat?.();
    this.d.renderLootRolls();
    this.d.renderDungeonQueueHud();
    this.d.renderArenaQueueHud();
    this.d.renderDungeonMatch();
    if (this.d.isWorldIntelOpen()) this.d.renderWorldIntel();
    if (
      this.d.isWorldMapOpen() &&
      performance.now() - this.d.getWorldMapDrawAt() > 500
    ) {
      this.d.setWorldMapDrawAt(performance.now());
      this.d.drawWorldMap();
    }
    this.d.syncStoryModal();
    if (this.d.isNpcModalOpen()) this.d.refreshNpcModal();
  }
}
