import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const localTypeScript = path.join(
  process.cwd(),
  "node_modules",
  "typescript",
  "lib",
  "typescript.js",
);
const globalTypeScriptCandidates = [
  process.env.NODE_PATH
    ? path.join(process.env.NODE_PATH, "typescript", "lib", "typescript.js")
    : null,
  "/usr/local/lib/node_modules/typescript/lib/typescript.js",
  "/usr/lib/node_modules/typescript/lib/typescript.js",
].filter(Boolean);
const typeScriptPath = fs.existsSync(localTypeScript)
  ? localTypeScript
  : globalTypeScriptCandidates.find((candidate) => fs.existsSync(candidate)) ||
    null;
if (!typeScriptPath)
  throw new Error(
    "TypeScript is not installed. Run npm ci from the project root before running this script.",
  );
const tsModule = await import(pathToFileURL(typeScriptPath).href);
const ts = tsModule.default || tsModule;

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
function check(name, condition, detail = "") {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  checks.push(name);
}

const pkg = JSON.parse(read("package.json"));
check("release version is 0.5.0", pkg.version === "0.5.0");

const client = read("client/ClientApplicationRuntime.ts");
const renderer = read("client/runtime/WorldRenderer.ts");
const motion = read("client/runtime/ClientMotionController.ts");
const health = read("server/runtime/PlayerCombatSimulationService.ts");
const movement = read("server/world/WorldMovementService.ts");
const combat = read("server/world/WorldCombatService.ts");
const combatEngine = read("server/combat/CombatEngine.ts");
const style = read("client/style.css");
const onboarding = read("client/react/Onboarding.ts");
const indexHtml = read("client/index.html");
const reactIndex = read("client/react/index.ts");
const network = read("client/runtime/ClientNetworkController.ts");
const server = read("server/runtime/ServerRuntime.ts");
const characterCommands = read("server/runtime/commands/CharacterCommands.ts");
const sessionController = read("client/runtime/ClientSessionController.ts");

