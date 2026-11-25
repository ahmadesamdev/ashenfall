import * as React from "react";
import { createRoot } from "react-dom/client";

const e = React.createElement;

type UtilityState = {
  story?: {
    open: boolean;
    step: number;
    total: number;
    title: string;
    speaker: string;
    text: string;
    button: string;
  };
  death?: {
    open: boolean;
    message: string;
    remainingMs: number;
    ready: boolean;
  };
  settings?: {
    maxPlayers: number;
    showNames: boolean;
    showMobs: boolean;
    showTerrain: boolean;
    reduceMotion: boolean;
  };
  account?: {
    sessions: Array<{ createdAt?: unknown; expiresAt?: unknown }>;
    status: string;
  };
  combatLog?: Array<{ t?: string; msg?: string }>;
};

let mounted = false;
let roots: Record<string, any> = {};
const state: UtilityState = {};

function ensureRoot(hostId: string, selector?: string) {
  const host = document.getElementById(hostId);
  if (!host) return null;
  const mount = selector
    ? (host.querySelector(selector) as HTMLElement | null)
    : host;
  if (!mount) return null;
  mount.innerHTML = "";
  const root = createRoot(mount);
  roots[hostId] = root;
  return root;
}

function Story() {
  const d = state.story || {
    open: false,
    step: 0,
    total: 0,
    title: "Ashes of the Past",
    speaker: "Captain Aric",
    text: "",
    button: "Continue",
  };
  if (!d.open) return null;
  const advance = () => {
    const fn = (window as any).__ashenfallStoryAdvance;
    if (fn) fn();
  };
  return e(
    React.Fragment,
    null,
    e("div", { className: "eyebrow" }, `Prologue • ${d.step + 1}`),
    e("h2", { id: "dialogueTitle" }, d.title),
    e("div", { className: "speaker", id: "dialogueSpeaker" }, d.speaker),
    e("p", { id: "dialogueText" }, d.text),
    e(
      "button",
      {
        id: "dialogueNext",
        className: "primary",
        type: "button",
        onClick: advance,
        disabled: false,
      },
      d.button,
    ),
  );
}

function Death() {
  const d = state.death || {
    open: false,
    message: "You have fallen.",
    remainingMs: 0,
    ready: false,
  };
  if (!d.open) return null;
  const remaining = Math.max(0, d.remainingMs);
  return e(
    React.Fragment,
    null,
    e("div", { className: "skull" }, "☠️"),
    e("h1", null, "You Died"),
    e("p", { id: "deathText" }, d.message),
    e(
      "div",
      { id: "respawnTimer" },
      remaining > 0 ? `Respawn in ${(remaining / 1000).toFixed(1)}s` : "Ready",
    ),
    e(
      "button",
      {
        id: "respawnBtn",
        className: "primary",
        type: "button",
        disabled: remaining > 0 || !d.ready,
        onClick: () => {
          (window as any).__ashenfallRespawn?.();
        },
      },
      "Respawn",
    ),
  );
}

