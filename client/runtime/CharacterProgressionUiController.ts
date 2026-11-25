export interface CharacterProgressionUiDeps {
  progression: () => void;
  loadouts: () => void;
  inventory: () => void;
  equipment: () => void;
  characterModal: () => void;
  build: () => void;
  trainer: () => void;
  skills: () => void;
  skillBar: () => void;
}
export class CharacterProgressionUiController {
  constructor(private readonly d: CharacterProgressionUiDeps) {}
  renderCore() {
    for (const [name, fn] of Object.entries({
      progression: this.d.progression,
      loadouts: this.d.loadouts,
      inventory: this.d.inventory,
      equipment: this.d.equipment,
      skillBar: this.d.skillBar,
    })) {
      try {
        fn();
      } catch (e) {
        console.error(`Character UI ${name} failed`, e);
      }
    }
  }
  renderCharacterModal() {
    this.d.characterModal();
  }
  renderBuild() {
    this.d.build();
  }
  renderTrainer() {
    this.d.trainer();
  }
  renderSkills() {
    this.d.skills();
  }
}
