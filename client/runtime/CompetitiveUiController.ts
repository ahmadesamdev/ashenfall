export interface CompetitiveUiDeps {
  pvp: () => void;
  dungeon: () => void;
  partyHud: () => void;
  combat: () => void;
  target: () => void;
  death: () => void;
}
export class CompetitiveUiController {
  constructor(private readonly d: CompetitiveUiDeps) {}
  renderCore() {
    this.d.partyHud();
    this.d.combat();
    this.d.target();
    this.d.death();
  }
  renderPvp() {
    this.d.pvp();
  }
  renderDungeon() {
    this.d.dungeon();
  }
}