function Settings() {
  const d = state.settings || {
    maxPlayers: 80,
    showNames: true,
    showMobs: true,
    showTerrain: true,
    reduceMotion: false,
  };
  const account = state.account || { sessions: [], status: "" };
  const set = (key: string, value: any) => {
    (window as any).__ashenfallSettingsChange?.(key, value);
  };
  const date = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0
      ? new Date(n).toLocaleString()
      : "Unavailable";
  };
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "modal-head" },
      e(
        "div",
        null,
        e("div", { className: "eyebrow" }, "GAME CONFIGURATION"),
        e("h2", null, "⚙️ World Settings"),
        e(
          "div",
          { className: "muted" },
          "Presentation, visibility and account controls for this browser.",
        ),
      ),
      e(
        "button",
        {
          type: "button",
          "data-action": "close-modal",
          "data-modal": "settingsModal",
        },
        "×",
      ),
    ),
    e(
      "div",
      { className: "settings-sections" },
      e(
        "section",
        { className: "settings-section" },
        e(
          "div",
          { className: "settings-section-head" },
          e(
            "div",
            null,
            e("h3", null, "Account & Sessions"),
            e(
              "span",
              { className: "muted" },
              "Manage the sessions attached to this account.",
            ),
          ),
          e("span", { className: "settings-section-icon" }, "👤"),
        ),
        e(
          "div",
          { className: "account-session-list" },
          account.sessions.length
            ? account.sessions.map((session: any, index: number) =>
                e(
                  "div",
                  {
                    className: "account-session-row",
                    key: `${session.createdAt || index}-${index}`,
                  },
                  e("b", null, `Session ${index + 1}`),
                  e("span", null, `Created ${date(session.createdAt)}`),
                  e("span", null, `Expires ${date(session.expiresAt)}`),
                ),
              )
            : e(
                "div",
                { className: "muted" },
                account.status || "No active account sessions.",
              ),
        ),
        account.status && account.sessions.length
          ? e("div", { className: "settings-status" }, account.status)
          : null,
        e(
          "div",
          { className: "actions-inline" },
          e(
            "button",
            { type: "button", "data-account-action": "refresh-sessions" },
            "Refresh sessions",
          ),
          e(
            "button",
            { type: "button", "data-account-action": "logout-all" },
            "Sign out all sessions",
          ),
        ),
      ),
      e(
        "section",
        { className: "settings-section" },
        e(
          "div",
          { className: "settings-section-head" },
          e(
            "div",
            null,
            e("h3", null, "World Visibility"),
            e(
              "span",
              { className: "muted" },
              "Control how much shared-world information is drawn.",
            ),
          ),
          e("span", { className: "settings-section-icon" }, "👁️"),
        ),
        e(
          "label",
          { className: "settings-row" },
          e(
            "div",
            null,
            e("b", null, "Maximum visible players"),
            e(
              "span",
              { className: "muted" },
              "Lower this on crowded screens to reduce client rendering work.",
            ),
          ),
          e(
            "div",
            { className: "settings-control" },
            e("input", {
              id: "settingMaxPlayers",
              type: "range",
              min: 10,
              max: 250,
              step: 10,
              value: d.maxPlayers,
              onChange: (ev: any) => set("maxPlayers", Number(ev.target.value)),
            }),
            e("output", { id: "settingMaxPlayersValue" }, d.maxPlayers),
          ),
        ),
        e(
          "label",
          { className: "settings-row" },
          e(
            "div",
            null,
            e("b", null, "Player names"),
            e(
              "span",
              { className: "muted" },
              "Show names above nearby players.",
            ),
          ),
          e("input", {
            id: "settingShowNames",
            type: "checkbox",
            checked: d.showNames,
            onChange: (ev: any) => set("showNames", ev.target.checked),
          }),
        ),
        e(
          "label",
          { className: "settings-row" },
          e(
            "div",
            null,
            e("b", null, "Mob names & health"),
            e(
              "span",
              { className: "muted" },
              "Show creature names and health bars.",
            ),
          ),
          e("input", {
            id: "settingShowMobs",
            type: "checkbox",
            checked: d.showMobs,
            onChange: (ev: any) => set("showMobs", ev.target.checked),
          }),
        ),
        e(
          "label",
          { className: "settings-row" },
          e(
            "div",
            null,
            e("b", null, "Terrain & landmarks"),
            e(
              "span",
              { className: "muted" },
              "Show authored terrain icons and landmarks.",
            ),
          ),
          e("input", {
            id: "settingShowTerrain",
            type: "checkbox",
            checked: d.showTerrain,
            onChange: (ev: any) => set("showTerrain", ev.target.checked),
          }),
        ),
      ),
      e(
        "section",
        { className: "settings-section" },
        e(
          "div",
          { className: "settings-section-head" },
          e(
            "div",
            null,
            e("h3", null, "Motion"),
            e(
              "span",
              { className: "muted" },
              "Adjust presentation without changing movement simulation.",
            ),
          ),
          e("span", { className: "settings-section-icon" }, "◌"),
        ),
        e(
          "label",
          { className: "settings-row" },
          e(
            "div",
            null,
            e("b", null, "Reduce camera interpolation"),
            e(
              "span",
              { className: "muted" },
              "Use a less interpolated camera presentation.",
            ),
          ),
          e("input", {
            id: "settingReduceMotion",
            type: "checkbox",
            checked: d.reduceMotion,
            onChange: (ev: any) => set("reduceMotion", ev.target.checked),
          }),
        ),
      ),
    ),
    e(
      "button",
      {
        className: "primary wide",
        "data-action": "close-modal",
        "data-modal": "settingsModal",
      },
      "Done",
    ),
  );
}

function CombatLog() {
  const log = state.combatLog || [];
  return e(
    React.Fragment,
    null,
    ...log
      .slice(-100)
      .map((x, i) =>
        e(
          "div",
          { className: "row", key: `${i}-${x.t || ""}-${x.msg || ""}` },
          e("span", { className: "muted" }, x.t || ""),
          " ",
          x.msg || "",
        ),
      ),
  );
}

export function syncUtilityState(patch: UtilityState) {
  Object.assign(state, patch);
  renderAll();
}
function renderAll() {
  roots.story?.render(e(Story));
  roots.death?.render(e(Death));
  roots.settings?.render(e(Settings));
  roots.combatLog?.render(e(CombatLog));
}

export function mountUtilityOverlays() {
  if (mounted) return;
  mounted = true;
  roots.story = ensureRoot("storyModal", ".modal-card");
  roots.death = ensureRoot("deathModal", ".modal-card");
  roots.settings = ensureRoot("settingsModal", ".modal-card");
  roots.combatLog = ensureRoot("log");
  (window as any).__ashenfallReactUtilityMounted = true;
  (window as any).__ashenfallReactUtilityRender = renderAll;
  window.addEventListener("ashenfall-react-utility-state", () => renderAll());
  window.dispatchEvent(new Event("ashenfall-react-utility-mounted"));
  renderAll();
}
