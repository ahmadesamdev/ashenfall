import * as React from "react";
import { createRoot } from "react-dom/client";
import { BottomMenu } from "./BottomMenu.js";

let root: { render(node: any): void; unmount(): void } | null = null;
let mounted = false;
let lastUnreadMail = -1;
let lastRunning = false;

function readRuntimeState() {
  const runtime = window as any;
  const state = runtime.__ashenfallClientState;
  return {
    unreadMail: Number(
      state?.mail?.unread ?? runtime.__ashenfallUnreadMail ?? 0,
    ),
    running:
      state?.player?.movementMode === "run" ||
      runtime.__ashenfallMovementMode === "run",
  };
}

export function mountBottomMenu() {
  const host = document.getElementById("bottomMenu");
  if (!host || mounted) return;
  root = createRoot(host);
  mounted = true;
  renderBottomMenu();
  window.dispatchEvent(new Event("ashenfall-ui-settings"));
}

export function renderBottomMenu() {
  if (!root) return;
  const { unreadMail, running } = readRuntimeState();
  if (unreadMail === lastUnreadMail && running === lastRunning) return;
  lastUnreadMail = unreadMail;
  lastRunning = running;
  root.render(React.createElement(BottomMenu, { unreadMail, running }));
}