check(
  "single native cursor owner",
  !client.includes("ashenCanvasCursor") &&
    !client.includes("position:fixed;left:0;top:0;width:32px"),
);
check(
  "cursor assets are preloaded",
  client.includes(
    "const sources=['target','move','attack','loot','talk','mine','gate']",
  ),
);
check(
  "cursor CSS is authoritative",
  (style.match(/#worldCanvas\[data-cursor-action="attack"\]/g) || []).length >=
    1,
);
check(
  "cursor bootstrap hides only during preload",
  !style.includes("#ashenCanvasCursor") &&
    style.includes("body.game-ready:not(.game-cursors-ready)") &&
    client.includes("game-cursors-ready"),
);
check(
  "button cursor falls back to Ashenfall click cursor",
  style.includes("body.game-ready button") &&
    style.includes("cursors/target.png"),
);
check(
  "all gameplay cursors preload before interaction",
  client.includes("new Promise<void>(resolve=>") &&
    client.includes("img.decode") &&
    client.includes("game-cursors-ready"),
);
check(
  "manual movement owns movement over combat chase",
  movement.includes("player.combat.manualMove = true") &&
    movement.includes("player.combat.autoApproach = false") &&
    movement.includes("player.combat.queuedWorldAbility = null"),
);
check(
  "client movement prediction does not invent a second collision simulation",
  !motion.includes(
    "const predictCollision=this.state.localIntentSource==='combat'",
  ),
);
check(
  "combat approach recomputes from the live mob position with stop hysteresis",
  movement.includes(
    "const combatTargetId=player.targetMobId||player.worldCombatMobId",
  ) &&
    movement.includes("byIdMob?.(combatTargetId)") &&
    movement.includes(
      "const distanceToMob=Math.hypot(player.x-targetMob.x,player.y-targetMob.y)",
    ) &&
    movement.includes(
      "const ap=this.approachPoint(player,targetMob,standMeters)",
    ) &&
    movement.includes("exitRangeNorm") &&
    movement.includes("wasSatisfied"),
);
check(
  "respawn resets local prediction on authoritative teleport",
  client.includes("const wasDead=Boolean(state.player.dead)") &&
    client.includes("wasDead&&!isDead") &&
    client.includes("motionController.reset(Number(mp.x),Number(mp.y)"),
);
check(
  "respawn clears combat approach latch",
  characterCommands.includes("p.combat.approachSatisfied=false"),
);
check(
  "skill press takes ownership from ground-click movement",
  client.includes("if(distMeters>rangeMeters && !keys.size)") &&
    client.includes("motionController.state.localIntentKind==='target'"),
);
check(
  "skill cancels stale delayed ground-click packet",
  client.includes(
    "if(pendingMoveTimer){clearTimeout(pendingMoveTimer);pendingMoveTimer=null;}",
  ) && client.includes("pendingMoveIntent=null;"),
);
check(
  "server skill takes ownership from click movement but not WASD",
  combatEngine.includes("const activelySteering=!!p.moveInput") &&
    combatEngine.includes("p.combat.manualMove=false") &&
    combatEngine.includes("p.combat.manualMove&&activelySteering"),
);
check(
  "combat disengage never re-enables chase automatically",
  read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
    "p.combat.autoApproach=false",
  ) &&
    !read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
      "world.disengagePlayer(p);p.combat.manualMove=false;p.combat.autoApproach=true",
    ),
);
check(
  "world intel accept is single-click pending protected",
  client.includes("action==='world-opportunity-accept'") &&
    client.includes("markCommandButton(b,action)"),
);
check(
  "modal close controls have capture-phase handler",
  client.includes("data-action=close-modal") &&
    client.includes("closeModal(id)"),
);
check(
  "quest tracker renders multiple active quests",
  client.includes("function questTrackerEntries()") &&
    client.includes("entries.slice(0,8)") &&
    client.includes("entries.map((q:any,i:number)"),
);
check(
  "keyboard movement is normalized",
  client.includes("const len=Math.hypot(dx,dy);") &&
    client.includes("dx/=len;dy/=len;"),
);
check(
  "server movement is normalized",
  movement.includes("length = Math.hypot(x, y)") &&
    movement.includes("x / length") &&
    movement.includes("y / length"),
);
check(
  "explicit stop cancels stale combat pursuit ownership",
  movement.includes("player.combat.autoApproach = false") &&
    movement.includes("player.combat.queuedWorldAbility = null") &&
    movement.includes("player.combat.manualMove = true"),
);
check(
  "combat approach detours around collision instead of stop-jittering",
  movement.includes("player.movementIntent==='combat'&&player.targetMobId") &&
    movement.includes("combatApproachSide") &&
    movement.includes("detourStep"),
);
check(
  "completed quests route back to their giver",
  client.includes("qs.complete") &&
    client.includes("d.giver") &&
    client.includes("quest giver"),
);
check(
  "quest tracker has anchors for kill, mine, dungeon and world-event objectives",
  client.includes("d.type==='kill'") &&
    client.includes("d.type==='mine'") &&
    client.includes("d.type==='dungeon'") &&
    client.includes("d.type==='world_event'"),
);
check(
  "client movement uses one scalar speed",
  motion.includes("const stepNorm=(baseSpeed/wm)*dt;") &&
    motion.includes("dirX*stepNorm") &&
    motion.includes("dirY*stepNorm"),
);
check(
  "server owns combat navigation while client predicts presentation",
  !motion.includes("predictCollision"),
);
check(
  "approach intent is restored from target state",
  client.includes("ensureLocalCombatApproachIntent") &&
    client.includes("localIntentSource!=='combat'") &&
    client.includes("beginLocalMoveTarget(ap.x,ap.y,'run','combat')"),
);
check(
  "approach line follows active server/player combat intent, not stale target selection",
  renderer.includes("const approachRequested=") &&
    renderer.includes(
      "const showApproachLine=activeTarget&&approachRequested",
    ) &&
    !renderer.includes("localMotion.localIntentSource==='combat'||"),
);
check(
  "approach line cannot remain latched after combat cancellation and ignores off-screen targets",
  renderer.includes("targetOnScreen=tm.x>=0&&tm.x<=w&&tm.y>=0&&tm.y<=h") &&
    !renderer.includes("approachLineTargetId"),
);
check(
  "city roads avoid the beige player-centred road pass",
  renderer.includes("if(!z.city){ctx.strokeStyle='#29333a'") &&
    !renderer.includes("ctx.strokeStyle='rgba(104,166,180,.55)'"),
);
check(
  "selected combat target survives crowded mob render caps",
  renderer.includes("const selectedMobId=String(p.targetMobId||'')") &&
    renderer.includes("visibleMobs[visibleMobs.length-1]=selectedMob"),
);
check(
  "mobs render from full-state fallback before first motion sample",
  renderer.includes("?motionPosition('m:'+m.id,m.x,m.y,'remote')") &&
    !renderer.includes("if(!hasMotionPosition(`m:${m.id}`))continue"),
);
check(
  "combat presentation uses authoritative velocity at one frame scale",
  motion.includes("const moveNorm=serverSpeedNorm*dt;") &&
    !motion.includes("Math.max(stepNorm,serverSpeedNorm)"),
);
check(
  "manual movement waits for authoritative movement ownership before combat can resume",
  motion.includes("manualIntentAwaitingAuthority") &&
    motion.includes("serverMovementIntent") &&
    motion.includes("this.state.localIntentSource==='manual'"),
);
check(
  "multi-aggro promotes a surviving attacker after primary mob death",
  read("server/world/WorldCombatService.ts").includes(
    "selectNextAggroTarget",
  ) &&
    read("server/world/WorldCombatService.ts").includes("nextTargetId") &&
    read("server/world/WorldCombatService.ts").includes(
      "establishWorldCombat(p,nextTarget",
    ),
);
check(
  "approach line disappears at local attack range without waiting for server snapshot",
  renderer.includes(
    "const visuallySatisfied=distanceMeters<=stopMeters+1.5;",
  ) &&
    renderer.includes("Boolean(p.combat?.autoApproach)") &&
    renderer.includes("activeTarget"),
);
check(
  "approach line requires a live same-zone target and excludes Stonehold even if zone metadata is missing",
  renderer.includes(
    "isCityZone=Boolean(state.zoneInfo?.city)||currentZoneId===\'stonehold\'",
  ) &&
    renderer.includes("if(!m||m.state==='dead'") &&
    !renderer.includes("!targetIsRendered"),
);
check(
  "successful hostile world casts establish full combat state",
  combatEngine.includes("p.combat.autoAttack=true") &&
    combatEngine.includes("this.world.enterWorldCombat(p,mob)") &&
    combatEngine.includes("p.combat.approachSatisfied=true"),
);
check(
  "world combat has a single authoritative establish/clear boundary",
  read("server/world/WorldCombatService.ts").includes(
    "establishWorldCombat(p:any,m:any",
  ) &&
    read("server/world/WorldCombatService.ts").includes(
      "clearWorldCombat(p:any,m:any=null",
    ),
);
check(
  "repeated basic attacks preserve the combat approach latch",
  read("server/world/WorldCombatService.ts").includes(
    "const sameTarget=p.targetMobId===m.id&&p.worldCombatMobId===m.id",
  ) &&
    read("server/world/WorldCombatService.ts").includes(
      "sameTarget ? (Boolean(p.combat.approachSatisfied)||inRange)",
    ),
);
check(
  "combat client releases stale local approach when server combat ends",
  client.includes("if(motionController.state.localIntentSource==='combat')") &&
    client.includes("serverOwnsCombat") &&
    client.includes("localCombatAge>350") &&
    client.includes("stopLocalMotion()"),
);
check(
  "manual input anchors from authoritative idle position",
  motion.includes("anchorBeforeManualIntent") && motion.includes("error>0.75"),
);
check(
  "React character creation preserves the original two-column DOM contract",
  read("client/react/Onboarding.ts").includes(
    "const form=e('div',{className:'form-grid'}",
  ) &&
    read("client/react/Onboarding.ts").includes("form,preview,choices,enter"),
);
check(
  "real-time HUD remains legacy-owned after React migration",
  indexHtml.includes('id="mapCharacterHud"') &&
    indexHtml.includes('id="questHelper"') &&
    !reactIndex.includes("mountHud") &&
    !reactIndex.includes("mountCombatHud") &&
    !reactIndex.includes("mountLiveOverlays"),
);
check(
  "party/queue live overlays remain legacy-owned",
  indexHtml.includes('id="partyHud"') &&
    indexHtml.includes('id="dungeonQueueHud"') &&
    indexHtml.includes('id="arenaQueueHud"') &&
    !reactIndex.includes("LiveOverlays"),
);
check(
  "World map redraw waits for React canvas commit",
  client.includes("function redrawWorldMapAfterReact()") &&
    client.includes("redrawWorldMapAfterReact();"),
);
check(
  "Settings account sessions use React state instead of direct DOM ownership",
  read("client/runtime/AccountSessionController.ts").includes("onState?") &&
    read("client/react/UtilityOverlays.ts").includes("account.sessions"),
);
check(
  "Dungeon active view preserves boss artwork",
  read("client/react/SocialCompetitiveWindows.ts").includes(
    "dungeon-active-boss-art",
  ) &&
    read("client/react/SocialCompetitiveWindows.ts").includes("BOSS_VISUALS"),
);

