import crypto from "node:crypto";

const STATE_ID = "guild-organizations-v1";
const MAX_PROJECTS = 120;
const MAX_PROJECTS_PER_GUILD = 3;
const MAX_INFLUENCE = 100;
const PROJECTS = {
  route_protection: {
    name: "Protect a Trade Route",
    cost: 750,
    work: 100,
    kind: "route_protection",
    influence: 8,
    duration: 6 * 60 * 60 * 1000,
  },
  regional_relief: {
    name: "Regional Relief",
    cost: 500,
    work: 80,
    kind: "regional_relief",
    influence: 6,
    duration: 4 * 60 * 60 * 1000,
  },
  frontier_outpost: {
    name: "Frontier Outpost",
    cost: 1500,
    work: 180,
    kind: "frontier_outpost",
    influence: 15,
    duration: 12 * 60 * 60 * 1000,
  },
  trade_contract: {
    name: "Trade Contract",
    cost: 1000,
    work: 120,
    kind: "trade_contract",
    influence: 10,
    duration: 8 * 60 * 60 * 1000,
  },
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export class GuildOrganizations {
  repo: any;
  worldSimulation: any;
  social: any;
  state: any;
  dirty = false;
  lastPersist = 0;
  constructor(repo, worldSimulation, social) {
    this.repo = repo;
    this.worldSimulation = worldSimulation;
    this.social = social;
    this.state = this.normalize(repo?.loadWorldState?.(STATE_ID));
  }
  normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      schemaVersion: 1,
      guilds: r.guilds && typeof r.guilds === "object" ? r.guilds : {},
      projects: Array.isArray(r.projects)
        ? r.projects.slice(-MAX_PROJECTS)
        : [],
      updatedAt: Number(r.updatedAt || 0),
    };
  }
  guildState(guildId) {
    const id = String(guildId || "");
    if (!id) return null;
    if (!this.state.guilds[id])
      this.state.guilds[id] = {
        guildId: id,
        influence: {},
        completedProjects: 0,
        contribution: 0,
        lastProjectAt: 0,
      };
    return this.state.guilds[id];
  }
  snapshotForGuild(guildId) {
    const g = this.social?.guilds?.get?.(String(guildId));
    if (!g) return null;
    const s = this.guildState(g.id);
    return {
      guildId: g.id,
      influence: { ...(s?.influence || {}) },
      completedProjects: Number(s?.completedProjects || 0),
      contribution: Number(s?.contribution || 0),
      activeProjects: this.state.projects
        .filter((p) => p.guildId === g.id && p.state === "active")
        .map((p) => ({ ...p })),
      availableProjects: Object.entries(PROJECTS).map(([id, p]) => ({
        id,
        ...p,
      })),
    };
  }
  snapshotForRegion(regionId) {
    return [...(this.social?.guilds?.values?.() || [])]
      .map((g) => {
        const s = this.guildState(g.id);
        return {
          id: g.id,
          name: g.name,
          influence: Number(s?.influence?.[regionId] || 0),
          completedProjects: Number(s?.completedProjects || 0),
          activeProjects: this.state.projects.filter(
            (p) =>
              p.guildId === g.id &&
              p.regionId === regionId &&
              p.state === "active",
          ).length,
        };
      })
      .filter((x) => x.influence > 0 || x.activeProjects > 0)
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 20);
  }
  canManage(p) {
    const g = this.social?.guilds?.get?.(p?.guildId);
    return g && (g.leader === p.id || p.guildRank === "officer") ? g : null;
  }
  startProject(p, type, regionId) {
    const g = this.canManage(p);
    const spec = PROJECTS[String(type || "")];
    const region = String(regionId || p?.zone || "");
    if (!g || !spec)
      return [
        false,
        "Only a guild leader or officer can start a valid world project.",
      ];
    if (!region) return [false, "A region is required."];
    const worldRegions = this.worldSimulation?.snapshot?.().regions || null;
    if (worldRegions && !worldRegions[region])
      return [false, "That region does not exist."];
    const active = this.state.projects.filter(
      (x) => x.guildId === g.id && x.state === "active",
    );
    if (active.length >= MAX_PROJECTS_PER_GUILD)
      return [
        false,
        "Your guild already has the maximum number of active world projects.",
      ];
    if (this.state.projects.length >= MAX_PROJECTS)
      return [false, "The world project registry is temporarily full."];
    if (Number(p.gold || 0) < spec.cost)
      return [
        false,
        `Your guild needs ${spec.cost} gold to start this project.`,
      ];
    if (active.some((x) => x.type === type && x.regionId === region))
      return [
        false,
        "Your guild already has this project active in that region.",
      ];
    p.gold -= spec.cost;
    const now = Date.now();
    const project = {
      id: `gproj_${crypto.randomBytes(8).toString("hex")}`,
      guildId: g.id,
      guildName: g.name,
      type: String(type),
      regionId: region,
      work: 0,
      requiredWork: spec.work,
      state: "active",
      startedAt: now,
      expiresAt: now + spec.duration,
      createdBy: p.id,
    };
    this.state.projects.push(project);
    const s = this.guildState(g.id);
    s.lastProjectAt = now;
    s.contribution += spec.cost;
    this.dirty = true;
    this.persist();
    return [
      true,
      `${spec.name} started in ${region}.`,
      { project: { ...project } },
    ];
  }
  contribute(p, projectId, amount) {
    const g = this.social?.guilds?.get?.(p?.guildId);
    const project = this.state.projects.find(
      (x) => x.id === String(projectId) && x.state === "active",
    );
    if (!g || !project || project.guildId !== g.id)
      return [false, "World project not found."];
    const n = clamp(Math.floor(Number(amount) || 0), 1, 1000);
    if (Number(p.gold || 0) < n)
      return [false, "You do not have enough gold for that contribution."];
    if (project.work >= project.requiredWork)
      return [false, "That project is already complete."];
    p.gold -= n;
    project.work = clamp(project.work + n, 0, project.requiredWork);
    this.guildState(g.id).contribution += n;
    this.dirty = true;
    let completed = false;
    if (project.work >= project.requiredWork) {
      completed = this.complete(project);
    }
    this.persist();
    return [
      true,
      completed
        ? `Project completed: ${PROJECTS[project.type]?.name || project.type}.`
        : `Contributed ${n} gold.`,
      { project: { ...project }, completed },
    ];
  }
  complete(project) {
    project.state = "completed";
    project.completedAt = Date.now();
    const spec = PROJECTS[project.type] || {};
    const s = this.guildState(project.guildId);
    s.completedProjects = Number(s.completedProjects || 0) + 1;
    s.influence[project.regionId] = clamp(
      Number(s.influence[project.regionId] || 0) + Number(spec.influence || 0),
      0,
      MAX_INFLUENCE,
    );
    const eventId = `guild-project:${project.id}`;
    this.worldSimulation?.record?.({
      id: eventId,
      type: "guild_project_completed",
      source: "guild_organization",
      actorId: null,
      regionId: project.regionId,
      simulationTick: Number(
        this.worldSimulation?.snapshot?.().simulationTick || 0,
      ),
      worldTime: Date.now(),
      payload: {
        guildId: project.guildId,
        guildName: project.guildName,
        projectId: project.id,
        projectKind: project.type,
        influenceDelta: Number(spec.influence || 0),
        economyDelta: project.type === "trade_contract" ? 5 : 0,
        dangerDelta:
          project.type === "route_protection"
            ? -4
            : project.type === "regional_relief"
              ? -3
              : 0,
      },
      causes: [],
      consequenceIds: [],
      severity: "regional",
    });
    this.dirty = true;
    return true;
  }
  tick(simulationTick, now) {
    let changed = false;
    for (const p of this.state.projects) {
      if (p.state !== "active") continue;
      if (now > Number(p.expiresAt || 0)) {
        p.state = "expired";
        p.expiredAt = now;
        changed = true;
        continue;
      }
    }
    if (changed) {
      this.dirty = true;
      this.persist(false, now);
    }
    return changed;
  }
  ingestEvent(event) {
    if (!event?.regionId) return;
    const actor = event.actorId
      ? this.social?._playerLookup?.(event.actorId)
      : null;
    if (!actor?.guildId) return;
    const g = this.social.guilds.get(actor.guildId);
    if (!g) return;
    const s = this.guildState(g.id);
    const importance =
      event.severity === "historical"
        ? 2
        : event.severity === "regional"
          ? 1
          : 0.25;
    s.contribution = Number(s.contribution || 0) + importance;
    this.dirty = true;
  }
  metrics() {
    return {
      guilds: Object.keys(this.state.guilds).length,
      projects: this.state.projects.length,
      activeProjects: this.state.projects.filter((p) => p.state === "active")
        .length,
    };
  }
  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastPersist < 1000) return;
    this.state.updatedAt = now;
    this.repo?.saveWorldState?.(this.state, STATE_ID);
    this.lastPersist = now;
    this.dirty = false;
  }
  checkpoint(now = Date.now()) {
    this.persist(true, now);
  }
}
export { PROJECTS };
