export interface WorldIntelUiDeps {
  worldMap: () => void;
  isWorldMapOpen: () => boolean;
}
export class WorldIntelUiController {
  constructor(private readonly d: WorldIntelUiDeps) {}
  renderCore() {}
  renderMap() {
    if (this.d.isWorldMapOpen()) this.d.worldMap();
  }
}