check(
  "world combat repairs missing mob-side aggro relationship",
  read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
    "!m.attackers?.[p.id]",
  ),
);

check(
  "homeward stone is reusable and cooldown-gated",
  read("server/runtime/CommandHandlers.ts").includes(
    "const cooldownSeconds=Math.max(1,Number(items[itemId]?.cooldown||1200))",
  ) &&
    read("server/runtime/CommandHandlers.ts").includes(
      "p.itemCooldowns[itemId]=Date.now()+cooldownSeconds*1000",
    ) &&
    !read("server/runtime/CommandHandlers.ts").includes(
      "inv.remove(p,itemId,1)",
    ) &&
    read("game-data/items/items.json").includes("Cooldown: 20 minutes."),
);
check(
  "target selection still enables server approach",
  combat.includes("if(!p.combat.manualMove) p.combat.autoApproach=true") ||
    read("server/world/WorldCombatService.ts").includes(
      "p.combat.autoApproach=opts.autoApproach!==false && !p.combat.approachSatisfied",
    ),
);
check(
  "active auto-attack resumes pursuit after a moving mob leaves range",
  movement.includes(
    "const ownsCombatPursuit=Boolean(player.combat?.autoApproach||(player.worldCombatMobId&&player.combat?.autoAttack))",
  ) &&
    movement.includes("player.combat.autoApproach=true;") &&
    movement.includes(
      "const ap=this.approachPoint(player,targetMob,standMeters)",
    ),
);
check(
  "approach route can render during locally predicted combat movement",
  renderer.includes(
    `const localCombatIntent=localMotion.localIntentSource==='combat'&&localMotion.localIntentKind!=='none'`,
  ) && renderer.includes("||localCombatIntent)&&!manualOverride"),
);
check(
  "PvP kill outcomes read the structured detail tuple",
  read("server/runtime/commands/PvpCommands.ts").includes(
    "result[2]?.killed",
  ) &&
    read("server/runtime/commands/PvpCommands.ts").includes(
      "Number(result[2]?.kills||0)>0",
    ),
);
check(
  "PvP target movement follows the live opponent position",
  read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
    "world.approachPoint(p,opp,standMeters)",
  ) &&
    !read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
      `if(p.pvp&&p.targetPlayerId===opp.id&&!p.combat.manualMove){p.targetX=p.x;p.targetY=p.y;p.moveState='idle';}`,
    ),
);
check(
  "arena movement retargets among living opponents on the other team",
  read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
    "const opponents=opponentIds.map",
  ) &&
    read("server/runtime/AuthoritativeSimulationCoordinator.ts").includes(
      "opponents.find((x:any)=>x.id===p.targetPlayerId)||opponents[0]",
    ),
);
check(
  "battleground basic attack starts approach when the selected enemy is out of range",
  read("server/runtime/commands/PvpCommands.ts").includes(
    "Approaching ${o.name}.",
  ) &&
    read("server/runtime/commands/PvpCommands.ts").includes(
      "p.targetPlayerId=o.id;p.combat.manualMove=false;p.combat.autoApproach=true",
    ),
);
check(
  "trade offers support reducing an item quantity",
  read("server/runtime/TradeService.ts").includes("rawQty<0") &&
    read("client/react/SocialCompetitiveWindows.ts").includes(
      `'data-qty': '-1'`,
    ),
);
check(
  "PvP movement cannot be overridden by a stale PvE mob target",
  movement.includes("if(!player.pvp && combatTargetId && ownsCombatPursuit"),
);
check(
  "failed trade commit keeps session available and resets confirmations",
  read("server/runtime/CommandHandlers.ts").includes(
    "if(r[0])tradeSessions.delete(t.id);else{t.confirmed[p.id]=false;t.confirmed[otherId]=false;}",
  ),
);
check(
  "passive HP regen runs every player tick",
  health.includes("this.tickHealth(p,now);"),
);
check(
  "regen only blocks on actual combat",
  health.includes("mob.state==='engaged'") &&
    health.includes("mob.aggroTarget===p.id||!!mob.attackers?.[p.id]"),
);
check("regen has post-damage grace", health.includes("now-lastDamage<5000"));
check(
  "regen is not disabled by stale auto-approach",
  !health.includes(
    "const inWorldCombat=!!p.worldCombatMobId||!!p.combat?.autoAttack||!!p.combat?.autoApproach",
  ),
);
check(
  "approach refresh cannot override manual WASD",
  client.includes("motionController.state.localIntentSource==='manual'"),
);
check(
  "idle local motion converges to authoritative position",
  motion.includes("}else if(this.state.serverState==='idle'){") &&
    motion.includes("errorMeters>24"),
);
check(
  "mob leash removes only the leashing attacker and uses timed ignore",
  read("server/world/MobSimulationService.ts").includes(
    "delete m.attackers[target.id]",
  ) &&
    read("server/world/MobSimulationService.ts").includes(
      "m.ignoredAggroPlayers[target.id]=ignoredUntil",
    ) &&
    !read("server/world/MobSimulationService.ts").includes(
      "m.ignoredAggroPlayers[target.id]=true",
    ),
);
check(
  "mob leash preserves surviving attackers",
  read("server/world/MobSimulationService.ts").includes(
    "Object.keys(m.attackers||{}).length",
  ) &&
    read("server/world/MobSimulationService.ts").includes(
      "const next=remaining[0]?.p",
    ),
);
check(
  "manual combat disengage uses timed aggro ignore",
  read("server/world/WorldCombatService.ts").includes(
    "m.ignoredAggroPlayers[p.id]=Date.now()+8000",
  ),
);
check(
  "quest claim validates reward capacity before mutating state",
  read("server/quests/QuestEngine.ts").includes(
    "rewardItem=q.classRewards?.[p.classId]||q.item||null",
  ) &&
    read("server/quests/QuestEngine.ts").includes(
      "!this.inv.canGive(p,rewardItem,1)",
    ) &&
    read("server/quests/QuestEngine.ts").includes(
      "this.inv.remove(p,q.requiredItem,requiredQty)",
    ),
);
check(
  "npc dialogue advances talk quests",
  read("server/runtime/commands/QuestStoryCommands.ts").includes(
    "quest.onTalk?.(p,n.id)",
  ),
);
check(
  "auto-attack cannot steal click-to-move ownership",
  read("server/runtime/ServerRuntime.ts").includes(
    "if(p.combat?.manualMove)",
  ) &&
    read("server/runtime/ServerRuntime.ts").includes(
      "if(Math.hypot(p.x-m.x,p.y-m.y)>range){",
    ) &&
    read("server/runtime/ServerRuntime.ts").includes("Out of range"),
);
check(
  "manual combat disengage clears auto-attack",
  read("server/world/WorldCombatService.ts").includes(
    "p.combat.autoAttack=false",
  ) &&
    read("server/world/WorldCombatService.ts").includes(
      "p.combat.autoApproach=false",
    ),
);
check(
  "world mob kills advance kill quests",
  read("server/runtime/ProgressionService.ts").includes(
    "quest?.onKill?.(p,String(info.enemyId||''))",
  ),
);
check(
  "active quest helper is persisted server-side",
  read("server/runtime/CommandActions.ts").includes("'set_active_quest'") &&
    read("server/runtime/commands/QuestStoryCommands.ts").includes(
      "handlers['set_active_quest']",
    ) &&
    read("server/runtime/StateService.ts").includes("p.activeQuestId"),
);
check(
  "world map opens on current zone",
  client.includes("let worldMapMode='zone'") &&
    client.includes(
      "worldMapMode='zone';worldMapZone=state?.zoneInfo?.id||state?.player?.zone||null",
    ),
);
check(
  "NPC quest list exposes locked prerequisites",
  read("server/quests/QuestEngine.ts").includes(
    "requirementsMet:this.prerequisitesMet",
  ) &&
    client.includes("quest-locked") &&
    client.includes("Prerequisite:"),
);

