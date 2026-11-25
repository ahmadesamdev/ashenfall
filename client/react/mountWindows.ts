import * as React from "react";
import { createRoot } from "react-dom/client";
import { BagModal } from "./BagModal.js";
import {
  BuildModal,
  CharacterModal,
  QuestModal,
  SkillsModal,
} from "./ProgressionWindows.js";
import {
  LevelUpModal,
  LootModal,
  NpcModal,
  ShopModal,
  TrainerModal,
} from "./InteractionWindows.js";
import {
  AuctionModal,
  DungeonMatchModal,
  DungeonModal,
  MailModal,
  PartyModal,
  ProfessionModal,
  PvpModal,
  SocialInviteModal,
  SocialModal,
  TradeModal,
} from "./SocialCompetitiveWindows.js";

let root: { render(node: any): void; unmount(): void } | null = null;
let mounted = false;
const open = new Set<string>();
const REACT_WINDOWS = [
  "buildModal",
  "bagModal",
  "skillModal",
  "characterModal",
  "questModal",
  "trainerModal",
  "shopModal",
  "npcModal",
  "lootModal",
  "levelUpModal",
  "partyModal",
  "socialModal",
  "mailModal",
  "auctionModal",
  "professionModal",
  "pvpModal",
  "dungeonModal",
  "dungeonMatchModal",
  "socialInviteModal",
  "tradeModal",
];

function removeLegacyWindows() {
  for (const id of REACT_WINDOWS) document.getElementById(id)?.remove();
}

function ensureHost(): HTMLElement {
  let host = document.getElementById("reactWindows");
  if (!host) {
    host = document.createElement("div");
    host.id = "reactWindows";
    document.body.appendChild(host);
  }
  return host;
}

function renderWindows() {
  if (!root) return;
  root.render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(BagModal, { visible: open.has("bagModal") }),
      React.createElement(SkillsModal, { visible: open.has("skillModal") }),
      React.createElement(CharacterModal, {
        visible: open.has("characterModal"),
      }),
      React.createElement(BuildModal, { visible: open.has("buildModal") }),
      React.createElement(QuestModal, { visible: open.has("questModal") }),
      React.createElement(TrainerModal, { visible: open.has("trainerModal") }),
      React.createElement(ShopModal, { visible: open.has("shopModal") }),
      React.createElement(NpcModal, { visible: open.has("npcModal") }),
      React.createElement(LootModal, { visible: open.has("lootModal") }),
      React.createElement(LevelUpModal, { visible: open.has("levelUpModal") }),
      React.createElement(PartyModal, { visible: open.has("partyModal") }),
      React.createElement(SocialModal, { visible: open.has("socialModal") }),
      React.createElement(MailModal, { visible: open.has("mailModal") }),
      React.createElement(AuctionModal, { visible: open.has("auctionModal") }),
      React.createElement(ProfessionModal, {
        visible: open.has("professionModal"),
      }),
      React.createElement(PvpModal, { visible: open.has("pvpModal") }),
      React.createElement(DungeonModal, { visible: open.has("dungeonModal") }),
      React.createElement(DungeonMatchModal, {
        visible: open.has("dungeonMatchModal"),
      }),
      React.createElement(SocialInviteModal, {
        visible: open.has("socialInviteModal"),
      }),
      React.createElement(TradeModal, { visible: open.has("tradeModal") }),
    ),
  );
  requestAnimationFrame(() =>
    window.dispatchEvent(new Event("ashenfall-react-window-mounted")),
  );
}

export function mountWindows() {
  if (mounted) return;
  removeLegacyWindows();
  root = createRoot(ensureHost());
  mounted = true;
  (window as any).__ashenfallReactWindowsMounted = true;
  window.addEventListener("ashenfall-modal-state", (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string; open?: boolean }>)
      .detail;
    if (!detail?.id || !REACT_WINDOWS.includes(detail.id)) return;
    if (detail.open) open.add(detail.id);
    else open.delete(detail.id);
    renderWindows();
  });
  renderWindows();
}
