import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const coordinator = read("client/runtime/ClientUiRenderCoordinator.ts");
const runtime = read("client/ClientApplicationRuntime.ts");
const utility = read("client/react/UtilityOverlays.ts");
const realtime = read("client/runtime/ClientRealtimeUiController.ts");
const onboarding = read("client/react/Onboarding.ts");
const style = read("client/style.css");
assert.ok(
  runtime.includes(
    "import { syncUtilityState } from './react/UtilityOverlays.js';",
  ),
  "runtime must import the actual utility-state store",
);
assert.ok(
  runtime.includes("syncUtilityState(patch);"),
  "overlay patches must update React state, not just dispatch an event",
);
assert.ok(
  utility.includes("window.addEventListener('ashenfall-react-utility-state'"),
  "legacy state event listener remains supported",
);
assert.ok(
  !/safe\('[^']+',this\.d\./.test(coordinator),
  "no coordinator method may be passed unbound",
);
assert.ok(
  (coordinator.match(/safe\('[^']+',\(\)=>this\.d\./g) || []).length >= 20,
  "render callbacks must preserve their owning controller context",
);
assert.ok(
  runtime.includes("if(reactUtilityMounted()){syncStoryModal();return;}"),
  "React-owned story content must not be mutated through legacy DOM code",
);
assert.ok(
  runtime.includes(
    "const playersEl=$('players');if(!playersEl||!state?.player)return;",
  ),
  "removed players host must be guarded",
);
assert.ok(
  realtime.includes("if(state?.player){") &&
    realtime.includes("this.d.renderTarget?.();"),
  "pre-login realtime tick must not call target rendering without player state",
);
assert.ok(
  runtime.includes(
    "function renderTarget(){const p=state?.player;if(!p)return;",
  ),
  "target rendering must guard its own pre-login entrypoint",
);
assert.ok(
  onboarding.includes("String(c.portrait||c.id).replace(/\\.png$/i,'')"),
  "class portrait extension must not be duplicated",
);
assert.ok(
  style.includes(
    "#storyModal>.modal-card.dialogue:empty:after{display:none!important;content:none!important}",
  ),
  "empty story modal must not show its decorative gold rule",
);
console.log(
  "client-ui-regressions: PASS — overlay state bridge, bound render methods, startup guards, portrait path",
);

const emittedCoordinator = path.join(
  root,
  "dist/client/runtime/ClientUiRenderCoordinator.js",
);
if (fs.existsSync(emittedCoordinator)) {
  const { ClientUiRenderCoordinator } = await import(
    new URL(`file://${emittedCoordinator}`)
  );
  const counter = {
    calls: 0,
    bump() {
      this.calls++;
    },
  };
  const controller = (names) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        function () {
          this.calls++;
        },
      ]),
    );
  const deps = {
    calls: 0,
    getState: () => ({ player: {} }),
    safeRender: (_name, fn) => fn(),
    isModalOpen: () => false,
    getQuestJournalTab: () => "current",
    getOpenNpcId: () => null,
    character: Object.assign(
      controller(["renderCore", "renderBuild", "renderTrainer"]),
      { calls: 0 },
    ),
    questStory: Object.assign(controller(["renderCore", "renderNpc"]), {
      calls: 0,
    }),
    socialEconomy: Object.assign(
      controller([
        "renderCore",
        "renderAuction",
        "renderParty",
        "renderSocial",
        "renderProfessions",
      ]),
      { calls: 0 },
    ),
    competitive: Object.assign(
      controller(["renderCore", "renderPvp", "renderDungeon"]),
      { calls: 0 },
    ),
    worldHud: Object.assign(controller(["renderCore"]), { calls: 0 }),
    worldIntel: Object.assign(controller(["renderCore", "renderMap"]), {
      calls: 0,
    }),
    renderMail() {
      this.calls++;
    },
    renderWorldEvent() {
      this.calls++;
    },
    renderTrade() {
      this.calls++;
    },
    renderCombat() {
      this.calls++;
    },
    renderLevelUp() {
      this.calls++;
    },
    renderShop() {
      this.calls++;
    },
    renderNpcModal() {
      this.calls++;
    },
    updateSkillBar() {
      this.calls++;
    },
  };
  new ClientUiRenderCoordinator(deps).renderAll();
  const controllerCalls = [
    deps.character,
    deps.questStory,
    deps.socialEconomy,
    deps.competitive,
    deps.worldHud,
    deps.worldIntel,
  ].reduce((n, c) => n + c.calls, 0);
  assert.equal(
    controllerCalls,
    7,
    "each core controller method must run with its owner as this",
  );
  assert.equal(
    deps.calls,
    6,
    "top-level render callbacks must also preserve the dependency object as this",
  );
  console.log(
    "client-ui-coordinator-binding: PASS — all core render methods retain their receiver",
  );
}

{
  const rootDir = path.resolve(
    path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    ),
    "../..",
  );
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), "utf8");
  const windows = read("client/react/ProgressionWindows.ts");
  const mount = read("client/react/mountWindows.ts");
  const runtime = read("client/ClientApplicationRuntime.ts");
  assert.match(
    windows,
    /export function BuildModal/,
    "talent window component exists",
  );
  assert.match(
    windows,
    /id: 'buildModal'/,
    "talent window uses the buildModal id the opener targets",
  );
  assert.match(
    windows,
    /id: 'talentList'/,
    "talent window provides the list container the renderer fills",
  );
  assert.match(
    windows,
    /id: 'buildResetSection'/,
    "talent window provides the reset container the renderer fills",
  );
  assert.match(
    mount,
    /'buildModal'/,
    "talent window is registered as a React window",
  );
  assert.match(
    mount,
    /React\.createElement\(BuildModal/,
    "talent window is rendered by the window host",
  );
  assert.match(
    runtime,
    /ashenfall-react-window-mounted[\s\S]{0,200}buildModal[\s\S]{0,160}renderBuild\(\)/,
    "talent contents render once the window mounts",
  );
  assert.match(
    windows,
    /function StoryArcDetail/,
    "story arc detail component exists",
  );
  assert.match(
    windows,
    /tab === 'story' \? h\(StoryArcDetail/,
    "story tab shows the selected arc instead of the quest placeholder",
  );
  console.log(
    "client-ui-talents-and-story: PASS — talent window and story arc detail are wired",
  );
}

{
  const rootDir = path.resolve(
    path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    ),
    "../..",
  );
  const onboarding = fs.readFileSync(
    path.join(rootDir, "client/react/Onboarding.ts"),
    "utf8",
  );
  assert.match(
    onboarding,
    /const actionRef=React\.useRef\(action\);\s*actionRef\.current=action;/,
    "the auth click listener keeps a ref to the latest submit handler",
  );
  assert.match(
    onboarding,
    /else actionRef\.current\(kind\)/,
    "auth buttons call the latest handler, not the first-render closure",
  );
  assert.doesNotMatch(
    onboarding,
    /\baction\(kind\)/,
    "auth buttons never call a stale first-render handler",
  );
  assert.doesNotMatch(
    onboarding,
    /fields\.\w+\|\|''/,
    "submitted values come from the live inputs, not only from React state",
  );
  assert.match(
    onboarding,
    /val\('registerEmail'\)/,
    "registration reads the email through the live-value helper",
  );
  console.log(
    "client-auth-form-submit: PASS — register, login, verify and reset submit the values the user entered",
  );
}