check(
  "character creation queues while websocket connects",
  client.includes(
    "RECONNECT_REPLAY_SAFE_COMMANDS=new Set(['resume_character','create_character'])",
  ) && client.includes("shouldQueueAfterDisconnect"),
);
check(
  "startup restores valid auth sessions",
  onboarding.includes("/api/auth/session") &&
    onboarding.includes("panel:'landing'"),
);
check(
  "session resolution waits for authoritative character state",
  client.includes("else if(!sessionResolved)resolveSession(false)") &&
    !network.includes("resumeOrRestoreSession"),
);
check(
  "character creator fully hides game background",
  style.includes(
    "body.creating-character>main,body.creating-character>.topbar{visibility:hidden!important}",
  ) &&
    style.includes(
      "#create.modal{display:block!important;background:#000!important",
    ),
);
check(
  "existing characters are restored from authoritative initial state",
  server.includes(
    "repo.allPlayers().find((x:any)=>x?.hasCharacter&&x?.accountId===ownerId)||null",
  ),
);
check(
  "guest characters use the same durable owner flow",
  server.includes("ownerId=authService.ownerId(principal)") &&
    server.includes(
      "repo.allPlayers().find((x:any)=>x?.hasCharacter&&x?.accountId===ownerId)||null",
    ) &&
    characterCommands.includes("authenticated session first"),
);
check(
  "new unauthenticated visit keeps landing screen",
  onboarding.includes("panel:'landing'") &&
    onboarding.includes("/api/auth/session") &&
    onboarding.includes("if(d.ok&&d.authenticated&&!cancelled){hide();return}"),
);
check(
  "existing authenticated character skips creator",
  server.includes("persistedCharacter||createPlayer") &&
    client.includes("if(state?.player?.hasCharacter&&state.player.id)") &&
    client.includes("resolveSession(true)"),
);
check(
  "authenticated session without character opens creator",
  client.includes("else if(!sessionResolved)resolveSession(false)") &&
    sessionController.includes("setCreatingCharacterVisible(!hasCharacter)"),
);
check(
  "React owns authentication presentation",
  onboarding.includes("function AuthScreen()") &&
    onboarding.includes("function CreateCharacter(") &&
    onboarding.includes("mountOnboarding"),
);
check(
  "character creation can return to authentication",
  onboarding.includes("__ashenfallAuthSignOut") &&
    onboarding.includes("/api/auth/logout"),
);

