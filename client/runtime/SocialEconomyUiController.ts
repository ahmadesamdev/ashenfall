export interface SocialEconomyUiDeps {
  chat: () => void;
  log: () => void;
  trade: () => void;
  mail: () => void;
  party: () => void;
  social: () => void;
  professions: () => void;
  auction: () => void;
}
export class SocialEconomyUiController {
  constructor(private readonly d: SocialEconomyUiDeps) {}
  renderCore() {
    for (const [name, fn] of Object.entries({
      chat: this.d.chat,
      log: this.d.log,
      trade: this.d.trade,
      mail: this.d.mail,
    })) {
      try {
        fn();
      } catch (e) {
        console.error(`Social UI ${name} failed`, e);
      }
    }
  }
  renderParty() {
    this.d.party();
  }
  renderSocial() {
    this.d.social();
  }
  renderProfessions() {
    this.d.professions();
  }
  renderAuction() {
    this.d.auction();
  }
}
