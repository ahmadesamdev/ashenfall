export interface ClientInteractionControllerDeps {
  getState: () => any;
  getAnchorId: () => string | null;
  clearAnchor: () => void;
  closeModal: (id: string) => void;
  getRenderRange: (meters: number) => number;
}

export class ClientInteractionController {
  constructor(private readonly d: ClientInteractionControllerDeps) {}

  enforceNpcRange(): void {
    const state = this.d.getState();
    const anchorId = this.d.getAnchorId();
    if (!state?.player || !anchorId) return;
    const npc = (state.npcs || []).find((x: any) => x.id === anchorId);
    const tooFar =
      !npc ||
      npc.zone !== state.player.zone ||
      Math.hypot(
        Number(state.player.x) - Number(npc.x),
        Number(state.player.y) - Number(npc.y),
      ) > this.d.getRenderRange(30);
    if (!tooFar) return;
    for (const id of [
      "npcModal",
      "shopModal",
      "trainerModal",
      "questModal",
      "auctionModal",
    ])
      this.d.closeModal(id);
    this.d.clearAnchor();
  }
}