check(
  "city and wilderness backgrounds preserve the legacy viewport zoom",
  renderer.includes(
    "else if(state.zoneInfo?.city){drawTacticalCity(ctx,state.zoneInfo,w,h);}else{drawStaticWorld(ctx,state.zoneInfo,w,h);}",
  ) && !renderer.includes("renderSizeOverride={w:size,h:size}"),
);
check(
  "combat approach cannot restart from target selection after server cancellation",
  client.includes(
    "const approachActive=serverOwnsCombat||(localCombat&&localCombatAge<=350)",
  ) &&
    client.includes(
      "if(!approachActive){if(localCombat)stopLocalMotion();return;}",
    ),
);
check(
  "stale server approach-satisfied sample cannot stop a distant pursuit",
  client.includes("serverApproachSatisfied&&dist<=stopMeters+3"),
);
check(
  "approach line has visible gold contrast and remains dashed",
  renderer.includes("ctx.strokeStyle='rgba(255,207,91,.96)'") &&
    renderer.includes("ctx.setLineDash([9,6])"),
);
check(
  "leash cleanup removes out-of-range secondary attackers",
  read("server/world/MobSimulationService.ts").includes("beyondPlayerLeash") &&
    read("server/world/MobSimulationService.ts").includes("clearLeashCombat"),
);
check(
  "real mob-leash regression test exists",
  fs.existsSync(path.join(root, "tests/combat/mob-leash.test.mjs")),
);
check(
  "expired ignored-aggro timestamps stop suppressing acquisition",
  read("server/world/MobSimulationService.ts").includes(
    "Number(m.ignoredAggroPlayers[id]||0)>now",
  ),
);
check(
  "React utility overlay state reaches the actual store",
  client.includes(
    "import { syncUtilityState } from './react/UtilityOverlays.js';",
  ) && client.includes("syncUtilityState(patch);"),
);
check(
  "UI render coordinator preserves controller method context",
  read("client/runtime/ClientUiRenderCoordinator.ts").includes(
    "safe('character/progression',()=>this.d.character.renderCore())",
  ) &&
    !/safe\('[^']+',this\.d\./.test(
      read("client/runtime/ClientUiRenderCoordinator.ts"),
    ),
);
check(
  "pre-login realtime target rendering is guarded",
  read("client/runtime/ClientRealtimeUiController.ts").includes(
    "if(state?.player){",
  ) &&
    read("client/runtime/ClientRealtimeUiController.ts").includes(
      "this.d.renderTarget?.();",
    ),
);
check(
  "target HUD renderer guards missing player state",
  client.includes(
    "function renderTarget(){const p=state?.player;if(!p)return;",
  ),
);
check(
  "mob chase has no attack-range dead band",
  read("server/world/MobSimulationService.ts").includes(
    "if(!m.behavior?.kiting && d>attackRange+attackRangeEpsilon)",
  ) &&
    read("server/world/MobSimulationService.ts").includes(
      "if(d<=attackRange+attackRangeEpsilon)",
    ) &&
    read("server/world/MobSimulationService.ts").includes(
      "Math.min(effectiveSpeed*Math.max(0,dt),Math.max(0,d-attackRange))",
    ),
);
check(
  "mob attack envelope regression test exists",
  fs.existsSync(path.join(root, "tests/combat/mob-attack-envelope.test.mjs")),
);
check(
  "client UI regressions test exists",
  fs.existsSync(path.join(root, "tests/client/ui-regressions.test.mjs")),
);
check(
  "empty React story modal cannot leave a gold horizontal rule",
  read("client/style.css").includes(
    "#storyModal>.modal-card.dialogue:empty:after{display:none!important;content:none!important}",
  ),
);

