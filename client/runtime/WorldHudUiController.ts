export interface WorldHudUiDeps {
  header: () => void;
  players: () => void;
  zones: () => void;
  questHelper: () => void;
}

export class WorldHudUiController {
  constructor(private readonly d: WorldHudUiDeps) {}
  renderCore() {
    for (const [name, fn] of Object.entries({
      header: this.d.header,
      players: this.d.players,
      zones: this.d.zones,
      questHelper: this.d.questHelper,
    })) {
      try {
        fn();
      } catch (e) {
        console.error(`World HUD ${name} failed`, e);
      }
    }
  }
}
