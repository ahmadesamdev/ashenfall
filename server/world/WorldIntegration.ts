import crypto from "node:crypto";

const STATE_ID = "world-integration-v1";
const MAX_OPPORTUNITIES = 240;
const MAX_KNOWLEDGE = 24;
const MAX_RELATIONS = 240;
const MAX_CONTRACTS_PER_PLAYER = 3;
const MAX_PLAYER_CONTRACTS = 12;
const MAX_CHAIN_DEPTH = 4;
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const finite = (value: any, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export class WorldIntegration {
  repo: any;
  world: any;
  simulation: any;
  factions: any;
  ecology: any;
  emergent: any;
  discoveries: any;
  economy: any;
  guilds: any;
  chronicle: any;
  npcMemory: any;
  quest: any;
  playerMutations: any;
  state: any;
  dirty = false;
  lastLedgerIndex = 0;
  constructor(repo: any, deps: any = {}) {
    this.repo = repo;
    Object.assign(this, deps);
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = {
      schemaVersion: 3,
      opportunities: Array.isArray(raw?.opportunities)
        ? raw.opportunities.slice(-MAX_OPPORTUNITIES)
        : [],
      playerKnowledge: { ...(raw?.playerKnowledge || {}) },
      caravanRelations: { ...(raw?.caravanRelations || {}) },
      playerContracts: { ...(raw?.playerContracts || {}) },
      processedEventIds: Array.isArray(raw?.processedEventIds)
        ? raw.processedEventIds.slice(-10000).map(String)
        : [],
      consequenceAppliedIds: Array.isArray(raw?.consequenceAppliedIds)
        ? raw.consequenceAppliedIds.slice(-10000).map(String)
        : [],
      lastTick: Math.max(0, finite(raw?.lastTick, 0)),
    };
  }
  metrics() {
    return {
      opportunities: this.state.opportunities.length,
      players: Object.keys(this.state.playerKnowledge).length,
      caravanRelations: Object.keys(this.state.caravanRelations).length,
      activeContracts: Object.values(this.state.playerContracts || {}).reduce(
        (n: any, a: any) =>
          n +
          (Array.isArray(a)
            ? a.filter((x: any) => x.status === "active").length
            : 0),
        0,
      ),
      lastTick: this.state.lastTick,
    };
  }
  snapshotForPlayer(playerId: string, regionId: string) {
    const knowledge = (
      this.state.playerKnowledge[String(playerId)] || []
    ).slice(-MAX_KNOWLEDGE);
    const opportunities = this.state.opportunities
      .filter(
        (x) =>
          x.regionId === String(regionId) &&
          (!x.expiresTick || x.expiresTick >= this.state.lastTick) &&
          (!x.eligiblePlayerId ||
            String(x.eligiblePlayerId) === String(playerId)),
      )
      .slice(-24);
    const contractHistory = (
      this.state.playerContracts?.[String(playerId)] || []
    ).slice(-MAX_PLAYER_CONTRACTS);
    const contracts = contractHistory
      .filter((x: any) => x.status === "active")
      .slice(-MAX_CONTRACTS_PER_PLAYER);
    return {
      opportunities,
      knowledge,
      contracts,
      contractHistory,
      regionId: String(regionId),
      lastTick: this.state.lastTick,
    };
  }
  snapshotForRegion(regionId: string) {
    return {
      regionId: String(regionId),
      opportunities: this.state.opportunities
        .filter((x) => x.regionId === String(regionId))
        .slice(-24),
    };
  }
  applyEventConsequences(e: any) {
    const eventId = String(e?.id || "");
    if (!eventId) return false;
    const p = e.payload || {};
    if (e.type !== "world_contract_outcome") return false;
    const applied = new Set(this.state.consequenceAppliedIds || []);
    if (applied.has(eventId)) return false;
    const region = String(e.regionId || p.regionId || "");
    const tick = Number(e.simulationTick || this.state.lastTick || 0);
    let changed = false;
    let ready = true;
    if (!region) ready = true;
    if (p.kind === "trade_contract") {
      if (!this.economy) {
        ready = false;
      } else {
        if (p.caravanId)
          this.economy.resolveWorldContractCaravan?.(
            String(p.caravanId),
            String(p.outcome || ""),
            tick,
          );
        const ok = this.economy.applyWorldContractOutcome?.(
          region,
          String(p.resource || ""),
          Number(p.amount || 10),
          String(p.outcome || ""),
          tick,
          p.caravanId || null,
        );
        ready = ok !== false;
        changed = Boolean(ok) || changed;
      }
    }
    if (p.kind === "ecology_contract") {
      if (!this.ecology) {
        ready = false;
      } else {
        const ok = this.ecology.applyWorldContractOutcome?.(
          region,
          String(p.outcome || ""),
          tick,
        );
        ready = ok !== false;
        changed = Boolean(ok) || changed;
      }
    }
    if (
      !region &&
      (p.kind === "trade_contract" || p.kind === "ecology_contract")
    )
      ready = false;
    for (const pid of Array.isArray(p.participantIds) ? p.participantIds : []) {
      const player = this.repo?.getPlayer?.(String(pid));
      if (player && this.quest?.onWorldEventConsequence) {
        this.quest.onWorldEventConsequence(
          player,
          eventId,
          String(p.outcome || ""),
          1,
        );
        this.repo?.savePlayer?.(player);
        changed = true;
      }
    }
    if (ready) {
      applied.add(eventId);
      this.state.consequenceAppliedIds = [...applied].slice(-10000);
      if (changed) this.dirty = true;
    }
    return changed;
  }

  _addOpportunity(x: any) {
    const id = x.id || `op:${hash(JSON.stringify(x)).slice(0, 20)}`;
    if (this.state.opportunities.some((o) => o.id === id)) return false;
    this.state.opportunities.push({ ...x, id });
    if (this.state.opportunities.length > MAX_OPPORTUNITIES)
      this.state.opportunities.splice(
        0,
        this.state.opportunities.length - MAX_OPPORTUNITIES,
      );
    this.dirty = true;
    return true;
  }
  ingestEvents(events: any[] = [], tick: number) {
    tick = Math.max(0, finite(tick, this.state.lastTick));
    const processed = new Set(this.state.processedEventIds || []);
    let changed = false;
    for (const e of events || []) {
      const eventId = String(e?.id || "");
      if (!eventId || processed.has(eventId)) continue;
      if (
        e.type === "world_contract_outcome" &&
        this.playerMutations?.isLocked &&
        (Array.isArray(e.payload?.participantIds)
          ? e.payload.participantIds
          : []
        ).some((id: any) => this.playerMutations.isLocked(String(id)))
      )
        continue;
      const p = e.payload || {};
      const region = String(e.regionId || p.regionId || "");
      this.applyEventConsequences(e);
      processed.add(eventId);
      changed = true;
      if (!region) continue;
      if (e.type === "emergent_world_event")
        this._addOpportunity({
          id: `emergent:${e.id}`,
          kind: "world_event",
          regionId: region,
          title: p.title || "A changing situation",
          description:
            p.description || "The region has entered a new situation.",
          sourceEventId: e.id,
          severity: e.severity || "regional",
          createdTick: tick,
          expiresTick: tick + 2400,
        });
      if (e.type === "discovery_found" || e.type === "region_discovery_found") {
        const discoveryId = String(p.discoveryId || "");
        const discovery = discoveryId
          ? this.discoveries?.discoveries?.get?.(discoveryId)
          : null;
        this._addOpportunity({
          id: `discovery:${e.id}`,
          kind: "discovery",
          regionId: region,
          title:
            p.discoveryName || discovery?.name || "Newly uncovered knowledge",
          description:
            discovery?.description ||
            "A discovery has changed what is known about this region.",
          targetName: discovery?.name || p.discoveryName || "Discovery site",
          targetX: Number.isFinite(Number(discovery?.x))
            ? Number(discovery.x)
            : null,
          targetY: Number.isFinite(Number(discovery?.y))
            ? Number(discovery.y)
            : null,
          sourceEventId: e.id,
          discoveryId: discoveryId || null,
          severity: e.severity || "local",
          createdTick: tick,
          expiresTick: tick + 3600,
        });
      }
      if (
        e.type === "faction_operation" ||
        e.type === "guild_project_completed"
      )
        this._addOpportunity({
          id: `faction:${e.id}`,
          kind:
            e.type === "guild_project_completed"
              ? "guild_project"
              : "faction_contract",
          regionId: region,
          title:
            e.type === "guild_project_completed"
              ? "A regional project needs help"
              : "Faction activity requires attention",
          description:
            e.type === "guild_project_completed"
              ? "A player organization has changed the region and opened a new opportunity."
              : "A faction operation is influencing the region.",
          sourceEventId: e.id,
          severity: "regional",
          createdTick: tick,
          expiresTick: tick + 1800,
        });
      if (
        e.type === "economic_transition" &&
        ["caravan_lost", "caravan_departed"].includes(String(p.economyEvent))
      )
        this._addOpportunity({
          id: `trade:${e.id}`,
          kind: "trade_contract",
          regionId: region,
          title:
            p.economyEvent === "caravan_lost"
              ? "Trade route disrupted"
              : "Caravan route active",
          description: "Regional trade conditions have changed.",
          sourceEventId: e.id,
          severity: "regional",
          createdTick: tick,
          expiresTick: tick + 1800,
        });
      if (
        e.type === "ecology_transition" &&
        ["migration", "collapse", "recovery"].includes(String(p.ecologyChange))
      )
        this._addOpportunity({
          id: `ecology:${e.id}`,
          kind: "ecology_contract",
          regionId: region,
          title: "The wilds are changing",
          description: `Ecological ${p.ecologyChange} has altered the region.`,
          sourceEventId: e.id,
          severity: e.severity || "local",
          createdTick: tick,
          expiresTick: tick + 1800,
        });
      if (
        e.type === "world_contract_outcome" &&
        p.contractId &&
        p.chainId &&
        Number(p.chainStep || 1) < MAX_CHAIN_DEPTH
      ) {
        const success = String(p.outcome) === "success";
        const nextStep = Number(p.chainStep || 1) + 1;
        const kind = String(p.kind || "world_event");
        const followUp = success
          ? {
              title:
                kind === "trade_contract"
                  ? "The Route Opens Again"
                  : kind === "faction_contract"
                    ? "The Faction Calls Again"
                    : kind === "ecology_contract"
                      ? "The Wilds Begin to Recover"
                      : "The Situation Has Shifted",
              description:
                "Your intervention changed what happens next. A new situation has emerged from the outcome.",
              label: "Continue the developing situation.",
            }
          : {
              title:
                kind === "trade_contract"
                  ? "The Broken Route"
                  : kind === "faction_contract"
                    ? "A Faction Under Pressure"
                    : kind === "ecology_contract"
                      ? "The Wilds Are Worsening"
                      : "The Consequences Spread",
              description:
                "The outcome was not resolved. The consequences have created a new problem in the region.",
              label: "Confront the consequences.",
            };
        const participants = [
          ...new Set(
            (Array.isArray(p.participantIds) ? p.participantIds : [])
              .map(String)
              .filter(Boolean),
          ),
        ];
        if (!participants.length && e.actorId)
          participants.push(String(e.actorId));
        for (const pid of participants) {
          this._addOpportunity({
            id: `chain:${p.contractId}:${p.outcome}:${nextStep}:${pid}`,
            kind,
            regionId: region,
            title: followUp.title,
            description: followUp.description,
            label: followUp.label,
            sourceEventId: e.id,
            parentContractId: String(p.contractId),
            eligiblePlayerId: pid,
            chainId: String(p.chainId),
            chainStep: nextStep,
            branch: success ? "success" : "failure",
            severity: "regional",
            createdTick: tick,
            expiresTick: tick + 2400,
          });
        }
      }
    }
    const nextOpportunities = this.state.opportunities.filter(
      (o) => !o.expiresTick || o.expiresTick >= tick,
    );
    if (nextOpportunities.length !== this.state.opportunities.length)
      changed = true;
    this.state.processedEventIds = [...processed].slice(-10000);
    this.state.opportunities = nextOpportunities;
    if (changed) this.dirty = true;
  }

  acceptOpportunity(player: any, opportunityId: string, tick: number) {
    const id = String(player?.id || ""),
      oid = String(opportunityId || ""),
      safeTick = Math.max(0, finite(tick, this.state.lastTick));
    if (!id || !oid) return [false, "Invalid world opportunity."];
    const opp = this.state.opportunities.find(
      (x: any) =>
        String(x.id) === oid &&
        String(x.regionId) === String(player.zone) &&
        (!x.expiresTick || Number(x.expiresTick) >= safeTick),
    );
    if (!opp) return [false, "That opportunity is no longer active here."];
    const list = Array.isArray(this.state.playerContracts?.[id])
      ? this.state.playerContracts[id]
      : [];
    const active = list.filter((x: any) => x.status === "active");
    if (active.length >= MAX_CONTRACTS_PER_PLAYER)
      return [false, "You already have three active world contracts."];
    if (
      list.some((x: any) => x.opportunityId === oid && x.status !== "expired")
    )
      return [false, "You already accepted this opportunity."];
    const questTemplates: any = {
      world_event: {
        action: "respond",
        label: "Respond to the situation",
        objectives: [
          "Reach the affected area and assess the situation.",
          "Resolve the immediate threat.",
          "Report the outcome to the world.",
        ],
      },
      faction_contract: {
        action: "support",
        label: "Support the faction operation",
        objectives: [
          "Reach the operation area.",
          "Support the faction objective.",
          "Secure the operation outcome.",
        ],
      },
      trade_contract: {
        action: "escort",
        label: "Escort a trade route",
        objectives: [
          "Locate an active caravan.",
          "Escort the caravan through the danger.",
          "Deliver the caravan safely.",
        ],
      },
      ecology_contract: {
        action: "investigate",
        label: "Investigate the ecological change",
        objectives: [
          "Reach the affected wilderness.",
          "Investigate the ecological signs.",
          "Record what changed in the region.",
        ],
      },
      discovery: {
        action: "investigate",
        label: "Investigate what was uncovered",
        objectives: [
          "Travel to the discovery site.",
          "Investigate the newly uncovered evidence.",
          "Preserve the discovery as regional knowledge.",
        ],
      },
      guild_project: {
        action: "assist",
        label: "Assist the regional project",
        objectives: [
          "Reach the project site.",
          "Contribute meaningful work to the project.",
          "Secure the project's regional outcome.",
        ],
      },
    };
    const template = questTemplates[opp.kind] || questTemplates.world_event;
    const contract = {
      id: `wc:${hash(`${id}:${oid}:${tick}`).slice(0, 24)}`,
      opportunityId: oid,
      kind: String(opp.kind || "world_event"),
      regionId: String(opp.regionId),
      title: String(opp.title || "World Contract"),
      description: String(
        opp.description || "Respond to a changing situation.",
      ),
      sourceEventId: opp.sourceEventId || null,
      discoveryId: opp.discoveryId || null,
      targetName: opp.targetName || null,
      targetX: Number.isFinite(Number(opp.targetX))
        ? Number(opp.targetX)
        : null,
      targetY: Number.isFinite(Number(opp.targetY))
        ? Number(opp.targetY)
        : null,
      targetZoneId: String(opp.targetZoneId || opp.regionId),
      action: template.action,
      label: template.label,
      objectives: template.objectives.slice(0, 3),
      objectiveIndex: 0,
      status: "active",
      acceptedTick: safeTick,
      expiresTick: Math.max(
        safeTick + 600,
        Number(opp.expiresTick || safeTick + 3600),
      ),
      progress: 0,
      chainId: String(opp.chainId || `chain:${oid}`),
      chainStep: Math.max(1, Number(opp.chainStep || 1)),
      parentContractId: opp.parentContractId || null,
      branch: opp.branch || null,
      participantIds: [id],
    };
    this.state.playerContracts[id] = [
      ...list.filter(
        (x: any) =>
          x.status === "active" ||
          Number(x.acceptedTick || 0) > safeTick - 36000,
      ),
      contract,
    ].slice(-MAX_PLAYER_CONTRACTS);
    this.dirty = true;
    return [true, `World contract accepted: ${contract.title}.`, { contract }];
  }
  actionOpportunity(
    player: any,
    contractId: string,
    tick: number,
    requestedOutcome: string = "",
  ) {
    const id = String(player?.id || ""),
      cid = String(contractId || ""),
      outcome = String(requestedOutcome || "").toLowerCase(),
      safeTick = Math.max(0, finite(tick, this.state.lastTick));
    const list = this.state.playerContracts?.[id] || [];
    const contract = list.find(
      (x: any) => String(x.id) === cid && x.status === "active",
    );
    if (!contract) return [false, "Active world contract not found."];
    if (String(contract.regionId) !== String(player.zone))
      return [false, "Return to the contract region first."];
    if (Number(contract.expiresTick || 0) < safeTick) {
      contract.status = "expired";
      this.dirty = true;
      return [false, "That world contract has expired."];
    }

    const finalStep = Math.max(0, Number(contract.objectives?.length || 3) - 1);
    if (
      contract.kind === "discovery" &&
      Number(contract.objectiveIndex || 0) < finalStep
    ) {
      const discoveryId = String(contract.discoveryId || "");
      const discovery = discoveryId
        ? this.discoveries?.discoveries?.get?.(discoveryId)
        : null;
      const tx = Number.isFinite(Number(contract.targetX))
        ? Number(contract.targetX)
        : Number(discovery?.x);
      const ty = Number.isFinite(Number(contract.targetY))
        ? Number(contract.targetY)
        : Number(discovery?.y);
      if (
        Number.isFinite(tx) &&
        Number.isFinite(ty) &&
        String(player.zone) ===
          String(contract.targetZoneId || contract.regionId)
      ) {
        const near = this.world?.normalizedMeters?.(player.zone, 18) || 0.02;
        if (Math.hypot(Number(player.x) - tx, Number(player.y) - ty) <= near) {
          contract.objectiveIndex = Math.min(
            finalStep,
            Number(contract.objectiveIndex || 0) + 1,
          );
          contract.progress = contract.objectiveIndex;
          this.dirty = true;
          if (contract.objectiveIndex < finalStep)
            return [
              true,
              contract.objectives[contract.objectiveIndex] ||
                "Continue the investigation.",
              { contract, advanced: true },
            ];
        }
      }
    }

    let step = Math.max(0, Number(contract.objectiveIndex || 0));
    if (contract.kind === "discovery" && step < finalStep) {
      const discoveryId = String(contract.discoveryId || "");
      const discovery = discoveryId
        ? this.discoveries?.discoveries?.get?.(discoveryId)
        : null;
      const tx = Number.isFinite(Number(contract.targetX))
        ? Number(contract.targetX)
        : Number(discovery?.x);
      const ty = Number.isFinite(Number(contract.targetY))
        ? Number(contract.targetY)
        : Number(discovery?.y);
      if (Number.isFinite(tx) && Number.isFinite(ty)) {
        contract.targetX = tx;
        contract.targetY = ty;
        contract.targetName =
          contract.targetName || discovery?.name || "Discovery site";
        const near = this.world?.normalizedMeters?.(player.zone, 18) || 0.02;
        if (Math.hypot(Number(player.x) - tx, Number(player.y) - ty) > near)
          return [
            false,
            `Travel to ${contract.targetName} to continue the investigation.`,
            {
              contract,
              targetX: tx,
              targetY: ty,
              targetZoneId: contract.targetZoneId || contract.regionId,
            },
          ];
      }
    }
    if (step === finalStep && !["success", "failure"].includes(outcome)) {
      const choices =
        contract.kind === "trade_contract"
          ? [
              {
                id: "success",
                label: "Protect the caravan",
                description: "Take the risk and keep the shipment moving.",
              },
              {
                id: "failure",
                label: "Withdraw",
                description: "Abandon the escort and accept the regional loss.",
              },
            ]
          : [
              {
                id: "success",
                label: "Resolve the situation",
                description:
                  "Commit to the intervention and improve the region.",
              },
              {
                id: "failure",
                label: "Withdraw",
                description:
                  "Leave the situation unresolved and accept its consequences.",
              },
            ];
      return [
        true,
        "Choose how the situation ends.",
        { contract, requiresChoice: true, choices },
      ];
    }
    if (step === finalStep && !["success", "failure"].includes(outcome))
      return [false, "Choose an outcome."];

    const effects: any = {
      respond: {
        success: { dangerDelta: -5, corruptionDelta: -2 },
        failure: { dangerDelta: 7, corruptionDelta: 3 },
      },
      support: {
        success: { dangerDelta: -4, factionPressureDelta: -5 },
        failure: { dangerDelta: 6, factionPressureDelta: 6 },
      },
      escort: { success: { dangerDelta: -3 }, failure: { dangerDelta: 8 } },
      investigate: {
        success: { dangerDelta: -2, corruptionDelta: -1 },
        failure: { dangerDelta: 5, corruptionDelta: 2 },
      },
      assist: { success: { dangerDelta: -3 }, failure: { dangerDelta: 5 } },
    };
    const base = effects[contract.action] || effects.respond;
    const effect = base[outcome] || base.success;
    if (contract.action === "escort") {
      const caravan = (this.economy?.state?.caravans || []).find(
        (c: any) =>
          c.state === "traveling" &&
          (c.from === String(player.zone) || c.to === String(player.zone)),
      );
      if (!caravan)
        return [false, "No active caravan is close enough to escort."];
      contract.caravanId = caravan.id;
      contract.caravanResource = String(caravan.resource || "");
      contract.caravanAmount = Number(caravan.amount || 0);
    }
    contract.participantIds = [
      ...new Set([...(contract.participantIds || []).map(String), id]),
    ].slice(0, 16);
    const eventId = `world-contract:${contract.id}:step:${step}:${outcome || "progress"}`;
    const finalOutcome = step === finalStep ? outcome : "progress";
    const eventPayload: any = {
      contractId: contract.id,
      opportunityId: contract.opportunityId,
      kind: contract.kind,
      action: contract.action,
      objectiveIndex: step,
      outcome: finalOutcome,
      participantIds: [
        ...new Set([...(contract.participantIds || []).map(String), id]),
      ],
      chainId: contract.chainId,
      chainStep: contract.chainStep,
      parentContractId: contract.parentContractId || null,
      branch: contract.branch || null,
      ...effect,
      caravanId: contract.caravanId || null,
      resource: contract.caravanResource || null,
      amount: Number(contract.caravanAmount || 0),
    };
    if (step === finalStep) {
      eventPayload.economicOutcome =
        contract.kind === "trade_contract"
          ? outcome === "success"
            ? "protected"
            : "lost"
          : null;
      eventPayload.factionOutcome =
        contract.kind === "faction_contract"
          ? outcome === "success"
            ? "supported"
            : "abandoned"
          : null;
      eventPayload.ecologyOutcome =
        contract.kind === "ecology_contract"
          ? outcome === "success"
            ? "stabilized"
            : "worsened"
          : null;
    }
    const recorded = this.simulation?.record?.({
      id: eventId,
      type:
        step === finalStep
          ? "world_contract_outcome"
          : "world_opportunity_action",
      source: "world_integration",
      actorId: id,
      regionId: String(player.zone),
      simulationTick: safeTick,
      worldTime: finite(this.state.lastTick, tick),
      payload: eventPayload,
      causes: contract.sourceEventId ? [String(contract.sourceEventId)] : [],
      consequenceIds: [],
      severity: outcome === "failure" ? "regional" : "local",
    });
    if (recorded === false)
      return [false, "That world objective was already completed."];
    if (step === finalStep)
      this.applyEventConsequences({
        id: eventId,
        type: "world_contract_outcome",
        regionId: String(player.zone),
        simulationTick: safeTick,
        actorId: id,
        payload: eventPayload,
      });

    contract.objectiveIndex = step + 1;
    contract.progress = Math.min(
      contract.objectives?.length || 3,
      contract.objectiveIndex,
    );
    if (step === finalStep) {
      contract.status = outcome === "failure" ? "failed" : "completed";
      contract.outcome = outcome;
      contract.completedTick = safeTick;
      contract.consequence = {
        outcome,
        regionId: String(contract.regionId),
        sourceEventId: contract.sourceEventId || null,
      };
      this.dirty = true;
      const xp =
        outcome === "success"
          ? Math.max(50, Number(player.level || 1) * 25)
          : Math.max(15, Number(player.level || 1) * 8);
      const gold =
        outcome === "success" ? Math.max(10, Number(player.level || 1) * 3) : 0;
      if (gold) player.gold = Number(player.gold || 0) + gold;
      return [
        true,
        outcome === "success"
          ? `${contract.title} succeeded. The region benefits from your intervention.`
          : `${contract.title} failed. The region will bear the consequences.`,
        { contract, xp, gold, complete: true, outcome, branch: outcome },
      ];
    }
    this.dirty = true;
    return [
      true,
      `${contract.title}: ${contract.objectives[contract.objectiveIndex] || "Continue the operation."}`,
      { contract, objectiveComplete: true, complete: false },
    ];
  }

  _recordOutcomeConsequences(
    contract: any,
    player: any,
    tick: number,
    outcome: string,
  ) {
    const region = String(contract.regionId);
    const payload: any = {
      contractId: contract.id,
      opportunityId: contract.opportunityId,
      kind: contract.kind,
      outcome,
      participantIds: [String(player.id)],
      dangerDelta: outcome === "success" ? -4 : 7,
      corruptionDelta: outcome === "success" ? -1 : 3,
      economicOutcome:
        contract.kind === "trade_contract"
          ? outcome === "success"
            ? "protected"
            : "lost"
          : null,
      factionOutcome:
        contract.kind === "faction_contract"
          ? outcome === "success"
            ? "supported"
            : "abandoned"
          : null,
      ecologyOutcome:
        contract.kind === "ecology_contract"
          ? outcome === "success"
            ? "stabilized"
            : "worsened"
          : null,
    };
    this.simulation?.record?.({
      id: `world-contract:${contract.id}:outcome:${outcome}`,
      type: "world_contract_outcome",
      source: "world_integration",
      actorId: String(player.id),
      regionId: region,
      simulationTick: Math.max(0, finite(tick, this.state.lastTick)),
      worldTime: finite(this.state.lastTick, tick),
      payload,
      causes: contract.sourceEventId ? [String(contract.sourceEventId)] : [],
      consequenceIds: [],
      severity: outcome === "failure" ? "regional" : "local",
    });
  }

  activeContracts(playerId: string, tick: number) {
    const safeTick = Math.max(0, finite(tick, this.state.lastTick));
    const list = this.state.playerContracts?.[String(playerId)] || [];
    let changed = false;
    for (const c of list) {
      if (c.status === "active" && Number(c.expiresTick || 0) < safeTick) {
        c.status = "expired";
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return list
      .filter((x: any) => x.status === "active")
      .slice(-MAX_CONTRACTS_PER_PLAYER);
  }

  observePlayerDiscovery(player: any, discovery: any, tick: number) {
    if (!player?.id || !discovery?.id) return;
    const id = String(player.id);
    const arr = this.state.playerKnowledge[id] || [];
    const key = String(discovery.id);
    if (!arr.includes(key)) {
      arr.push(key);
      this.state.playerKnowledge[id] = arr.slice(-MAX_KNOWLEDGE);
      this.dirty = true;
    }
  }
  assignCaravanFaction(caravan: any) {
    if (!caravan || caravan.ownerFactionId) return caravan;
    const source = this.factions?.snapshotForRegion?.(caravan.from) || [];
    const dest = this.factions?.snapshotForRegion?.(caravan.to) || [];
    const scores = new Map();
    for (const x of [...source, ...dest]) {
      const id = String(x.factionId || x.id || "");
      if (!id) continue;
      scores.set(id, (scores.get(id) || 0) + Number(x.influence || 0));
    }
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) caravan.ownerFactionId = best[0];
    return caravan;
  }
  observeCaravanOutcome(caravan: any, outcome: string, tick: number) {
    if (!caravan) return;
    this.assignCaravanFaction(caravan);
    if (!caravan.ownerFactionId) return;
    const key = `${caravan.ownerFactionId}:${caravan.from}:${caravan.to}`;
    const current = Number(this.state.caravanRelations[key] || 0);
    this.state.caravanRelations[key] = clamp(
      current + (outcome === "arrived" ? 1 : -2),
      -100,
      100,
    );
    this.dirty = true;
  }
  applyEcologyToWorld(world: any, activeZones: Set<string>) {
    for (const zone of activeZones || []) {
      const summary = this.ecology?.regionSummary?.(zone);
      if (!summary) continue;
      const pressure = Number(summary.disturbance || 0),
        recovery = Number(summary.recovery || 0);
      for (const m of world?.zoneMobs?.(zone) || []) {
        if (m.state === "dead") continue;
        const base = Number(m.baseAggroRangeMeters || m.aggroRangeMeters || 0);
        m.ecologyAggroMultiplier = clamp(
          1 + pressure * 0.002 - recovery * 0.0008,
          0.75,
          1.35,
        );
        m.aggroRangeMeters = base * m.ecologyAggroMultiplier;
        m.ecologyRecovery = recovery;
      }
    }
  }
  snapshotForNpc(npcId: string, regionId: string) {
    const faction = this.factions?.snapshotForRegion?.(regionId) || [];
    const memory = this.npcMemory?.metrics?.() || null;
    return {
      npcId: String(npcId),
      regionId: String(regionId),
      factions: faction.slice(0, 8),
      npcMemoryMetrics: memory,
      worldOpportunities:
        this.snapshotForRegion(regionId).opportunities.slice(-8),
    };
  }
  ingestNewLedger() {
    const ledger = this.simulation?.ledgerSnapshot?.(10000) || [];
    const processed = new Set(this.state.processedEventIds || []);
    const fresh = ledger.filter(
      (event: any) => event?.id && !processed.has(String(event.id)),
    );
    if (fresh.length)
      this.ingestEvents(fresh, Number(this.state.lastTick || 0));
    this.lastLedgerIndex = ledger.length;
    return fresh.length;
  }
  tick(world: any, tick: number) {
    tick = Math.max(this.state.lastTick, finite(tick, this.state.lastTick));
    this.state.lastTick = tick;
    this.ingestNewLedger();
    const activeZones: Set<string> = new Set(
      (world?.players || [])
        .filter((p: any) => p?.online && p?.hasCharacter && !p?.dead)
        .map((p: any) => String(p.zone || "")),
    );
    this.applyEcologyToWorld(world, activeZones);
    for (const c of this.economy?.state?.caravans || [])
      this.assignCaravanFaction(c);
    this.state.opportunities = this.state.opportunities.filter(
      (o) => !o.expiresTick || o.expiresTick >= tick,
    );
    for (const pid of Object.keys(this.state.playerContracts || {}))
      this.activeContracts(pid, tick);
    this.persist(false);
    return activeZones.size;
  }
  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
    this.repo?.saveWorldState?.(structuredClone(this.state), STATE_ID);
    this.dirty = false;
  }
  checkpoint(now = Date.now()) {
    this.persist(true, now);
  }
}
export const WORLD_INTEGRATION_ID = STATE_ID;