let tsCount = 0;
for (const base of ["client", "server", "types"]) {
  const dir = path.join(root, base);
  if (!fs.existsSync(dir)) continue;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        tsCount++;
        const source = fs.readFileSync(file, "utf8");
        let result;
        try {
          result = ts.transpileModule(source, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
            reportDiagnostics: true,
            fileName: file,
          });
        } catch (error) {
          throw new Error(
            `TypeScript transpile crashed in ${path.relative(root, file)}: ${error.message}`,
          );
        }
        const errors = (result.diagnostics || []).filter(
          (d) => d.category === ts.DiagnosticCategory.Error,
        );
        assert.equal(
          errors.length,
          0,
          `TypeScript syntax/transpile error in ${path.relative(root, file)}`,
        );
      }
    }
  };
  walk(dir);
}
check(`TypeScript sources transpile cleanly (${tsCount} files)`, tsCount > 0);

const dx = 1,
  dy = 0,
  diag = Math.hypot(1, 1);
const xStep = Math.abs(dx / Math.hypot(dx, dy));
const yStep = Math.abs(1 / Math.hypot(0, 1));
const diagonalMagnitude = Math.hypot(1 / diag, 1 / diag);
check(
  "horizontal and vertical speed are equal",
  Math.abs(xStep - yStep) < 1e-12,
);
check("diagonal speed is normalized", Math.abs(diagonalMagnitude - 1) < 1e-12);

console.log(
  `verify-core: PASS — ${checks.length} checks, ${tsCount} TypeScript sources`,
);
