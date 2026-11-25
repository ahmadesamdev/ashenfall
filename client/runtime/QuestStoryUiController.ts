export interface QuestStoryUiDeps {
  quests: () => void;
  story: () => void;
  syncStory: () => void;
  questJournal: () => void;
  questDetail: () => void;
  npc: () => void;
  worldEvent: () => void;
  isQuestModalOpen: () => boolean;
  questTab: () => string;
}
export class QuestStoryUiController {
  constructor(private readonly d: QuestStoryUiDeps) {}
  renderCore() {
    for (const [name, fn] of Object.entries({
      quests: this.d.quests,
      story: this.d.story,
      syncStory: this.d.syncStory,
      worldEvent: this.d.worldEvent,
    })) {
      try {
        fn();
      } catch (e) {
        console.error(`Quest UI ${name} failed`, e);
      }
    }
  }
  renderQuestModal() {
    if (!this.d.isQuestModalOpen()) return;
    this.d.questJournal();
    if (this.d.questTab() !== "story") this.d.questDetail();
  }
  renderNpc() {
    this.d.npc();
  }
}
