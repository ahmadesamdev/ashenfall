export interface ClientSettingsControllerDeps {
  getSettings: () => any;
  persist: (settings: any) => void;
  markUiDirty: () => void;
  redrawWorldMap: () => void;
  applyVisualSystem: () => void;
}

export class ClientSettingsController {
  constructor(private readonly d: ClientSettingsControllerDeps) {}

  save(): void {
    this.d.persist(this.d.getSettings());
    this.d.markUiDirty();
    this.d.redrawWorldMap();
  }

  set<K extends string>(key: K, value: any): void {
    this.d.getSettings()[key] = value;
    this.save();
    if (key === "reduceMotion") this.d.applyVisualSystem();
  }
}
