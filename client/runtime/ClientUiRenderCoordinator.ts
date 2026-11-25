export type RenderFn = () => void;

export interface ClientUiRenderCoordinatorDeps {
  getState: () => any;
  safeRender: (name: string, fn: RenderFn) => void;
  isModalOpen: (id: string) => boolean;
  getQuestJournalTab: () => string;
  getOpenNpcId: () => string | null;
  character: {
    renderCore: RenderFn;
    renderCharacterModal: RenderFn;
    renderBuild: RenderFn;
    renderTrainer: RenderFn;
    renderSkills: RenderFn;
  };
  questStory: {
    renderCore: RenderFn;
    renderQuestModal: RenderFn;
    renderNpc: RenderFn;
  };
  socialEconomy: {
    renderCore: RenderFn;
    renderParty: RenderFn;
    renderSocial: RenderFn;
    renderProfessions: RenderFn;
    renderAuction: RenderFn;
  };
  competitive: {
    renderCore: RenderFn;
    renderPvp: RenderFn;
    renderDungeon: RenderFn;
  };
  worldHud: { renderCore: RenderFn };
  worldIntel: { renderCore: RenderFn; renderMap: RenderFn };
  renderMail: RenderFn;
  renderWorldEvent: RenderFn;
  renderTrade: RenderFn;
  renderCombat: RenderFn;
  renderLevelUp: RenderFn;
  renderShop: RenderFn;
  renderNpcModal: RenderFn;
  updateSkillBar: RenderFn;
}

export class ClientUiRenderCoordinator {
  constructor(private readonly d: ClientUiRenderCoordinatorDeps) {}
  renderAll(): void {
    if (!this.d.getState()) return;
    const safe = (name: string, fn: RenderFn) => this.d.safeRender(name, fn);
    safe("character/progression", () => this.d.character.renderCore());
    safe("world-hud", () => this.d.worldHud.renderCore());
    safe("world-intel", () => this.d.worldIntel.renderCore());
    safe("quest/story", () => this.d.questStory.renderCore());
    safe("competitive", () => this.d.competitive.renderCore());
    safe("social/economy", () => this.d.socialEconomy.renderCore());
    safe("trade", () => this.d.renderTrade());
    safe("mail", () => this.d.renderMail());
    safe("world-event", () => this.d.renderWorldEvent());
    safe("combat", () => this.d.renderCombat());
    safe("level-up", () => this.d.renderLevelUp());
    safe("skill-bar", () => this.d.updateSkillBar());

    if (this.d.isModalOpen("buildModal"))
      safe("build", () => this.d.character.renderBuild());
    if (this.d.isModalOpen("trainerModal"))
      safe("trainer", () => this.d.character.renderTrainer());
    if (this.d.isModalOpen("shopModal"))
      safe("shop", () => this.d.renderShop());
    if (this.d.isModalOpen("auctionModal"))
      safe("auction", () => this.d.socialEconomy.renderAuction());
    if (this.d.isModalOpen("partyModal"))
      safe("party", () => this.d.socialEconomy.renderParty());
    if (this.d.isModalOpen("socialModal"))
      safe("social", () => this.d.socialEconomy.renderSocial());
    if (this.d.isModalOpen("pvpModal"))
      safe("pvp", () => this.d.competitive.renderPvp());
    if (this.d.isModalOpen("professionModal"))
      safe("professions", () => this.d.socialEconomy.renderProfessions());
    if (this.d.isModalOpen("dungeonModal"))
      safe("dungeon", () => this.d.competitive.renderDungeon());
    if (this.d.isModalOpen("npcModal") && this.d.getOpenNpcId())
      safe("npc", () => this.d.questStory.renderNpc());
    safe("world-map", () => this.d.worldIntel.renderMap());
  }
}
