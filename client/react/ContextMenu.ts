import * as React from "react";
import { createRoot } from "react-dom/client";

const e = React.createElement;
const ACTIONS = [
  ["target", "🎯 Target"],
  ["inspect", "🔎 Inspect"],
  ["friend", "🤝 Add Friend"],
  ["whisper", "💬 Whisper"],
  ["trade", "🤝 Trade"],
  ["party", "👥 Invite to Party"],
  ["pvp", "⚔️ Challenge to PvP"],
  ["pvp-open", "🗡️ Attack (PvP Zone)"],
];
function ContextMenu({ data }: { data: any }) {
  if (!data?.open) return null;
  const act = (action: string) => {
    (window as any).__ashenfallContextMenuAction?.(action, data.targetId);
  };
  return e(
    React.Fragment,
    null,
    e("div", { className: "context-title" }, `${data.name} • Lv ${data.level}`),
    ...ACTIONS.map(([id, label]) =>
      e("button", { key: id, type: "button", onClick: () => act(id) }, label),
    ),
  );
}
let root: any = null;
let mounted = false;
const state: any = { open: false };
export function syncContextMenu(patch: any) {
  Object.assign(state, patch);
  root?.render(e(ContextMenu, { data: state }));
}
export function mountContextMenu() {
  if (mounted) return;
  mounted = true;
  const host = document.getElementById("contextMenu");
  if (!host) return;
  host.innerHTML = "";
  root = createRoot(host);
  (window as any).__ashenfallReactContextMenuMounted = true;
  (window as any).__ashenfallReactContextMenuSync = (patch: any) =>
    syncContextMenu(patch);
  (window as any).__ashenfallReactContextMenuRender = () =>
    root?.render(e(ContextMenu, { data: state }));
  root.render(e(ContextMenu, { data: state }));
}
