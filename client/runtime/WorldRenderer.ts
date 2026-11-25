export function createWorldRenderer(deps: any) {
  const {
    $,
    getState,
    getUiSettings,
    camera,
    getZoomTarget,
    setZoomTarget,
    getFollowPlayer,
    getKeys,
    getLocalMotion,
    getLocalFx,
    tickLocalMotion,
    resetLocalMotion,
    motionPosition,
    now,
    getActiveQuestHelper,
    getQuestRouteVisible,
    hasMotionPosition,
    getTravelTransitionZone,
    getTravelTransitionStartedAt,
    getTravelTransitionMinMs,
    clearTravelTransition,
    setUiDirty,
    setLastMinimapSignature,
    getWorldMapMode,
    setWorldMapMode,
    getWorldMapZone,
    setWorldMapZone,
    CLASS_PORTRAITS,
    BOSS_VISUALS,
    BOSS_BY_ENEMY,
    WORLD_METERS,
    VIEWPORT_WORLD_METERS,
    MIN_ZOOM,
    MAX_ZOOM,
    MINIMAP_RANGE_METERS,
    MINIMAP_MIN_ZOOM,
    MINIMAP_MAX_ZOOM,
    emitAudioCue,
    renderPerf,
  } = deps;

  let state: any = null;
  let uiSettings: any = {};
  let staticRenderMode = false;
  let renderSizeOverride: any = null;
  let renderCameraAnchor = { x: 0.5, y: 0.5 };
  let WORLD_LAYOUT: any = {};
  let lastFrame = 0;
  let worldCanvasResizeObserver: any = null;
  let minimapZoom = 1;
  let lastMinimapDraw = 0;
  let lastMinimapSignature = "";
  const terrainCache = new Map(),
    miniTerrainCache = new Map();
  const staticWorldCache: any = {
    canvas: null,
    ctx: null,
    zone: "",
    valid: false,
    size: 2048,
  };
  const worldRenderCache: any = {
    mobAt: 0,
    mobKey: "",
    mobs: [],
    playersAt: 0,
    playersKey: "",
    players: [],
    mobByIdSource: null,
    mobById: new Map(),
    playerByIdSource: null,
    playerById: new Map(),
  };
  const visualAssets: any = {
    playerPortraits: {},
    world: {},
    worldSprites: {},
    bosses: {},
  };
  const spriteFacing = new Map<string, number>();
  const SPRITE_CLASSES = new Set([
    "vanguard",
    "arcanist",
    "warden",
    "shadowblade",
    "ranger",
    "templar",
    "occultist",
    "reaver",
    "hierophant",
  ]);
  const SPRITE_BASE_DIRECTION: any = {
    vanguard: -1,
    arcanist: -1,
    warden: -1,
    shadowblade: 1,
    ranger: -1,
    templar: -1,
    occultist: -1,
    reaver: -1,
    hierophant: -1,
  };
  const SPRITE_SIZE = 68;

  const roundedRectPath = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) => {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };
  function sync() {
    state = getState?.() || null;
    uiSettings = getUiSettings?.() || {};
  }
  function invalidate() {
    terrainCache.clear();
    miniTerrainCache.clear();
    staticWorldCache.valid = false;
    setLastMinimapSignature?.("");
    setUiDirty?.(true);
  }
  function zoneWorldMeters() {
    return Math.max(1, Number(state?.zoneInfo?.worldMeters || WORLD_METERS));
  }
  function minZoomForZone() {
    return MIN_ZOOM;
  }
  function viewportWorldFractions() {
    if (staticRenderMode) return { x: 1, y: 1 };
    const wm = zoneWorldMeters(),
      z = Math.max(0.01, camera.zoom),
      { w, h } = canvasLogicalSize();
    const fx = Math.max(
      0.003,
      Math.min(0.92, VIEWPORT_WORLD_METERS / (wm * z)),
    );
    return {
      x: fx,
      y: Math.max(0.003, Math.min(0.92, fx * (h / Math.max(1, w)))),
    };
  }
  function visibleFrac() {
    return viewportWorldFractions().x;
  }
  function canvasLogicalSize() {
    if (renderSizeOverride) return renderSizeOverride;
    const c = $("worldCanvas");
    const cw = Number(c?.clientWidth || 0),
      ch = Number(c?.clientHeight || 0);
    if (cw > 0 && ch > 0) return { w: cw, h: ch };
    const r = c?.getBoundingClientRect?.();
    return {
      w: Math.max(1, Math.round(r?.width || window.innerWidth || 1200)),
      h: Math.max(1, Math.round(r?.height || window.innerHeight || 700)),
    };
  }
  function resizeWorldCanvas() {
    const c = $("worldCanvas"),
      vp = document.querySelector(".viewport-wrap");
    if (!c || !vp) return;
    if (!worldCanvasResizeObserver && typeof ResizeObserver !== "undefined") {
      worldCanvasResizeObserver = new ResizeObserver(() => {
        try {
          requestAnimationFrame(() => resizeWorldCanvas());
        } catch {
          resizeWorldCanvas();
        }
      });
      worldCanvasResizeObserver.observe(vp);
    }
    const cssW = Math.max(
        1,
        Math.floor(vp.clientWidth || vp.getBoundingClientRect().width),
      ),
      cssH = Math.max(
        1,
        Math.floor(vp.clientHeight || vp.getBoundingClientRect().height),
      );
    if (cssW < 10 || cssH < 10) return;
    const maxBackingW = 1920,
      maxBackingH = 1080;
    const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    const backingScale = Math.min(dpr, maxBackingW / cssW, maxBackingH / cssH);
    const bw = Math.max(1, Math.round(cssW * backingScale)),
      bh = Math.max(1, Math.round(cssH * backingScale));
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    c.dataset.logicalWidth = String(cssW);
    c.dataset.logicalHeight = String(cssH);
    c.dataset.backingScale = String(backingScale);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
      staticWorldCache.valid = false;
      lastMinimapSignature = "";
      setLastMinimapSignature?.("");
      setUiDirty?.(true);
    }
  }

  function screenToWorld(sx, sy) {
    if (staticRenderMode) {
      const { w, h } = canvasLogicalSize();
      return { x: sx / w, y: sy / h };
    }
    const vf = viewportWorldFractions(),
      { w, h } = canvasLogicalSize();
    return {
      x: renderCameraAnchor.x + ((sx - w / 2) / w) * vf.x,
      y: renderCameraAnchor.y + ((sy - h / 2) / h) * vf.y,
    };
  }
  function worldToScreen(x, y) {
    if (staticRenderMode) {
      const { w, h } = canvasLogicalSize();
      return { x: x * w, y: y * h };
    }
    const vf = viewportWorldFractions(),
      { w, h } = canvasLogicalSize();
    return {
      x: ((x - renderCameraAnchor.x) / vf.x) * w + w / 2,
      y: ((y - renderCameraAnchor.y) / vf.y) * h + h / 2,
    };
  }
  function worldMetersForRenderRange(meters) {
    return Number(meters) / zoneWorldMeters();
  }
  function clampCamera() {}
  function zoneColors(id) {
    return (
      {
        stonehold: ["#4b443b", "#171719", "#75634a"],
        gloamwood: ["#171a1d", "#080a0d", "#68717b"],
        marches_of_dawn: ["#5b5a3c", "#17180f", "#8b7c4f"],
        duskmoor: ["#304145", "#10191b", "#637477"],
        ashen_wastes: ["#5a382d", "#1c0e0d", "#8b4e3d"],
        black_citadel: ["#3a3042", "#120d16", "#715277"],
        dawnwatch: ["#5d5b3f", "#1b1c14", "#8d8258"],
        ebonharbor: ["#354e57", "#0f1a1e", "#718f96"],
        eastern_reach: ["#4e5a3f", "#161b12", "#81945f"],
        old_kingdom: ["#4a4245", "#151116", "#82707a"],
        briarfen: ["#263f35", "#0c1713", "#668f74"],
        sunscar_steppe: ["#5a4930", "#1c140d", "#a4854d"],
        crownfall_expanse: ["#4a3b43", "#170f16", "#8b7181"],
        veilscar_highlands: ["#34394a", "#10121c", "#7180a4"],
        nightveil_coast: ["#263a43", "#081318", "#628b98"],
      }[id] || ["#3e4640", "#111613", "#68715f"]
    );
  }
  function spriteClass(classId: string) {
    return SPRITE_CLASSES.has(classId) ? classId : "";
  }
  function updateSpriteFacing(id: string, classId: string, vx: number) {
    const cls = spriteClass(classId);
    if (!cls) return 0;
    const base = SPRITE_BASE_DIRECTION[cls] || 1;
    const prev = spriteFacing.get(id) || base;
    if (Math.abs(vx) > 0.00001) spriteFacing.set(id, vx > 0 ? 1 : -1);
    else if (!spriteFacing.has(id)) spriteFacing.set(id, base);
    return spriteFacing.get(id) || base;
  }
  function entityScale() {
    return Math.max(0.78, Math.min(1.28, 0.86 + 0.14 * camera.zoom));
  }
  function drawWorldSprite(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    classId: string,
    facing: number,
    size = SPRITE_SIZE,
  ) {
    const base = SPRITE_BASE_DIRECTION[classId] || 1;
    const scaleX = facing === base ? 1 : -1;
    ctx.save();
    if (renderPerf.level < 2) {
      ctx.fillStyle = "rgba(0,0,0,.42)";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y + size * 0.36,
        size * 0.27,
        size * 0.08,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.translate(x, y - size * 0.02);
    ctx.scale(scaleX, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  function loadVisualAssets() {
    for (const [key, file] of Object.entries(CLASS_PORTRAITS)) {
      const img = new Image();
      img.onload = () => {
        visualAssets.playerPortraits[key] = img;
        visualAssets.worldSprites[key] = img;
        setUiDirty?.(true);
      };
      img.onerror = () => {};
      img.src = "/assets/ashenfall/classes/" + file;
    }
    for (const [key, fileValue] of Object.entries(BOSS_VISUALS)) {
      const file = String(fileValue);
      const img = new Image();
      img.onload = () => {
        visualAssets.bosses[key] = img;
        visualAssets.bosses[file.replace(".png", "")] = img;
        setUiDirty?.(true);
      };
      img.onerror = () => {};
      img.src = "/assets/ashenfall/bosses/" + file;
    }
    for (const [key, file] of Object.entries({
      tree: "tree.svg",
      rock: "rock.svg",
      ruin: "ruin.svg",
      city: "city.svg",
      bush: "bush.svg",
      deadTree: "dead-tree.svg",
      lantern: "lantern.svg",
      house: "house.svg",
      campfire: "campfire.svg",
    })) {
      const img = new Image();
      img.onload = () => {
        visualAssets.world[key] = img;
        setUiDirty?.(true);
      };
      img.onerror = () => {};
      img.src = "/assets/world/" + file;
    }
  }
  function hash32(a, b, seed = 0) {
    let x = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0;
    x = ((x ^ (x >>> 13)) * 1274126177) | 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  function hash01(a, b, seed = 0) {
    return hash32(a, b, seed) / 4294967296;
  }
  function layoutFor(zoneId) {
    return (
      WORLD_LAYOUT?.[zoneId] || {
        roads: [],
        buildings: [],
        blockedRects: [],
        hubs: [],
        water: [],
      }
    );
  }
  function pointNearPolyline(x, y, pts, threshold) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
          ),
        ),
        px = a[0] + dx * t,
        py = a[1] + dy * t;
      if (Math.hypot(x - px, y - py) < threshold) return true;
    }
    return false;
  }
  function nearRoad(x, y) {
    return (layoutFor(state?.zoneInfo?.id).roads || []).some((pts) =>
      pointNearPolyline(x, y, pts, 0.0038),
    );
  }
  function nearWater(id, x, y) {
    return (layoutFor(id).water || []).some((pts) =>
      pointNearPolyline(x, y, pts, 0.0065),
    );
  }
  function inRect(x, y, r, pad = 0) {
    return (
      x >= r[0] - pad &&
      x <= r[0] + r[2] + pad &&
      y >= r[1] - pad &&
      y <= r[1] + r[3] + pad
    );
  }
  function isClientBlocked(zoneId, x, y) {
    const l = layoutFor(zoneId);
    if ((l.blockedRects || []).some((r) => inRect(x, y, r, 0.0018)))
      return true;
    if (
      (l.obstacles || []).some(
        (o) =>
          Math.hypot(x - Number(o.x), y - Number(o.y)) <=
          Number(o.r || 0) + 0.0018,
      )
    )
      return true;
    if (nearWater(zoneId, x, y)) return true;
    return false;
  }
  function terrainFeaturesAround(zoneId, cxNorm, cyNorm, spanMeters) {
    const z = state.zoneInfo || {},
      wm = zoneWorldMeters(),
      cx = cxNorm * wm,
      cy = cyNorm * wm,
      cell = z.city ? 20 : 14,
      span = spanMeters;
    const key = `${zoneId}:${Math.round(cx / 12)}:${Math.round(cy / 12)}:${Math.round(span)}`;
    if (terrainCache.has(key)) return terrainCache.get(key);
    const minX = Math.floor((cx - span * 0.62) / cell),
      maxX = Math.ceil((cx + span * 0.62) / cell),
      minY = Math.floor((cy - span * 0.62) / cell),
      maxY = Math.ceil((cy + span * 0.62) / cell),
      out = [];
    for (let gy = minY; gy <= maxY; gy++)
      for (let gx = minX; gx <= maxX; gx++) {
        const h = hash01(gx, gy, zoneId.length * 97),
          h2 = hash01(gx, gy, zoneId.length * 193),
          nx = (gx * cell + (h * 0.72 + 0.14) * cell) / wm,
          ny = (gy * cell + (h2 * 0.72 + 0.14) * cell) / wm;
        if (
          nx < 0.008 ||
          nx > 0.992 ||
          ny < 0.008 ||
          ny > 0.992 ||
          nearRoad(nx, ny) ||
          nearWater(zoneId, nx, ny) ||
          isClientBlocked(zoneId, nx, ny)
        )
          continue;
        if (z.city) {
          if (h < 0.18)
            out.push({ type: "bush", x: nx, y: ny, s: 0.7 + 0.5 * h2 });
          else if (h < 0.28)
            out.push({ type: "lantern", x: nx, y: ny, s: 0.7 + 0.4 * h2 });
        } else {
          if (h < 0.34)
            out.push({
              type:
                zoneId === "ashen_wastes" || zoneId === "old_kingdom"
                  ? "deadTree"
                  : zoneId === "eastern_reach"
                    ? "tree"
                    : "tree",
              x: nx,
              y: ny,
              s: 0.65 + 0.55 * h2,
            });
          else if (h < 0.45)
            out.push({ type: "rock", x: nx, y: ny, s: 0.55 + 0.65 * h2 });
          else if (h < 0.51)
            out.push({ type: "bush", x: nx, y: ny, s: 0.55 + 0.55 * h2 });
          else if (h > 0.985) out.push({ type: "ruin", x: nx, y: ny, s: 0.6 });
        }
      }
    terrainCache.set(key, out);
    if (terrainCache.size > 120) {
      const first = terrainCache.keys().next().value;
      terrainCache.delete(first);
    }
    return out;
  }
  function viewBaseMeters() {
    return Math.max(100, zoneWorldMeters() * Math.max(0.08, visibleFrac()));
  }
  function localTerrainFeatures(zoneId) {
    return terrainFeaturesAround(
      zoneId,
      renderCameraAnchor.x,
      renderCameraAnchor.y,
      viewBaseMeters() / Math.max(0.01, camera.zoom),
    );
  }
  function drawGroundTexture(ctx, z, w, h) {
    const [base, dark, light] = zoneColors(z.id);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const wm = zoneWorldMeters(),
      vf = visibleFrac(),
      renderScale = (renderSizeOverride?.w || w) / 1200,
      span = wm * vf * renderScale;
    const cell = z.city ? 55 : 70;
    const minX = Math.floor((renderCameraAnchor.x * wm - span * 0.65) / cell),
      maxX = Math.ceil((renderCameraAnchor.x * wm + span * 0.65) / cell),
      minY = Math.floor((renderCameraAnchor.y * wm - span * 0.65) / cell),
      maxY = Math.ceil((renderCameraAnchor.y * wm + span * 0.65) / cell);
    for (let gy = minY; gy <= maxY; gy++)
      for (let gx = minX; gx <= maxX; gx++) {
        const h1 = hash01(gx, gy, z.id.length * 31),
          h2 = hash01(gx, gy, z.id.length * 67);
        const nx = (gx * cell + (h1 * 0.72 + 0.14) * cell) / wm,
          ny = (gy * cell + (h2 * 0.72 + 0.14) * cell) / wm;
        const q = worldToScreen(nx, ny);
        const size = (cell / (wm * vf)) * 1200 * 1.18;
        ctx.save();
        if (z.city) {
          ctx.fillStyle =
            h1 < 0.2 ? "#5a5147" : h1 > 0.82 ? "#423b3a" : "#514941";
          ctx.beginPath();
          ctx.roundRect(
            q.x - size * 0.48,
            q.y - size * 0.33,
            size * 0.96,
            size * 0.66,
            Math.min(12, size * 0.12),
          );
          ctx.fill();
          ctx.strokeStyle = "rgba(224,197,147,.045)";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle =
            h1 < 0.22
              ? "rgba(90,104,116,.055)"
              : h1 > 0.78
                ? "rgba(125,138,151,.035)"
                : "rgba(255,255,255,.012)";
          ctx.beginPath();
          ctx.ellipse(
            q.x,
            q.y,
            size * 0.72,
            size * 0.52,
            h2 * 3.14,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }
    if (z.city) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(255,220,165,.035)");
      grad.addColorStop(0.5, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,.12)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }
  function drawRoadsAndWater(ctx, z) {
    const l = layoutFor(z.id),
      wm = zoneWorldMeters(),
      vf = visibleFrac(),
      pxPerMeter =
        (staticRenderMode ? canvasLogicalSize().w : 1200) / (wm * vf);
    ctx.save();
    ctx.lineCap = "round";
    for (const pts of l.roads || []) {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const p = worldToScreen(q[0], q[1]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.strokeStyle = z.city ? "#20181a" : "#0a0d10";
      ctx.lineWidth = Math.max(z.city ? 34 : 26, 18 * pxPerMeter);
      ctx.stroke();
      if (!z.city) {
        ctx.strokeStyle = "#29333a";
        ctx.lineWidth = Math.max(18, 12 * pxPerMeter);
        ctx.stroke();
        ctx.strokeStyle = "#82909a88";
        ctx.lineWidth = Math.max(1, 1.2 * pxPerMeter);
        ctx.setLineDash([10, 18]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const pts of l.water || []) {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const p = worldToScreen(q[0], q[1]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.strokeStyle = "#0b1b1f";
      ctx.lineWidth = Math.max(40, 22 * pxPerMeter);
      ctx.stroke();
      ctx.strokeStyle = "#2c5c65";
      ctx.lineWidth = Math.max(27, 15 * pxPerMeter);
      ctx.stroke();
      ctx.strokeStyle = "#7aa9ad55";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawTacticalCity(ctx, z, w, h) {
    const l = layoutFor(z.id),
      vf = Math.max(0.001, visibleFrac()),
      wm = zoneWorldMeters();
    const minSide = Math.min(w, h);
    const roadWidth = staticRenderMode
      ? Math.max(2, Math.min(8, (10 / wm) * minSide))
      : Math.max(14, Math.min(30, (10 / wm / vf) * minSide));
    const hubRadius = (hub: any) =>
      staticRenderMode
        ? Math.max(3, Math.min(28, Number(hub.r || 0.006) * minSide * 0.62))
        : Math.max(48, Math.min(135, (Number(hub.r || 0.006) / vf) * minSide));

    ctx.save();
    ctx.fillStyle = "#030406";
    ctx.fillRect(0, 0, w, h);

    const corners = [
      worldToScreen(0.03, 0.03),
      worldToScreen(0.97, 0.03),
      worldToScreen(0.97, 0.97),
      worldToScreen(0.03, 0.97),
    ];
    ctx.strokeStyle = "rgba(121,155,169,.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((q, i) =>
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y),
    );
    ctx.closePath();
    ctx.stroke();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pts of l.roads || []) {
      if (!pts?.length) continue;
      const path = () => {
        ctx.beginPath();
        pts.forEach((q, i) => {
          const p = worldToScreen(q[0], q[1]);
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
      };
      path();
      ctx.strokeStyle = "rgba(10,17,23,.98)";
      ctx.lineWidth = roadWidth + 12;
      ctx.stroke();
      path();
      ctx.strokeStyle = "rgba(35,49,58,.98)";
      ctx.lineWidth = roadWidth;
      ctx.stroke();
    }

    for (const r of l.buildings || []) {
      const a = worldToScreen(r[0], r[1]),
        b = worldToScreen(r[0] + r[2], r[1] + r[3]);
      const bw = b.x - a.x,
        bh = b.y - a.y;
      if (
        bw < 6 ||
        bh < 5 ||
        b.x < -80 ||
        a.x > w + 80 ||
        b.y < -80 ||
        a.y > h + 80
      )
        continue;
      const rr = Math.min(8, Math.min(bw, bh) * 0.22);
      ctx.save();
      ctx.fillStyle = "rgba(11,16,21,.96)";
      ctx.strokeStyle = "rgba(106,137,150,.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      roundedRectPath(ctx, a.x, a.y, bw, bh, rr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(211,170,91,.35)";
      ctx.fillRect(
        a.x + bw * 0.16,
        a.y + bh * 0.18,
        Math.max(5, bw * 0.18),
        Math.max(3, bh * 0.13),
      );
      ctx.fillStyle = "rgba(102,185,198,.18)";
      ctx.fillRect(
        a.x + bw * 0.56,
        a.y + bh * 0.18,
        Math.max(4, bw * 0.18),
        Math.max(3, bh * 0.13),
      );
      ctx.restore();
    }

    const hubColors: any = {
      civic: "#d6ad62",
      market: "#79c9d3",
      craft: "#b78c5d",
      class: "#a985d6",
      service: "#76c99a",
      gate: "#d6ad62",
    };
    for (const hub of l.hubs || []) {
      const sp = worldToScreen(hub.x, hub.y),
        r = hubRadius(hub),
        accent = hubColors[hub.kind] || "#d6ad62";
      const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r * 1.7);
      glow.addColorStop(0, accent + "35");
      glow.addColorStop(0.55, accent + "12");
      glow.addColorStop(1, "#00000000");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(9,12,16,.96)";
      ctx.strokeStyle = accent + "bb";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = accent + "45";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = "#f1dfbd";
      ctx.font = "bold 12px system-ui";
      ctx.fillText(hub.name || "Hub", sp.x, sp.y - r - 9);
      if (hub.subtitle) {
        ctx.fillStyle = "#8f9da3";
        ctx.font = "10px system-ui";
        ctx.fillText(hub.subtitle, sp.x, sp.y + r + 14);
      }
    }

    for (const o of l.obstacles || []) {
      const sp = worldToScreen(Number(o.x), Number(o.y));
      const r = staticRenderMode
        ? Math.max(2, Math.min(12, Number(o.r || 0.003) * minSide))
        : Math.max(8, Math.min(22, (Number(o.r || 0.003) / vf) * minSide));
      ctx.save();
      ctx.shadowBlur = 8;
      if (o.type === "tree") {
        ctx.shadowColor = "#4b9b91aa";
        ctx.fillStyle = "#0a1719";
        ctx.strokeStyle = "#4e9e96";
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - r * 1.7);
        ctx.lineTo(sp.x - r, sp.y + r * 0.65);
        ctx.lineTo(sp.x + r, sp.y + r * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#896f4b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y + r * 0.45);
        ctx.lineTo(sp.x, sp.y + r * 1.25);
        ctx.stroke();
      } else {
        ctx.shadowColor = "#9a7650aa";
        ctx.fillStyle = "#11171b";
        ctx.strokeStyle = "#927454";
        ctx.beginPath();
        ctx.moveTo(sp.x - r, sp.y + r * 0.25);
        ctx.lineTo(sp.x - r * 0.25, sp.y - r);
        ctx.lineTo(sp.x + r, sp.y - r * 0.25);
        ctx.lineTo(sp.x + r * 0.5, sp.y + r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    const vg = ctx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      minSide * 0.15,
      w * 0.5,
      h * 0.48,
      Math.max(w, h) * 0.82,
    );
    vg.addColorStop(0, "#00000000");
    vg.addColorStop(1, "rgba(0,0,0,.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawDungeonBackground(ctx, w, h) {
    const d = state?.dungeonMap;
    ctx.save();
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, w, h);
    const vf = Math.max(0.003, visibleFrac()),
      minSide = Math.min(w, h);
    const rooms = d?.rooms || [],
      paths = d?.paths || [],
      roads = d?.roads || [];
    const corridor = (pts: any[], widthNorm: number) => {
      if (!pts?.length) return;
      const width = Math.max(
        26,
        (Number(widthNorm || 0.02) / Math.max(0.001, vf)) * minSide,
      );
      const draw = () => {
        ctx.beginPath();
        pts.forEach((q: any, i: number) => {
          const sp = worldToScreen(Number(q[0]), Number(q[1]));
          i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y);
        });
      };
      draw();
      ctx.strokeStyle = "#07090b";
      ctx.lineWidth = width + 18;
      ctx.stroke();
      draw();
      ctx.strokeStyle = "#1a2227";
      ctx.lineWidth = width;
      ctx.stroke();
      draw();
      ctx.strokeStyle = "#59666b55";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 18]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const road of roads)
      corridor(road.points || road, road.width || 0.022);
    for (const path of paths)
      corridor(path.points || path, path.width || 0.022);

    rooms.forEach((r: any, i: number) => {
      const tl = worldToScreen(r.x - r.w / 2, r.y - r.h / 2),
        br = worldToScreen(r.x + r.w / 2, r.y + r.h / 2);
      const x = Math.min(tl.x, br.x),
        y = Math.min(tl.y, br.y),
        rw = Math.abs(br.x - tl.x),
        rh = Math.abs(br.y - tl.y);
      if (x > w + 180 || y > h + 180 || x + rw < -180 || y + rh < -180) return;
      const rad = Math.min(22, Math.max(7, Math.min(rw, rh) * 0.12));
      ctx.fillStyle = "#101518";
      ctx.strokeStyle = "#68777d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      roundedRectPath(ctx, x, y, rw, rh, rad);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(95,111,117,.045)";
      ctx.fillRect(x + 8, y + 8, Math.max(0, rw - 16), Math.max(0, rh - 16));
      ctx.strokeStyle = "rgba(169,183,187,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundedRectPath(
        ctx,
        x + 10,
        y + 10,
        Math.max(0, rw - 20),
        Math.max(0, rh - 20),
        Math.max(5, rad - 4),
      );
      ctx.stroke();
      ctx.strokeStyle = "rgba(105,121,126,.08)";
      ctx.lineWidth = 1;
      const slab = Math.max(28, Math.min(70, rw / 4));
      for (let xx = x + slab; xx < x + rw; xx += slab) {
        ctx.beginPath();
        ctx.moveTo(xx, y + 10);
        ctx.lineTo(xx, y + rh - 10);
        ctx.stroke();
      }
      for (let yy = y + slab; yy < y + rh; yy += slab) {
        ctx.beginPath();
        ctx.moveTo(x + 10, yy);
        ctx.lineTo(x + rw - 10, yy);
        ctx.stroke();
      }
      const door = worldToScreen(r.x, r.y + r.h / 2),
        doorW = Math.max(24, Math.min(70, rw * 0.2));
      ctx.fillStyle = "#090b0d";
      ctx.fillRect(door.x - doorW / 2, door.y - 7, doorW, 14);
      ctx.strokeStyle = "#8b7144";
      ctx.lineWidth = 2;
      ctx.strokeRect(door.x - doorW / 2, door.y - 7, doorW, 14);
      for (const side of [-1, 1]) {
        const tx = x + rw * (side < 0 ? 0.08 : 0.92),
          ty = y + rh * 0.18;
        ctx.fillStyle = "#d6a85a";
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, 24);
        g.addColorStop(0, "rgba(220,170,80,.22)");
        g.addColorStop(1, "rgba(220,170,80,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, 24, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#d4bd87";
      ctx.font = "bold 11px system-ui";
      ctx.fillText(
        r.name || `Area ${i + 1}`,
        worldToScreen(r.x, r.y).x,
        y + 20,
      );
      const marker = worldToScreen(r.x, r.y);
      ctx.fillStyle =
        i === Number(state?.dungeon?.stage || 0) ? "#d7b35f" : "#68767b";
      ctx.beginPath();
      ctx.arc(marker.x, marker.y + 18, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    const current = Number(state?.dungeon?.stage || 0),
      next = rooms[current + 1];
    if (next) {
      const a = worldToScreen(next.x, next.y);
      if (a.x > -80 && a.x < w + 80 && a.y > -80 && a.y < h + 80) {
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.fillStyle = "#d8b56b";
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(9, 1);
        ctx.lineTo(0, 6);
        ctx.lineTo(-9, 1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    const entry = d?.entrance;
    if (entry) {
      const q = worldToScreen(entry.x, entry.y);
      ctx.fillStyle = "#b88d4e";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("ENTRANCE", q.x, q.y - 12);
    }
    const exit = d?.exit;
    if (exit) {
      const q = worldToScreen(exit.x, exit.y);
      ctx.fillStyle = "#d6ad62";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("EXIT", q.x, q.y - 12);
    }
    const vg = ctx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      minSide * 0.12,
      w * 0.5,
      h * 0.48,
      Math.max(w, h) * 0.82,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.48)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function drawBackground(ctx, z, w, h) {
    if (z?.city) {
      drawTacticalCity(ctx, z, w, h);
      return;
    }
    ctx.save();
    ctx.fillStyle = "#020304";
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(
      w * 0.5,
      h * 0.46,
      10,
      w * 0.5,
      h * 0.46,
      Math.max(w, h) * 0.8,
    );
    glow.addColorStop(0, "rgba(120,150,160,.025)");
    glow.addColorStop(1, "rgba(0,0,0,.62)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    drawRoadsAndWater(ctx, z);
    const l = layoutFor(z.id);
    for (const o of l.obstacles || []) {
      const sp = worldToScreen(Number(o.x), Number(o.y));
      if (sp.x < -90 || sp.x > w + 90 || sp.y < -90 || sp.y > h + 90) continue;
      const radius = Math.max(
        11,
        Math.min(26, (Number(o.r || 0.009) / visibleFrac()) * Math.min(w, h)),
      );
      ctx.save();
      ctx.shadowBlur = 9;
      if (o.type === "tree") {
        ctx.shadowColor = "#4e9e96aa";
        ctx.fillStyle = "#081012";
        ctx.strokeStyle = "#5da9a0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - radius * 1.8);
        ctx.lineTo(sp.x - radius, sp.y + radius * 0.65);
        ctx.lineTo(sp.x + radius, sp.y + radius * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#806040";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y + radius * 0.35);
        ctx.lineTo(sp.x, sp.y + radius * 1.2);
        ctx.stroke();
      } else {
        ctx.shadowColor = "#9a7650aa";
        ctx.fillStyle = "#101519";
        ctx.strokeStyle = "#a07d59";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x - radius, sp.y + radius * 0.25);
        ctx.lineTo(sp.x - radius * 0.25, sp.y - radius);
        ctx.lineTo(sp.x + radius, sp.y - radius * 0.2);
        ctx.lineTo(sp.x + radius * 0.45, sp.y + radius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(121,155,169,.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.restore();
  }
  function drawSafeGround(ctx, z, w, h) {
    ctx.save();
    ctx.fillStyle = "#020304";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(121,155,169,.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.restore();
  }
  function rebuildStaticWorldLayer(z) {
    const size = staticWorldCache.size;
    if (!staticWorldCache.canvas)
      staticWorldCache.canvas = document.createElement("canvas");
    staticWorldCache.canvas.width = size;
    staticWorldCache.canvas.height = size;
    staticWorldCache.ctx = staticWorldCache.canvas.getContext("2d");
    staticRenderMode = true;
    const savedCamera = { ...camera };
    const savedZoom = getZoomTarget?.() ?? camera.zoom;
    camera.x = 0.5;
    camera.y = 0.5;
    camera.zoom = 1;
    setZoomTarget?.(1);
    try {
      drawBackground(staticWorldCache.ctx, z, size, size);
    } finally {
      camera.x = savedCamera.x;
      camera.y = savedCamera.y;
      camera.zoom = savedCamera.zoom;
      setZoomTarget?.(savedZoom);
      staticRenderMode = false;
    }
    staticWorldCache.zone = z.id;
    staticWorldCache.valid = true;
  }
  function drawStaticWorld(ctx, z, w, h) {
    if (!staticWorldCache.valid || staticWorldCache.zone !== z.id)
      rebuildStaticWorldLayer(z);
    const vf = viewportWorldFractions(),
      size = staticWorldCache.size;
    ctx.fillStyle = "#020304";
    ctx.fillRect(0, 0, w, h);
    const sx = (renderCameraAnchor.x - vf.x / 2) * size,
      sy = (renderCameraAnchor.y - vf.y / 2) * size,
      sw = vf.x * size,
      sh = vf.y * size;
    const srcX = Math.max(0, Math.min(size, sx)),
      srcY = Math.max(0, Math.min(size, sy));
    const srcR = Math.min(size, sx + sw),
      srcB = Math.min(size, sy + sh);
    if (srcR > srcX && srcB > srcY) {
      const dx = ((srcX - sx) / sw) * w,
        dy = ((srcY - sy) / sh) * h,
        dw = ((srcR - srcX) / sw) * w,
        dh = ((srcB - srcY) / sh) * h;
      ctx.drawImage(
        staticWorldCache.canvas,
        srcX,
        srcY,
        srcR - srcX,
        srcB - srcY,
        dx,
        dy,
        dw,
        dh,
      );
    }
  }
  function drawWorld(t = performance.now()) {
    sync();
    const activeQuestHelper = getActiveQuestHelper?.();
    const questRouteVisible = getQuestRouteVisible?.();
    const keys = getKeys?.() || null;
    const localFx = getLocalFx?.() || [];
    const travelTransitionZone = getTravelTransitionZone?.();
    const travelTransitionStartedAt = getTravelTransitionStartedAt?.() || 0;
    const travelTransitionMinMs = getTravelTransitionMinMs?.() || 0;
    const zoomTarget = getZoomTarget?.() ?? camera.zoom;
    if (!state) return;
    const dt = Math.min(0.05, Math.max(0.001, (t - lastFrame || 16) / 1000));
    lastFrame = t;
    const frameMs = dt * 1000;
    renderPerf.ema = renderPerf.ema * 0.92 + frameMs * 0.08;
    if (renderPerf.ema > 28) {
      renderPerf.bad++;
      renderPerf.good = 0;
    } else if (renderPerf.ema < 17) {
      renderPerf.good++;
      renderPerf.bad = 0;
    } else {
      renderPerf.bad = Math.max(0, renderPerf.bad - 1);
      renderPerf.good = Math.max(0, renderPerf.good - 1);
    }
    if (renderPerf.level < 2 && renderPerf.bad >= 12) renderPerf.level++;
    else if (renderPerf.level > 0 && renderPerf.good >= 90) renderPerf.level--;
    (window as any).__ashenfallFps = Math.round(
      1000 / Math.max(1, renderPerf.ema),
    );
    const zoomBlend = 1 - Math.exp(-10 * dt);
    camera.zoom += ((zoomTarget || camera.zoom) - camera.zoom) * zoomBlend;
    const c = $("worldCanvas"),
      ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const logical = canvasLogicalSize(),
      w = logical.w || 1200,
      h = logical.h || 700;
    const backingScale = Math.max(
      0.5,
      Number(c.dataset.backingScale || (c.width || w) / Math.max(1, w)),
    );
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    const p = state.player;
    if (!p.hasCharacter) {
      return;
    }
    const authoritativeX = Number(p.x || 0),
      authoritativeY = Number(p.y || 0);
    const localMotion = getLocalMotion?.() || {};
    if (
      localMotion.zone !== p.zone ||
      !Number.isFinite(localMotion.x) ||
      !Number.isFinite(localMotion.y)
    )
      resetLocalMotion?.(authoritativeX, authoritativeY, p.zone);
    const pv = tickLocalMotion(t);
    if (!Number.isFinite(pv.x) || !Number.isFinite(pv.y)) {
      pv.x = authoritativeX;
      pv.y = authoritativeY;
    }
    pv.x = Math.max(0.005, Math.min(0.995, pv.x));
    pv.y = Math.max(0.005, Math.min(0.995, pv.y));
    renderCameraAnchor.x = pv.x;
    renderCameraAnchor.y = pv.y;
    camera.x = pv.x;
    camera.y = pv.y;
    try {
      if (state.dungeon?.stage != null) {
        drawDungeonBackground(ctx, w, h);
      } else if (state.zoneInfo?.city) {
        drawTacticalCity(ctx, state.zoneInfo, w, h);
      } else {
        drawStaticWorld(ctx, state.zoneInfo, w, h);
      }
    } catch (err) {
      console.error("Ashenfall static world render error", err);
      drawSafeGround(ctx, state.zoneInfo, w, h);
    }
    if (state.dungeon?.stage != null) {
      ctx.save();
      ctx.fillStyle = "#e0c38a";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(
        `${String(state.zoneInfo?.name || "DUNGEON").toUpperCase()} • STAGE ${Number(state.dungeon.stage) + 1}`,
        18,
        24,
      );
      ctx.fillStyle = "#9c8a78";
      ctx.font = "11px system-ui";
      ctx.fillText(state.encounter?.enemy?.name || "Exploration", 18, 41);
      ctx.restore();
    }
    const renderEntity = (id, x, y, draw) => {
      const v = { x: Number(x || 0), y: Number(y || 0) };
      draw(worldToScreen(v.x, v.y), v);
    };
    for (const g of state.dungeon?.stage != null ? [] : state.gates || []) {
      const sp = worldToScreen(g.x, g.y);
      if (sp.x > -80 && sp.x < w + 80 && sp.y > -80 && sp.y < h + 80) {
        ctx.textAlign = "center";
        ctx.font = "30px system-ui";
        ctx.fillText(g.icon, sp.x, sp.y);
        ctx.fillStyle = "#f1d48a";
        ctx.font = "11px system-ui";
        ctx.fillText(g.name, sp.x, sp.y + 22);
      }
    }
    for (const n of state.dungeon?.stage != null ? [] : state.npcs || []) {
      const sp = worldToScreen(n.x, n.y);
      if (sp.x > -100 && sp.x < w + 100 && sp.y > -120 && sp.y < h + 100) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "44px system-ui";
        ctx.shadowColor = "rgba(0,0,0,.8)";
        ctx.shadowBlur = 7;
        ctx.fillText(n.icon, sp.x, sp.y);
        ctx.shadowBlur = 0;
        ctx.restore();
        let mark = "";
        for (const qid of n.questIds || []) {
          const q = state.catalog.quests.find((q) => q.id === qid);
          const st = state.player.quests[qid] || {};
          if (!q || st.claimed) continue;
          if (st.accepted && st.complete) {
            mark = "?";
            break;
          }
          if (!st.accepted && st.visible !== false) {
            mark = "!";
          }
        }
        if (mark) {
          ctx.font = "bold 18px system-ui";
          ctx.fillStyle = mark === "!" ? "#ffd34e" : "#f5f1dd";
          ctx.fillText(mark, sp.x, sp.y - 42);
        }
        ctx.fillStyle = "#f0d993";
        ctx.font = "bold 11px system-ui";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(n.name, sp.x, sp.y - 54);
      }
    }
    for (const poi of state.region?.pois || []) {
      const discovered = !!poi.discovered;
      const sp = worldToScreen(Number(poi.x), Number(poi.y));
      if (sp.x < -80 || sp.x > w + 80 || sp.y < -80 || sp.y > h + 80) continue;
      ctx.save();
      ctx.textAlign = "center";
      const alpha = discovered ? 0.95 : 0.52;
      ctx.globalAlpha = alpha;
      const eventPoi = poi.state && poi.state !== "normal";
      if (poi.highlight) {
        ctx.strokeStyle =
          poi.state === "threatened"
            ? "#c85b5b"
            : poi.state === "secured"
              ? "#82b36f"
              : "#d8bb78";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y - 5, 16 + Math.sin(t / 220) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = discovered || eventPoi ? "#d8bb78" : "#8f8b82";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y - 5, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "14px system-ui";
      ctx.fillStyle = "#08070b";
      ctx.fillText(poi.icon || "◆", sp.x, sp.y);
      if (
        discovered ||
        poi.type === "settlement" ||
        poi.type === "dungeon_entrance" ||
        eventPoi
      ) {
        ctx.fillStyle = eventPoi
          ? poi.state === "threatened"
            ? "#e08b8b"
            : poi.state === "secured"
              ? "#b9d79f"
              : "#f1ddb0"
          : discovered
            ? "#f1ddb0"
            : "#b7a98b";
        ctx.font = "bold 10px system-ui";
        ctx.fillText(
          discovered || eventPoi
            ? poi.name
            : poi.name || "Undiscovered Location",
          sp.x,
          sp.y + 22,
        );
        if (poi.label) {
          ctx.font = "bold 8px system-ui";
          ctx.fillText(poi.label, sp.x, sp.y + 33);
        }
      }
      ctx.restore();
    }
    for (const o of state.dungeon?.stage != null ? [] : state.ores || [])
      renderEntity("o:" + o.id, o.x, o.y, (sp) => {
        ctx.font = "22px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(o.icon || "⛏️", sp.x, sp.y);
        ctx.fillStyle = "#b8a47b";
        ctx.font = "9px system-ui";
        ctx.fillText(
          `${o.name} • Mining ${o.miningLevel || o.level || 1}`,
          sp.x,
          sp.y + 15,
        );
        if (p.mining?.oreId === o.id) {
          const rem = Math.max(0, p.mining.endsAt - now()),
            total = Math.max(1, p.mining.endsAt - p.mining.startedAt),
            pct = 1 - rem / total;
          ctx.strokeStyle = "#e0b45b";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(
            sp.x,
            sp.y - 4,
            18,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * pct,
          );
          ctx.stroke();
          ctx.font = "15px system-ui";
          ctx.fillText("⛏️", sp.x, sp.y - 28);
        }
      });
    for (const l of state.dungeon?.stage != null ? [] : state.loot || [])
      renderEntity("l:" + l.id, l.x, l.y, (sp) => {
        ctx.font = "28px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("👜", sp.x, sp.y);
        ctx.fillStyle = "#ffd773";
        ctx.font = "11px system-ui";
        ctx.fillText("Loot", sp.x, sp.y + 20);
      });
    const mobSource = state.mobs || [];
    if (worldRenderCache.mobByIdSource !== mobSource) {
      worldRenderCache.mobByIdSource = mobSource;
      worldRenderCache.mobById = new Map<string, any>(
        mobSource.map((m: any): [string, any] => [String(m.id), m]),
      );
    }
    const nearbySource = state.nearby || [];
    if (worldRenderCache.playerByIdSource !== nearbySource) {
      worldRenderCache.playerByIdSource = nearbySource;
      worldRenderCache.playerById = new Map<string, any>(
        nearbySource.map((x: any): [string, any] => [String(x.id), x]),
      );
    }
    worldRenderCache.playerById.set(String(p.id), p);
    const mobsById = worldRenderCache.mobById,
      playersById = worldRenderCache.playerById;
    (state as any).mobsById = mobsById;
    const activeFx = [...(p.combatFx || []), ...(getLocalFx?.() || [])].filter(
      (f) => f.expiresAt > now,
    );
    const fxByTarget = new Map<string, any[]>();
    for (const f of activeFx) {
      if (!f.target) continue;
      const list = fxByTarget.get(f.target) || [];
      list.push(f);
      fxByTarget.set(f.target, list);
    }
    const mobPopulation = state.mobs || [];
    const mobCellX = Math.floor(Number(pv.x || 0) / 0.035),
      mobCellY = Math.floor(Number(pv.y || 0) / 0.035);
    const mobKey = `${state.zoneInfo?.id || p.zone}:${mobCellX}:${mobCellY}:${mobPopulation.length}:${uiSettings.showMobs}`;
    if (
      performance.now() - worldRenderCache.mobAt > 120 ||
      worldRenderCache.mobKey !== mobKey
    ) {
      worldRenderCache.mobAt = performance.now();
      worldRenderCache.mobKey = mobKey;
      const rankedMobs = mobPopulation
        .slice()
        .filter(
          (m: any) =>
            m.state !== "dead" &&
            (m.zone == null || String(m.zone) === String(p.zone)),
        )
        .sort((a, b) => {
          const ap = hasMotionPosition(`m:${a.id}`)
              ? motionPosition(`m:${a.id}`, a.x, a.y, "remote")
              : { x: Number(a.x), y: Number(a.y) },
            bp = hasMotionPosition(`m:${b.id}`)
              ? motionPosition(`m:${b.id}`, b.x, b.y, "remote")
              : { x: Number(b.x), y: Number(b.y) };
          const ad =
              (ap.x - pv.x) * (ap.x - pv.x) + (ap.y - pv.y) * (ap.y - pv.y),
            bd = (bp.x - pv.x) * (bp.x - pv.x) + (bp.y - pv.y) * (bp.y - pv.y);
          return ad - bd;
        });
      const renderLimit =
        renderPerf.level === 0 ? 70 : renderPerf.level === 1 ? 45 : 30;
      const selectedMobId = String(p.targetMobId || "");
      const selectedMob = selectedMobId
        ? rankedMobs.find((m: any) => String(m.id) === selectedMobId)
        : null;
      const visibleMobs = rankedMobs.slice(0, renderLimit);
      if (
        selectedMob &&
        !visibleMobs.some((m: any) => String(m.id) === selectedMobId)
      ) {
        if (visibleMobs.length >= renderLimit)
          visibleMobs[visibleMobs.length - 1] = selectedMob;
        else visibleMobs.push(selectedMob);
      }
      worldRenderCache.mobs = visibleMobs;
    }
    for (const f of activeFx.filter((x: any) => x.type === "projectile")) {
      const a = state.catalog.abilities[f.abilityId] || {};
      const target = mobsById.get(f.target) || playersById.get(f.target);
      const start = worldToScreen(
        Number(f.startX ?? pv.x),
        Number(f.startY ?? pv.y),
      );
      const targetPos = target
        ? worldToScreen(target.x, target.y)
        : worldToScreen(
            Number(f.targetX ?? f.startX ?? pv.x),
            Number(f.targetY ?? f.startY ?? pv.y),
          );
      const total = Math.max(
        1,
        Number(f.durationMs || a.combatFeel?.projectileTravelMs || 200),
      );
      const prog = Math.max(
        0,
        Math.min(1, 1 - (f.expiresAt - Date.now()) / total),
      );
      const px = start.x + (targetPos.x - start.x) * prog,
        py = start.y + (targetPos.y - start.y) * prog;
      const kind = String(
        f.projectileKind || a.combatFeel?.projectileKind || "bolt",
      );
      const spell = a.scaling === "spell" || kind === "orb" || kind === "bolt";
      const main = spell ? "#9dd7ff" : "#f3d28b";
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.strokeStyle = main;
      ctx.fillStyle = main;
      ctx.shadowColor = main;
      ctx.shadowBlur = spell ? 18 : 11;
      if (f.trail !== false) {
        const tx = start.x + (px - start.x) * 0.78,
          ty = start.y + (py - start.y) * 0.78;
        ctx.globalAlpha = 0.24;
        ctx.lineWidth = spell ? 5 : 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.globalAlpha = 0.96;
      }
      if (kind === "arrow") {
        const ang = Math.atan2(targetPos.y - start.y, targetPos.x - start.x);
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(8, 0);
        ctx.moveTo(5, -4);
        ctx.lineTo(10, 0);
        ctx.lineTo(5, 4);
        ctx.stroke();
      } else if (kind === "orb") {
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(px, py, 13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const f of activeFx.filter(
      (x: any) =>
        x.type === "projectile_impact" || x.type === "projectile_miss",
    )) {
      const target = mobsById.get(f.target) || playersById.get(f.target);
      if (!target) continue;
      const sp = worldToScreen(target.x, target.y),
        age = Math.max(
          0,
          Math.min(
            1,
            (Date.now() - f.at) /
              Number(f.type === "projectile_miss" ? 520 : 320),
          ),
        );
      ctx.save();
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = f.type === "projectile_miss" ? "#9aa0b3" : "#f7e0aa";
      ctx.fillStyle =
        f.type === "projectile_miss"
          ? "rgba(140,150,180,.18)"
          : "rgba(247,224,170,.24)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 10 + age * 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    const renderMobs = worldRenderCache.mobs;
    for (const m of renderMobs) {
      const mp = hasMotionPosition(`m:${m.id}`)
        ? motionPosition("m:" + m.id, m.x, m.y, "remote")
        : { x: Number(m.x), y: Number(m.y) };
      renderEntity("m:" + m.id, mp.x, mp.y, (sp) => {
        if (sp.x < -100 || sp.x > w + 100 || sp.y < -100 || sp.y > h + 100)
          return;
        const targetFx = fxByTarget.get(m.id) || [];
        const reaction = targetFx.find((f: any) => f.type === "hit_reaction");
        if (reaction) {
          const age = Math.max(
            0,
            Math.min(1, (Date.now() - reaction.at) / 260),
          );
          const ox = Math.sin(age * Math.PI * 8) * (1 - age) * 7;
          ctx.save();
          ctx.translate(ox, 0);
          ctx.globalAlpha = 1 - age;
          ctx.fillStyle = "rgba(255,225,170,.28)";
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 26 + age * 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        const latestSkill = targetFx.reduce(
          (best, f) =>
            f.type === "skill" && (!best || (f.at || 0) > (best.at || 0))
              ? f
              : best,
          null,
        );
        for (const f of targetFx) {
          if (f.type === "skill" && f !== latestSkill) continue;
          const alpha = Math.max(0, (f.expiresAt - now()) / 900);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.textAlign = "center";
          if (f.type === "predicted_skill") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 650),
            );
            ctx.font = "16px system-ui";
            ctx.globalAlpha = 0.75;
            ctx.fillText(
              state.catalog.abilities[f.abilityId]?.icon || "✨",
              sp.x,
              sp.y - 50 + age * 22,
            );
            ctx.globalAlpha = 1;
          } else if (f.type === "skill") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 760),
            );
            const dropY = sp.y - 50 + age * 30;
            ctx.font = "16px system-ui";
            if (renderPerf.level < 2) {
              ctx.shadowColor = "#000";
              ctx.shadowBlur = 6;
            }
            ctx.fillText(
              state.catalog.abilities[f.abilityId]?.icon || "✨",
              sp.x,
              dropY,
            );
            ctx.shadowBlur = 0;
          } else if (f.type === "slash") {
            ctx.strokeStyle = "#ffe4a1";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(sp.x - 20, sp.y + 18);
            ctx.lineTo(sp.x + 20, sp.y - 18);
            ctx.stroke();
          } else if (f.type === "aoe") {
            const radiusMeters = Number(f.radius || 8),
              radiusPx = Math.max(
                30,
                (radiusMeters / zoneWorldMeters() / visibleFrac()) * 1200,
              );
            ctx.strokeStyle = "#ffd45d";
            ctx.fillStyle = "rgba(255,80,70,.12)";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, radiusPx, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (f.type === "heal") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 900),
            );
            ctx.font = "bold 16px system-ui";
            ctx.fillStyle = "#63e6a3";
            ctx.strokeStyle = "#07140e";
            ctx.lineWidth = 3;
            ctx.strokeText(`+${f.amount || 0}`, sp.x, sp.y - 42 - age * 20);
            ctx.fillText(`+${f.amount || 0}`, sp.x, sp.y - 42 - age * 20);
          } else if (f.type === "miss" || f.type === "avoid") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 900),
            );
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
            ctx.font = "bold 15px system-ui";
            ctx.textAlign = "center";
            ctx.fillStyle = "#cfd6e6";
            ctx.strokeStyle = "#09070c";
            ctx.lineWidth = 3;
            const outcomeText =
              f.type === "avoid" && f.outcome === "dodge" ? "DODGE" : "MISS";
            ctx.strokeText(outcomeText, sp.x, sp.y - 50 - age * 18);
            ctx.fillText(outcomeText, sp.x, sp.y - 50 - age * 18);
            ctx.restore();
          } else if (f.type === "crit") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 900),
            );
            ctx.font = "bold 21px system-ui";
            ctx.fillStyle = "#ffcc55";
            ctx.strokeStyle = "#09070c";
            ctx.lineWidth = 3;
            ctx.strokeText(`CRIT ${f.amount || 0}`, sp.x, sp.y - 60 - age * 20);
            ctx.fillText(`CRIT ${f.amount || 0}`, sp.x, sp.y - 60 - age * 20);
          } else if (f.type === "interrupt") {
            ctx.font = "bold 12px system-ui";
            ctx.fillStyle = "#7ed7ff";
            ctx.fillText("INTERRUPT", sp.x, sp.y - 64);
          } else if (f.type === "cleanse") {
            ctx.font = "bold 12px system-ui";
            ctx.fillStyle = "#bff7ff";
            ctx.fillText("CLEANSE", sp.x, sp.y - 64);
          } else if (f.type === "damage") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 900),
            );
            ctx.font = f.crit ? "bold 22px system-ui" : "bold 16px system-ui";
            ctx.fillStyle = f.crit ? "#ff4657" : "#f2e4c5";
            ctx.strokeStyle = "#09070c";
            ctx.lineWidth = 3;
            ctx.strokeText(
              `${f.crit ? "CRIT " : ""}${f.amount}`,
              sp.x,
              sp.y - 42 - age * 20,
            );
            ctx.fillText(
              `${f.crit ? "CRIT " : ""}${f.amount}`,
              sp.x,
              sp.y - 42 - age * 20,
            );
          }
          ctx.restore();
        }
        const isTarget = p.targetMobId === m.id,
          attackingMe = m.aggroTarget === p.id;
        if (isTarget) {
          ctx.save();
          ctx.strokeStyle = "#e6bd5a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y - 34);
          ctx.lineTo(sp.x + 7, sp.y - 27);
          ctx.lineTo(sp.x, sp.y - 20);
          ctx.lineTo(sp.x - 7, sp.y - 27);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
        if (attackingMe) {
          const pulse = 0.6 + 0.4 * Math.sin(t / 500);
          ctx.strokeStyle = "rgba(255,70,80," + pulse + ")";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 22 + Math.sin(t / 170) * 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle =
            "rgba(255,40,60," + (0.12 + 0.1 * Math.sin(t / 200)) + ")";
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 30, 0, Math.PI * 2);
          ctx.fill();
        }
        const behaviorLabel =
          m.state === "fleeing"
            ? "FLEEING"
            : m.state === "investigating"
              ? "INVESTIGATING"
              : m.state === "engaged" && m.aggroTarget === p.id
                ? "ENGAGED"
                : "";
        if (behaviorLabel) {
          ctx.save();
          ctx.font = "bold 10px system-ui";
          ctx.textAlign = "center";
          ctx.fillStyle =
            behaviorLabel === "FLEEING"
              ? "#ffd27a"
              : behaviorLabel === "INVESTIGATING"
                ? "#9fd7ff"
                : "#ff8b83";
          ctx.fillText(behaviorLabel, sp.x, sp.y - 58);
          ctx.restore();
        }
        ctx.font = "40px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(m.icon, sp.x, sp.y);
        if (uiSettings.showMobs) {
          ctx.fillStyle = m.temper === "aggressive" ? "#ff7467" : "#dbcda8";
          ctx.font = "11px system-ui";
          ctx.fillText(`${m.name} Lv${m.level}`, sp.x, sp.y - 20);
          ctx.fillStyle = "#2b1b20";
          ctx.fillRect(sp.x - 25, sp.y + 10, 50, 5);
          ctx.fillStyle = "#c84e59";
          const displayHp = Math.max(0, Number(m.hp || 0));
          ctx.fillRect(
            sp.x - 25,
            sp.y + 10,
            50 * Math.max(0, displayHp / Math.max(1, Number(m.maxHp || 1))),
            5,
          );
        }
        if (attackingMe) {
          ctx.fillStyle = "#ff5364";
          ctx.font = "10px system-ui";
          ctx.fillText("ATTACKING YOU", sp.x, sp.y + 27);
        }
      });
    }
    if (state.dungeon?.stage != null && state.encounter?.enemy) {
      const room =
        state.dungeonMap?.rooms?.find(
          (r) => Number(r.id) === Number(state.dungeon.roomId),
        ) ||
        state.dungeonMap?.rooms?.[
          Math.min(
            Number(state.dungeon.stage || 0),
            Math.max(0, (state.dungeonMap?.rooms?.length || 1) - 1),
          )
        ];
      if (room) {
        const sp = worldToScreen(room.x, room.y);
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "58px system-ui";
        ctx.shadowColor = "rgba(255,45,55,.65)";
        ctx.shadowBlur = 18;
        const bossVisual =
          BOSS_BY_ENEMY[state.encounter.enemy.id] ||
          BOSS_VISUALS[state.dungeon?.id || ""];
        const bossImage = bossVisual
          ? visualAssets.bosses[bossVisual.replace(".png", "")]
          : null;
        if (bossImage) {
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          const bossSize = 92 * entityScale();
          ctx.drawImage(
            bossImage,
            sp.x - bossSize / 2,
            sp.y - bossSize + 10,
            bossSize,
            bossSize,
          );
          ctx.restore();
        } else {
          ctx.fillText(state.encounter.enemy.icon || "👹", sp.x, sp.y);
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ff8b83";
        ctx.font = "bold 12px system-ui";
        ctx.fillText(state.encounter.enemy.name || "Boss", sp.x, sp.y - 42);
        const hp = Math.max(0, Number(state.encounter.enemyHp || 0)),
          maxHp = Math.max(1, Number(state.encounter.maxHp || 1));
        ctx.fillStyle = "rgba(12,8,10,.9)";
        ctx.fillRect(sp.x - 90, sp.y + 32, 180, 10);
        ctx.fillStyle = "#b93645";
        ctx.fillRect(sp.x - 90, sp.y + 32, 180 * (hp / maxHp), 10);
        ctx.strokeStyle = "#d8b66b";
        ctx.lineWidth = 1;
        ctx.strokeRect(sp.x - 90, sp.y + 32, 180, 10);
        ctx.fillStyle = "#e9d7b5";
        ctx.font = "10px system-ui";
        ctx.fillText(
          `Phase ${Number(state.encounter.phase || 1)} • ${hp}/${maxHp}`,
          sp.x,
          sp.y + 58,
        );
        ctx.restore();
      }
    }
    const playerCap = Math.max(0, Number(uiSettings.maxPlayers) || 80);
    const playerPopulation =
      state.dungeon?.stage != null ? [] : state.nearby || [];
    const playerCellX = Math.floor(Number(pv.x || 0) / 0.05),
      playerCellY = Math.floor(Number(pv.y || 0) / 0.05);
    const playerKey = `${state.zoneInfo?.id || p.zone}:${playerCellX}:${playerCellY}:${playerPopulation.length}:${playerCap}`;
    if (
      performance.now() - worldRenderCache.playersAt > 180 ||
      worldRenderCache.playersKey !== playerKey
    ) {
      worldRenderCache.playersAt = performance.now();
      worldRenderCache.playersKey = playerKey;
      worldRenderCache.players = playerPopulation
        .slice()
        .sort((a, b) => {
          const ad = (a.x - pv.x) * (a.x - pv.x) + (a.y - pv.y) * (a.y - pv.y),
            bd = (b.x - pv.x) * (b.x - pv.x) + (b.y - pv.y) * (b.y - pv.y);
          return ad - bd;
        })
        .slice(
          0,
          renderPerf.level === 0
            ? playerCap
            : Math.min(playerCap, renderPerf.level === 1 ? 45 : 30),
        );
    }
    if (
      state.pvp?.state === "active" &&
      Number.isFinite(Number(state.pvp.centerX))
    ) {
      const center = worldToScreen(
        Number(state.pvp.centerX),
        Number(state.pvp.centerY),
      );
      const radiusNorm = Number(state.pvp.arenaRadius || 0.25);
      const px = Math.max(28, (radiusNorm / visibleFrac()) * 1200);
      ctx.save();
      ctx.setLineDash([14, 9]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(230,190,92,.9)";
      ctx.fillStyle = "rgba(180,120,45,.07)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f2d98d";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("DUEL ARENA", center.x, center.y - px - 10);
      if (Number(state.pvp.outSince || 0) > 0) {
        const left = Math.max(
          0,
          10 - Math.floor((Date.now() - Number(state.pvp.outSince)) / 1000),
        );
        ctx.fillStyle = "#ff9a8f";
        ctx.fillText(
          `Return to the arena: ${left}s`,
          center.x,
          center.y + px + 18,
        );
      }
      ctx.restore();
    }
    const visiblePlayers = worldRenderCache.players;
    for (const x of visiblePlayers) {
      const pp = motionPosition("p:" + x.id, x.x, x.y);
      renderEntity("p:" + x.id, pp.x, pp.y, (sp) => {
        const targetFx = (x.combatFx || []).filter(
          (f) => f.expiresAt > Date.now(),
        );
        for (const f of targetFx) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, (f.expiresAt - Date.now()) / 900);
          ctx.textAlign = "center";
          if (f.type === "predicted_skill") {
            ctx.globalAlpha = 0.72;
            ctx.font = "22px system-ui";
            ctx.fillText(
              state.catalog.abilities[f.abilityId]?.icon || "✨",
              sp.x,
              sp.y - 48,
            );
            ctx.globalAlpha = 1;
          } else if (f.type === "heal") {
            ctx.font = "bold 16px system-ui";
            ctx.fillStyle = "#63e6a3";
            ctx.strokeStyle = "#07140e";
            ctx.lineWidth = 3;
            ctx.strokeText(`+${f.amount || 0}`, sp.x, sp.y - 52);
            ctx.fillText(`+${f.amount || 0}`, sp.x, sp.y - 52);
          } else if (f.type === "miss" || f.type === "avoid") {
            const age = Math.max(
              0,
              Math.min(1, 1 - (f.expiresAt - now()) / 900),
            );
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
            ctx.font = "bold 15px system-ui";
            ctx.textAlign = "center";
            ctx.fillStyle = "#cfd6e6";
            ctx.strokeStyle = "#09070c";
            ctx.lineWidth = 3;
            const outcomeText =
              f.type === "avoid" && f.outcome === "dodge" ? "DODGE" : "MISS";
            ctx.strokeText(outcomeText, sp.x, sp.y - 50 - age * 18);
            ctx.fillText(outcomeText, sp.x, sp.y - 50 - age * 18);
            ctx.restore();
          } else if (f.type === "damage" || f.type === "crit") {
            ctx.font =
              f.crit || f.type === "crit"
                ? "bold 20px system-ui"
                : "bold 16px system-ui";
            ctx.fillStyle = f.crit || f.type === "crit" ? "#ffcc55" : "#f2e4c5";
            ctx.strokeStyle = "#09070c";
            ctx.lineWidth = 3;
            ctx.strokeText(
              `${f.crit || f.type === "crit" ? "CRIT " : ""}${f.amount || 0}`,
              sp.x,
              sp.y - 52,
            );
            ctx.fillText(
              `${f.crit || f.type === "crit" ? "CRIT " : ""}${f.amount || 0}`,
              sp.x,
              sp.y - 52,
            );
          } else if (f.type === "interrupt") {
            ctx.font = "bold 11px system-ui";
            ctx.fillStyle = "#7ed7ff";
            ctx.fillText("INTERRUPT", sp.x, sp.y - 52);
          } else if (f.type === "cleanse") {
            ctx.font = "bold 11px system-ui";
            ctx.fillStyle = "#bff7ff";
            ctx.fillText("CLEANSE", sp.x, sp.y - 52);
          }
          ctx.restore();
        }
        if (x.dead) {
          ctx.save();
          ctx.textAlign = "center";
          ctx.font = "30px system-ui";
          ctx.globalAlpha = 0.78;
          ctx.fillText("💀", sp.x, sp.y);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#aaa2a0";
          ctx.font = "10px system-ui";
          if (uiSettings.showNames)
            ctx.fillText(`${x.name} • Dead`, sp.x, sp.y - 28);
          ctx.restore();
          return;
        }
        const cls = spriteClass(x.classId);
        const sprite = cls ? visualAssets.worldSprites[cls] : null;
        const vx = Number(x.velocityX || 0) || Number(x.facingX || 0);
        const facing = updateSpriteFacing("p:" + x.id, x.classId, vx);
        if (sprite) {
          drawWorldSprite(
            ctx,
            sprite,
            sp.x,
            sp.y,
            x.classId,
            facing,
            SPRITE_SIZE * entityScale(),
          );
        } else {
          ctx.font = "44px system-ui";
          ctx.textAlign = "center";
          ctx.shadowColor = "rgba(0,0,0,.75)";
          ctx.shadowBlur = 6;
          ctx.fillText(x.icon, sp.x, sp.y);
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = "#93d8ff";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        if (uiSettings.showNames)
          ctx.fillText(`${x.name} Lv${x.level}`, sp.x, sp.y - 34);
      });
    }
    const recentBySpeaker = new Map();
    for (const msg of (state.chat || []).filter(
      (m) => m.kind === "player" && m.ts && Date.now() - m.ts < 5000,
    ))
      recentBySpeaker.set(msg.from, msg);
    const recentChat = [...recentBySpeaker.values()];
    for (const msg of recentChat) {
      let pos = null;
      if (msg.from === p.name) pos = pv;
      else {
        const pl = (state.nearby || []).find((x) => x.name === msg.from);
        if (pl) {
          const pp = motionPosition("p:" + pl.id, pl.x, pl.y);
          pos = pp;
        }
      }
      if (!pos) continue;
      const bs = worldToScreen(pos.x, pos.y);
      if (bs.x < -250 || bs.x > w + 250 || bs.y < -120 || bs.y > h + 80)
        continue;
      const text = String(msg.text || "").slice(0, 240);
      ctx.save();
      ctx.font = "12px system-ui";
      const maxWidth = 220,
        words = text.split(/\s+/),
        lines = [];
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
      const lineH = 15,
        tw = Math.min(
          250,
          Math.max(
            70,
            Math.max(...lines.map((x) => ctx.measureText(x).width)) + 22,
          ),
        ),
        bh = Math.max(30, lines.length * lineH + 12),
        bx = bs.x - tw / 2,
        by = bs.y - 78 - bh + 30;
      ctx.fillStyle = "rgba(10,8,12,.94)";
      ctx.strokeStyle = "#756042";
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundedRectPath(ctx, bx, by, tw, bh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bs.x - 6, by + bh);
      ctx.lineTo(bs.x, by + bh + 7);
      ctx.lineTo(bs.x + 6, by + bh);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f0e7d8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((ln, i) =>
        ctx.fillText(ln, bs.x, by + 8 + lineH * i + lineH / 2),
      );
      ctx.restore();
    }

    renderEntity("me", pv.x, pv.y, (sp) => {
      const centre = { w, h };
      sp = { x: Math.round(centre.w / 2), y: Math.round(centre.h / 2) };
      sp = { x: Math.round(sp.x), y: Math.round(sp.y) };
      const predictedSelfFx = (getLocalFx?.() || []).filter(
        (f: any) =>
          f.type === "predicted_cast" &&
          f.target === p.id &&
          f.expiresAt > Date.now(),
      );
      for (const f of predictedSelfFx) {
        const life = Math.max(0, Math.min(1, (f.expiresAt - Date.now()) / 500));
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.65 * life;
        ctx.strokeStyle = "#e8c76f";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 18 + (1 - life) * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      const fxs = (p.combatFx || []).filter((f) => f.expiresAt > now());
      for (const f of fxs) {
        if (f.type === "aoe") {
          const radiusMeters = Number(f.radius || 8);
          const radiusPx = Math.max(
            30,
            (radiusMeters / zoneWorldMeters() / visibleFrac()) * 1200,
          );
          const life = Math.max(0, Math.min(1, (f.expiresAt - now()) / 700));
          ctx.save();
          ctx.globalAlpha = 0.22 + 0.45 * life;
          ctx.fillStyle = "rgba(210,45,60,.18)";
          ctx.strokeStyle = "rgba(255,75,90,.96)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([8, 6]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, Math.max(18, radiusPx * 0.82), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        if (f.type === "heal") {
          ctx.save();
          ctx.globalAlpha = Math.max(0, (f.expiresAt - now()) / 900);
          ctx.fillStyle = "#63e6a3";
          ctx.font = "bold 17px system-ui";
          ctx.textAlign = "center";
          ctx.strokeStyle = "#07140e";
          ctx.lineWidth = 3;
          ctx.strokeText(`+${f.amount || 0}`, sp.x, sp.y - 55);
          ctx.fillText(`+${f.amount || 0}`, sp.x, sp.y - 55);
          ctx.restore();
        }
        if (f.type === "miss" || f.type === "avoid") {
          const age = Math.max(0, Math.min(1, 1 - (f.expiresAt - now()) / 900));
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - age * 0.8);
          ctx.font = "bold 15px system-ui";
          ctx.textAlign = "center";
          ctx.fillStyle = "#cfd6e6";
          ctx.strokeStyle = "#09070c";
          ctx.lineWidth = 3;
          const outcomeText =
            f.type === "avoid" && f.outcome === "dodge" ? "DODGE" : "MISS";
          ctx.strokeText(outcomeText, sp.x, sp.y - 50 - age * 18);
          ctx.fillText(outcomeText, sp.x, sp.y - 50 - age * 18);
          ctx.restore();
        }
        if (f.type === "crit") {
          ctx.save();
          ctx.globalAlpha = Math.max(0, (f.expiresAt - now()) / 900);
          ctx.fillStyle = "#ffcc55";
          ctx.font = "bold 21px system-ui";
          ctx.textAlign = "center";
          ctx.strokeStyle = "#09070c";
          ctx.lineWidth = 3;
          ctx.strokeText(`CRIT ${f.amount || 0}`, sp.x, sp.y - 72);
          ctx.fillText(`CRIT ${f.amount || 0}`, sp.x, sp.y - 72);
          ctx.restore();
        }
        if (f.type === "hit" || f.type === "boss-hit") {
          ctx.fillStyle = f.type === "boss-hit" ? "#ff3d4d55" : "#ff304d66";
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 34 + Math.sin(t / 40) * 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = f.type === "boss-hit" ? "#ff7180" : "#ff6a74";
          ctx.lineWidth = 3;
          ctx.stroke();
          if (f.type === "boss-hit") {
            ctx.fillStyle = "#ff9aa2";
            ctx.font = "bold 12px system-ui";
            ctx.fillText(
              `☠️ ${f.abilityName || "BOSS HIT"} -${f.amount || ""}`,
              sp.x,
              sp.y - 82,
            );
          }
        }
        if (f.type === "boss-basic") {
          ctx.fillStyle = "#ff5b6660";
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 30 + Math.sin(t / 45) * 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffd18a";
          ctx.font = "bold 12px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(`⚔️ -${f.amount || ""}`, sp.x, sp.y - 72);
        }
        if (f.type === "slash") {
          ctx.strokeStyle = "#f7e0aa";
          ctx.lineWidth = 6;
          ctx.shadowColor = "#ffe5a6";
          ctx.shadowBlur = 12;
          const m = state.mobsById?.get?.(f.target) || null;
          if (m) {
            const tm = worldToScreen(m.x, m.y);
            ctx.strokeStyle = "#f7e0aa";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(tm.x - 18, tm.y + 16);
            ctx.lineTo(tm.x + 18, tm.y - 16);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
        }
      }
      for (const f of fxs.filter(
        (x) => x.type === "skill" && x.target === p.id,
      )) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, (f.expiresAt - now()) / 760);
        const drop = sp.y - 46;
        ctx.font = "22px system-ui";
        ctx.textAlign = "center";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 7;
        ctx.fillText(
          state.catalog.abilities[f.abilityId]?.icon || "✨",
          sp.x,
          drop,
        );
        ctx.restore();
      }
      const cls = spriteClass(p.classId);
      const sprite = cls ? visualAssets.worldSprites[cls] : null;
      let horizontalVelocity = Number(p.velocityX || 0);
      const activeKeys = getKeys?.() || null;
      if (activeKeys && activeKeys.size) {
        if (activeKeys.has("a") && !activeKeys.has("d"))
          horizontalVelocity = -1;
        if (activeKeys.has("d") && !activeKeys.has("a")) horizontalVelocity = 1;
      }
      if (Math.abs(horizontalVelocity) < 0.00001) {
        const fightId = String(p.worldCombatMobId || p.targetMobId || "");
        const fightMob = fightId
          ? (state.mobs || []).find(
              (m: any) => String(m.id) === fightId && m.state !== "dead",
            )
          : null;
        if (fightMob && Math.abs(Number(fightMob.x) - Number(p.x)) > 0.0004)
          horizontalVelocity = Number(fightMob.x) > Number(p.x) ? 1 : -1;
      }
      const facing = updateSpriteFacing("me", p.classId, horizontalVelocity);
      if (sprite) {
        drawWorldSprite(
          ctx,
          sprite,
          sp.x,
          sp.y,
          p.classId,
          facing,
          SPRITE_SIZE * entityScale(),
        );
      } else {
        const portrait = visualAssets.playerPortraits[p.classId];
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y - 1, 22, 0, Math.PI * 2);
        ctx.clip();
        if (portrait) ctx.drawImage(portrait, sp.x - 22, sp.y - 23, 44, 44);
        else {
          ctx.fillStyle = "#17131d";
          ctx.fillRect(sp.x - 22, sp.y - 23, 44, 44);
          ctx.font = "24px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(p.icon, sp.x, sp.y + 8);
        }
        ctx.restore();
        ctx.strokeStyle = "#d7b66b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y - 1, 23, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`${p.name} Lv${p.level}`, sp.x, sp.y - 34);
    });
    if (state.encounter) {
      const encounter = state.encounter;
      for (const zone of encounter.groundEffects || []) {
        const center = worldToScreen(
          Number(zone.centerX || 0),
          Number(zone.centerY || 0),
        );
        const radiusMeters = Math.max(4, Number(zone.radius || 8));
        const radiusPx = Math.max(
          34,
          (radiusMeters / zoneWorldMeters() / visibleFrac()) * 1200,
        );
        const left = Math.max(
          0,
          (Number(zone.expiresAt || 0) - Date.now()) / 1000,
        );
        ctx.save();
        ctx.globalAlpha = 0.22 + 0.08 * Math.sin(t / 140);
        ctx.fillStyle = "rgba(185,45,70,.72)";
        ctx.strokeStyle = "rgba(255,105,120,.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          center.x,
          center.y,
          Math.max(20, radiusPx * 0.78),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffb0b8";
        ctx.font = "bold 10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
          `${zone.name || "Danger Ground"} • ${left.toFixed(1)}s`,
          center.x,
          center.y - radiusPx - 7,
        );
        ctx.restore();
      }
      const drawTelegraph = (cast: any, overlap = false) => {
        if (!cast) return;
        const bossPos = encounter.bossPosition || {
          x: cast.centerX ?? pv.x,
          y: cast.centerY ?? pv.y,
        };
        const boss = worldToScreen(Number(bossPos.x), Number(bossPos.y));
        const targetId = cast.targetPlayerId || cast.targetPlayerIds?.[0];
        const targetPlayer =
          (state.nearby || []).find((x: any) => x.id === targetId) ||
          (targetId === state.player.id ? state.player : null);
        const targetPos = targetPlayer
          ? worldToScreen(Number(targetPlayer.x), Number(targetPlayer.y))
          : worldToScreen(
              Number(cast.centerX ?? pv.x),
              Number(cast.centerY ?? pv.y),
            );
        const radiusMeters = Math.max(4, Number(cast.radius || 8));
        const radiusPx = Math.max(
          34,
          (radiusMeters / zoneWorldMeters() / visibleFrac()) * 1200,
        );
        const pulse = 0.22 + 0.12 * Math.sin(t / 110);
        const kind = String(cast.kind || "single");
        ctx.save();
        ctx.globalAlpha = overlap ? 0.55 : 0.88;
        ctx.lineWidth = overlap ? 2 : 3;
        ctx.setLineDash(overlap ? [7, 6] : [10, 7]);
        const ang = Math.atan2(targetPos.y - boss.y, targetPos.x - boss.x);
        if (kind === "cone" || kind === "frontal" || kind === "gaze") {
          const spread =
            kind === "frontal"
              ? Math.PI * 0.55
              : kind === "gaze"
                ? Math.PI * 0.42
                : Math.PI * 0.7;
          const len = radiusPx * 1.8;
          ctx.fillStyle = `rgba(255,55,70,${pulse + 0.08})`;
          ctx.strokeStyle = "rgba(255,85,95,.9)";
          ctx.beginPath();
          ctx.moveTo(boss.x, boss.y);
          ctx.arc(boss.x, boss.y, len, ang - spread / 2, ang + spread / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (kind === "tether") {
          ctx.strokeStyle = "rgba(190,105,255,.95)";
          ctx.fillStyle = "rgba(190,105,255,.18)";
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(boss.x, boss.y);
          ctx.lineTo(targetPos.x, targetPos.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(
            targetPos.x,
            targetPos.y,
            Math.max(18, radiusPx * 0.35),
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.stroke();
        } else if (
          kind === "tank_buster" ||
          kind === "targeted" ||
          kind === "single" ||
          kind === "stun"
        ) {
          ctx.strokeStyle =
            kind === "tank_buster"
              ? "rgba(255,170,55,.98)"
              : "rgba(255,75,90,.95)";
          ctx.fillStyle =
            kind === "tank_buster"
              ? `rgba(255,145,40,${pulse + 0.08})`
              : `rgba(255,45,60,${pulse})`;
          ctx.beginPath();
          ctx.arc(targetPos.x, targetPos.y, radiusPx * 0.72, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const center = worldToScreen(
            Number(cast.centerX ?? targetPlayer?.x ?? pv.x),
            Number(cast.centerY ?? targetPlayer?.y ?? pv.y),
          );
          ctx.strokeStyle = "rgba(255,60,72,.95)";
          ctx.fillStyle = `rgba(255,45,60,${pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (kind === "stack") {
            ctx.setLineDash([]);
            ctx.strokeStyle = "rgba(255,220,120,.95)";
            ctx.beginPath();
            ctx.arc(center.x, center.y, radiusPx * 0.55, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (kind === "spread") {
            ctx.setLineDash([]);
            ctx.strokeStyle = "rgba(255,120,150,.9)";
            ctx.beginPath();
            ctx.arc(center.x, center.y, radiusPx * 0.7, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = kind === "tank_buster" ? "#ffd28a" : "#ffb0b8";
        ctx.font = overlap ? "bold 10px system-ui" : "bold 12px system-ui";
        ctx.textAlign = "center";
        const hint =
          cast.interruptible &&
          ["single", "stun", "tank_buster", "interrupt"].includes(kind)
            ? "INTERRUPT"
            : ["gaze", "movement", "frontal", "cone"].includes(kind)
              ? "MOVE / FACE AWAY"
              : ["ground", "aoe", "spread"].includes(kind)
                ? "MOVE OUT"
                : ["stack", "soak"].includes(kind)
                  ? "STACK / SOAK"
                  : "RESPOND";
        ctx.fillText(
          `${cast.name || "Boss Mechanic"}  •  ${hint}`,
          targetPos.x,
          targetPos.y - radiusPx - 9,
        );
        ctx.restore();
      };
      drawTelegraph(encounter.cast, false);
      for (const overlap of encounter.activeOverlapCasts || [])
        drawTelegraph(overlap, true);
      if (encounter.enemy?.ai === "boss" && encounter.cast) {
        const cast = encounter.cast;
        const left = Math.max(
          0,
          (Number(cast.endsAt || 0) - Date.now()) / 1000,
        );
        const cb = $("combatCastBar");
        if (cb) {
          cb.classList.remove("hidden");
          $("combatCastName").textContent = cast.name || "Casting";
          $("combatCastTime").textContent = `${left.toFixed(1)}s`;
          $("combatCastFill").style.width =
            `${Math.max(0, Math.min(100, ((Number(cast.duration || 1) - (Number(cast.endsAt || 0) - Date.now())) / Math.max(1, Number(cast.duration || 1))) * 100))}%`;
          $("combatCastHint").textContent = cast.interruptible
            ? "Interruptible"
            : "Uninterruptible";
        }
      } else {
        $("combatCastBar")?.classList.add("hidden");
      }
    }
    const currentZoneId = String(
      state.zoneInfo?.id || p.zone || "",
    ).toLowerCase();
    const isCityZone =
      Boolean(state.zoneInfo?.city) || currentZoneId === "stonehold";
    if (p.targetMobId && !isCityZone && !state.dungeon?.stage) {
      const m = state.mobs.find((m) => String(m.id) === String(p.targetMobId));
      const localMotion = getLocalMotion?.() || {};
      if (
        !m ||
        m.state === "dead" ||
        (m.zone != null && String(m.zone) !== String(p.zone))
      ) {
      } else {
        const mp = hasMotionPosition(`m:${m.id}`)
          ? motionPosition(`m:${m.id}`, m.x, m.y, "remote")
          : { x: Number(m.x), y: Number(m.y) };
        const stopMeters = Math.max(
          1.5,
          Number(
            p.combat?.approachRangeMeters ||
              ([
                "ranger",
                "arcanist",
                "warden",
                "occultist",
                "hierophant",
              ].includes(String(p.classId))
                ? 72
                : 18),
          ),
        );
        const distanceMeters =
          Math.hypot(Number(mp.x) - Number(pv.x), Number(mp.y) - Number(pv.y)) *
          zoneWorldMeters();
        const activeTarget = String(p.targetMobId || "") === String(m.id);
        const visuallySatisfied = distanceMeters <= stopMeters + 1.5;
        const manualOverride =
          Boolean(getKeys?.()?.size) ||
          localMotion.localIntentSource === "manual" ||
          localMotion.manualMove;
        const localCombatIntent =
          localMotion.localIntentSource === "combat" &&
          localMotion.localIntentKind !== "none";
        const approachRequested =
          (Boolean(p.combat?.autoApproach) ||
            Boolean(localMotion.serverAutoApproach) ||
            localMotion.serverMovementIntent === "combat" ||
            p.movementIntent === "combat" ||
            Boolean(p.worldCombatMobId) ||
            Boolean(p.combat?.queuedWorldAbility) ||
            localCombatIntent) &&
          !manualOverride;
        const showApproachLine =
          activeTarget &&
          approachRequested &&
          !visuallySatisfied &&
          distanceMeters > 0.05;
        if (showApproachLine) {
          const me = worldToScreen(Number(pv.x), Number(pv.y)),
            tm = worldToScreen(Number(mp.x), Number(mp.y));
          const targetOnScreen =
            tm.x >= 0 && tm.x <= w && tm.y >= 0 && tm.y <= h;
          if (targetOnScreen) {
            ctx.save();
            ctx.strokeStyle = "rgba(255,207,91,.96)";
            ctx.setLineDash([9, 6]);
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.shadowColor = "rgba(255,190,65,.45)";
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(me.x, me.y);
            ctx.lineTo(tm.x, tm.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }
      }
    }
    const renderQuestHelper =
      activeQuestHelper?.targetX != null && activeQuestHelper?.targetY != null
        ? activeQuestHelper
        : state.questHelper?.targetX != null &&
            state.questHelper?.targetY != null
          ? state.questHelper
          : null;
    const renderQuestRouteZone = String(
      renderQuestHelper?.routeZoneId || renderQuestHelper?.zoneId || p.zone,
    );
    if (
      questRouteVisible &&
      renderQuestHelper?.targetX != null &&
      renderQuestHelper?.targetY != null &&
      (renderQuestRouteZone === String(p.zone) || !renderQuestRouteZone)
    ) {
      const q = renderQuestHelper,
        sp = worldToScreen(Number(q.targetX), Number(q.targetY));
      if (sp.x > -40 && sp.x < w + 40 && sp.y > -40 && sp.y < h + 40) {
        ctx.fillStyle = "#ffd76a";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 12 + Math.sin(t / 180) * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#151018";
        ctx.font = "14px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("★", sp.x, sp.y + 5);
        ctx.fillStyle = "#ffd76a";
        ctx.font = "11px system-ui";
        ctx.fillText("Quest", sp.x, sp.y + 28);
      } else {
        const dx = sp.x - w / 2,
          dy = sp.y - h / 2,
          ang = Math.atan2(dy, dx),
          pad = 42,
          edgeX = Math.max(
            pad,
            Math.min(
              w - pad,
              w / 2 + Math.cos(ang) * (Math.min(w, h) / 2 - pad),
            ),
          ),
          edgeY = Math.max(
            pad,
            Math.min(
              h - pad,
              h / 2 + Math.sin(ang) * (Math.min(w, h) / 2 - pad),
            ),
          );
        ctx.save();
        ctx.translate(edgeX, edgeY);
        ctx.rotate(ang);
        ctx.fillStyle = "#ffd76a";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-9, -8);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-9, 8);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.rotate(-ang);
        ctx.font = "bold 10px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f4dfaa";
        ctx.fillText("Quest", 0, 22);
        ctx.restore();
      }
    }
    try {
      drawMinimap(false);
    } catch (err) {
      console.error("Ashenfall minimap render error", err);
    }
    renderTravelTransition(ctx, w, h, t);
  }

  function renderTravelTransition(ctx, w, h, t) {
    const travelTransitionZone = getTravelTransitionZone?.();
    const travelTransitionStartedAt = getTravelTransitionStartedAt?.() || 0;
    const travelTransitionMinMs = getTravelTransitionMinMs?.() || 0;
    if (!travelTransitionZone) return;
    const elapsed = performance.now() - travelTransitionStartedAt;
    if (elapsed >= travelTransitionMinMs) {
      clearTravelTransition?.();
      return;
    }
    const progress = Math.max(0, Math.min(1, elapsed / travelTransitionMinMs));
    const alpha =
      progress < 0.35
        ? Math.min(0.92, (progress / 0.35) * 0.92)
        : Math.max(0, (0.92 * (1 - progress)) / 0.65);
    ctx.save();
    ctx.fillStyle = `rgba(4,3,8,${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ead7a7";
    ctx.font = "bold 18px system-ui";
    ctx.fillText(
      `Entering ${String(state?.zoneInfo?.name || travelTransitionZone)}`,
      w / 2,
      h / 2 - 10,
    );
    ctx.fillStyle = "#9f96a5";
    ctx.font = "12px system-ui";
    ctx.fillText("The road opens before you…", w / 2, h / 2 + 16);
    ctx.restore();
  }

  function drawMinimap(force = false) {
    const c = $("minimap");
    if (!c || !state) return;
    const nowPerf = performance.now(),
      range = (state.zoneInfo?.city ? 2600 : 2200) / minimapZoom;
    const sig = `${state.zoneInfo?.id}:${Math.round(state.player.x * 1000)}:${Math.round(state.player.y * 1000)}`;
    if (
      !force &&
      nowPerf - lastMinimapDraw < 120 &&
      sig === lastMinimapSignature
    )
      return;
    lastMinimapDraw = nowPerf;
    lastMinimapSignature = sig;
    setLastMinimapSignature?.(sig);
    const ctx = c.getContext("2d"),
      w = c.width,
      h = c.height,
      wm = zoneWorldMeters(),
      p = state.player,
      px = p.x * wm,
      py = p.y * wm;
    const toMini = (x, y) => ({
      x: w / 2 + ((x * wm - px) / range) * w,
      y: h / 2 + ((y * wm - py) / range) * h,
    });
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, w, h);
    if (state.dungeon?.stage != null && state.dungeonMap) {
      const rooms = state.dungeonMap.rooms || [],
        paths = state.dungeonMap.paths || [],
        roads = state.dungeonMap.roads || [];
      const sx = (x) => x * w,
        sy = (y) => y * h;
      const miniRoad = (pts: any[]) => {
        if (!pts?.length) return;
        ctx.beginPath();
        pts.forEach((q: any, i: number) =>
          i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1])),
        );
        ctx.strokeStyle = "#26343c";
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.strokeStyle = "#60767e";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      roads.forEach((r: any) => miniRoad(r.points || r));
      paths.forEach((r: any) => r.points && miniRoad(r.points));
      const discoveredMini = new Set(
        (state.dungeon?.discoveredRooms || []).map(Number),
      );
      for (const r of rooms) {
        if (discoveredMini.size && !discoveredMini.has(Number(r.id))) continue;
        const x = (r.x - r.w / 2) * w,
          y = (r.y - r.h / 2) * h,
          rw = r.w * w,
          rh = r.h * h;
        ctx.fillStyle = "#121a1f";
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeStyle = "#52636b";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, rw, rh);
      }
      for (const m of state.mobs || []) {
        const q = { x: sx(m.x), y: sy(m.y) };
        ctx.fillStyle = m.temper === "aggressive" ? "#d85660" : "#d8c58d";
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const rr =
        rooms[
          Math.min(
            Number(state.dungeon.stage || 0),
            Math.max(0, rooms.length - 1),
          )
        ];
      if (rr) {
        ctx.fillStyle = "#c84e5c";
        ctx.beginPath();
        ctx.arc(sx(rr.x), sy(rr.y), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#f7e7bd";
      const pp = { x: sx(state.player.x), y: sy(state.player.y) };
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const l = layoutFor(state.zoneInfo.id);
    for (const pts of l.roads || []) {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const q2 = toMini(q[0], q[1]);
        i ? ctx.lineTo(q2.x, q2.y) : ctx.moveTo(q2.x, q2.y);
      });
      ctx.strokeStyle = "#25313a";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    for (const hub of l.hubs || []) {
      const q = toMini(hub.x, hub.y);
      if (q.x < -12 || q.x > w + 12 || q.y < -12 || q.y > h + 12) continue;
      ctx.fillStyle = "#0d1419";
      ctx.strokeStyle = "#c6a05c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const visibleGates = state.gates || [];
    for (const g of visibleGates) {
      const q = toMini(g.x, g.y);
      if (q.x < -10 || q.x > w + 10 || q.y < -10 || q.y > h + 10) continue;
      ctx.save();
      ctx.strokeStyle = "#e5c36c";
      ctx.fillStyle = "#11161b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e5c36c";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", q.x, q.y + 0.5);
      ctx.restore();
    }
    for (const x of state.nearby || []) {
      const q = toMini(x.x, x.y);
      if (q.x < 0 || q.x > w || q.y < 0 || q.y > h) continue;
      ctx.fillStyle = "#69c9ef";
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of state.party?.members || []) {
      if (m.id === p.id || m.zone !== p.zone) continue;
      const q = toMini(m.x, m.y);
      if (q.x < 0 || q.x > w || q.y < 0 || q.y > h) continue;
      ctx.save();
      ctx.fillStyle = "#6ec8ff";
      ctx.strokeStyle = "#d9f1ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 5);
      ctx.lineTo(q.x + 5, q.y + 4);
      ctx.lineTo(q.x - 5, q.y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (p.targetMobId) {
      const m = state.mobs?.find((x) => x.id === p.targetMobId);
      if (m) {
        const q = toMini(m.x, m.y);
        ctx.fillStyle = "#e45d66";
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#f7e7bd";
    ctx.strokeStyle = "#b98b43";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f0ddb1";
    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("YOU", w / 2, h / 2 + 19);
    ctx.restore();
    ctx.strokeStyle = "#a07a3f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d9c89e";
    ctx.font = "9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(state.zoneInfo?.city ? "CITY" : "AREA", w / 2, h - 8);
    ctx.fillText("N", w / 2, 12);
  }

  function drawCurrentZoneMap() {
    const activeQuestHelper = getActiveQuestHelper?.();
    const c = $("worldMapCanvas");
    if (!c || !state) return;
    const ctx = c.getContext("2d"),
      w = c.width,
      h = c.height;
    if (state.dungeon?.id && state.dungeonMap) {
      const d = state.dungeonMap,
        rooms = d.rooms || [],
        paths = d.paths || d.roads || [];
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(119,154,166,.28)";
      ctx.lineWidth = 2;
      ctx.strokeRect(22, 22, w - 44, h - 44);
      const to = (x, y) => ({ x: x * w, y: y * h });
      const corridor = (pts, width) => {
        if (!pts?.length) return;
        ctx.beginPath();
        pts.forEach((q, i) => {
          const p = to(Number(q[0]), Number(q[1]));
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
        ctx.lineCap = "round";
        ctx.strokeStyle = "#111b22";
        ctx.lineWidth = width + 10;
        ctx.stroke();
        ctx.strokeStyle = "#30424c";
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.strokeStyle = "#75a9b3";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 12]);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      for (const path of paths)
        corridor(
          path.points || path,
          Math.max(18, Number(path.width || 0.035) * Math.min(w, h)),
        );
      const discovered = new Set(
        (state.dungeon?.discoveredRooms || []).map(Number),
      );
      for (const r of rooms) {
        if (discovered.size && !discovered.has(Number(r.id))) continue;
        const x = (r.x - r.w / 2) * w,
          y = (r.y - r.h / 2) * h,
          rw = r.w * w,
          rh = r.h * h;
        ctx.fillStyle = "#0d1216";
        ctx.strokeStyle = "#586870";
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
        ctx.fillStyle = "#c9b27a";
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(r.name || `Area ${r.id}`, r.x * w, y + 18);
      }
      for (const r of d.optionalRooms || []) {
        if (discovered.size && !discovered.has(Number(r.id))) continue;
        const x = (r.x - r.w / 2) * w,
          y = (r.y - r.h / 2) * h,
          rw = r.w * w,
          rh = r.h * h;
        ctx.save();
        ctx.fillStyle = "#14100c";
        ctx.strokeStyle = "#b88a4a";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
        ctx.setLineDash([]);
        ctx.fillStyle = "#e0b45b";
        ctx.font = "bold 11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`OPTIONAL • ${r.name}`, r.x * w, y + 16);
        ctx.restore();
      }
      if (state.dungeon.roomId) {
        const r = rooms.find(
          (x) => Number(x.id) === Number(state.dungeon.roomId),
        );
        if (r) {
          const q = to(r.x, r.y);
          ctx.fillStyle = "#fff1a6";
          ctx.strokeStyle = "#c7a15c";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      const pp = to(state.player.x, state.player.y);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#e6bf67";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6d7ba";
      ctx.font = "bold 18px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(state.zoneInfo.name, 18, 28);
      publishWorldMapLegend("Dungeon route • rooms • current position • party");
      return;
    }
    const worldMapZone = getWorldMapZone?.();
    const zone =
        state.zones.find((z) => z.id === (worldMapZone || state.zoneInfo.id)) ||
        state.zoneInfo,
      l = layoutFor(zone.id);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    const to = (x, y) => ({ x: x * w, y: y * h });
    ctx.strokeStyle = "rgba(119,154,166,.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, w - 44, h - 44);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pts of l.roads || []) {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const p = to(q[0], q[1]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.strokeStyle = "#111b22";
      ctx.lineWidth = 22;
      ctx.stroke();
      ctx.strokeStyle = "#30424c";
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.strokeStyle = "#75a9b3";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 12]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const r of l.blockedRects || []) {
      const x = r[0] * w,
        y = r[1] * h,
        bw = r[2] * w,
        bh = r[3] * h;
      ctx.fillStyle = "#0e151a";
      ctx.strokeStyle = "#40515a";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
    }
    for (const hub of l.hubs || []) {
      const x = hub.x * w,
        y = hub.y * h,
        rad = Math.max(20, hub.r * w);
      ctx.save();
      ctx.fillStyle = "#0b1116";
      ctx.strokeStyle = "#c7a45f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#6d5a37";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ead7a7";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ead7a7";
      ctx.font = "bold 13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(hub.name, x, y - rad - 9);
      ctx.restore();
    }
    for (const o of l.obstacles || []) {
      const x = o.x * w,
        y = o.y * h;
      ctx.fillStyle = o.type === "tree" ? "#4c8e86" : "#8d7354";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const n of (state.worldMapNpcs || []).filter(
      (n) => n.zone === zone.id,
    )) {
      const x = n.x * w,
        y = n.y * h;
      let marker = "";
      for (const qid of n.questIds || []) {
        const qs = state.player.quests[qid] || {};
        if (qs.accepted && qs.complete) {
          marker = "?";
          break;
        }
        if (!qs.accepted && qs.visible !== false) {
          marker = "!";
        }
      }
      ctx.fillStyle =
        marker === "!"
          ? "#ffd45d"
          : marker === "?"
            ? "#fff3d0"
            : n.kind === "trainer"
              ? "#78c9ff"
              : "#75c99b";
      ctx.beginPath();
      ctx.arc(x, y, marker ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (marker) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px system-ui";
        ctx.fillText(marker, x + 8, y - 5);
      }
    }
    const exploration = state.region?.exploration || {};
    const discoveredLocations = new Set(
      (exploration.locations || [])
        .filter((x: any) => x.discovered)
        .map((x: any) => x.id),
    );
    for (const loc of exploration.locations || []) {
      if (!loc.discovered) continue;
      const q = to(Number(loc.x), Number(loc.y));
      const isCurrent = state.region?.lastDiscovery?.locationId === loc.id;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = isCurrent ? "#ffe08a" : "#d8c28b";
      ctx.strokeStyle = "#15100b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(q.x, q.y, isCurrent ? 8 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = "14px system-ui";
      ctx.fillText(loc.icon || "◆", q.x, q.y - 8);
      ctx.font = "bold 9px system-ui";
      ctx.fillStyle = "#e7d8b8";
      ctx.fillText(loc.name, q.x, q.y + 18);
      ctx.restore();
    }
    const activeMapQuest = activeQuestHelper;
    if (
      activeMapQuest?.targetX != null &&
      activeMapQuest?.targetY != null &&
      (activeMapQuest.routeZoneId === zone.id ||
        activeMapQuest.zoneId === zone.id)
    ) {
      const qx = activeMapQuest.targetX * w,
        qy = activeMapQuest.targetY * h;
      ctx.save();
      ctx.strokeStyle = "#ffd76a";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(
        qx,
        qy,
        15 + Math.sin(performance.now() / 220) * 2,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffd76a";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(
        activeMapQuest.type === "kill" ? "⚔ Objective" : "★ Objective",
        qx,
        qy - 20,
      );
      ctx.restore();
    }
    const seenGateMarkers: any[] = [];
    const gateDestinations = new Set<string>();
    for (const g of state.gates || []) {
      const gx = Number(g.x),
        gy = Number(g.y),
        destination = String(g.to || g.targetZone || g.id || "");
      const duplicate =
        gateDestinations.has(destination) ||
        seenGateMarkers.some(
          (x: any) => Math.hypot(gx - x.x, gy - x.y) <= 0.04,
        );
      if (duplicate) continue;
      gateDestinations.add(destination);
      seenGateMarkers.push({ x: gx, y: gy, destination });
      const q = to(gx, gy);
      ctx.save();
      ctx.strokeStyle = "#e8c76f";
      ctx.fillStyle = "#0a1015";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e8c76f";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", q.x, q.y);
      ctx.restore();
    }
    if (zone.id === state.zoneInfo.id) {
      const x = state.player.x * w,
        y = state.player.y * h;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#e6bf67";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (zone.id === state.zoneInfo.id) {
      for (const m of state.party?.members || []) {
        if (m.id === state.player.id || m.zone !== zone.id) continue;
        const x = m.x * w,
          y = m.y * h;
        ctx.save();
        ctx.fillStyle = "#70cbff";
        ctx.strokeStyle = "#eaf8ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x + 8, y + 7);
        ctx.lineTo(x - 8, y + 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#bfeaff";
        ctx.font = "bold 10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(m.name, x, y + 19);
        ctx.restore();
      }
    }
    ctx.fillStyle = "#e6d7ba";
    ctx.font = "bold 18px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(zone.name, 18, 28);
    publishWorldMapLegend(
      `${exploration.completed ? "✓ Region complete • " : ""}Discovered locations ${Number(exploration.discoveredCount || 0)}/${Number(exploration.totalDiscoveries || 0)} • roads • services • gates`,
    );
  }

  function publishWorldMapLegend(text: string) {
    const sync = (window as any).__ashenfallReactWorldMapSync;
    if (sync) sync({ legend: text });
    else if ($("worldMapLegend")) $("worldMapLegend").textContent = text;
  }
  function drawWorldMap() {
    const worldMapMode = getWorldMapMode?.() || "world";
    if (worldMapMode === "zone") {
      drawCurrentZoneMap();
      return;
    }
    const c = $("worldMapCanvas");
    if (!c || !state) return;
    const ctx = c.getContext("2d"),
      w = c.width,
      h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    const nodes: any = {
      stonehold: [0.16, 0.5],
      gloamwood: [0.31, 0.28],
      eastern_reach: [0.5, 0.16],
      marches_of_dawn: [0.72, 0.22],
      duskmoor: [0.31, 0.72],
      old_kingdom: [0.5, 0.84],
      ashen_wastes: [0.57, 0.5],
      black_citadel: [0.8, 0.44],
      dawnwatch: [0.75, 0.72],
      ebonharbor: [0.55, 0.92],
      sunken_catacombs: [0.3, 0.44],
      briarfen: [0.34, 0.22],
      sunscar_steppe: [0.58, 0.28],
      crownfall_expanse: [0.56, 0.72],
      veilscar_highlands: [0.8, 0.58],
      nightveil_coast: [0.86, 0.8],
      hollow_expanse: [0.96, 0.6],
    };
    const roads = [
      ["stonehold", "gloamwood"],
      ["stonehold", "eastern_reach"],
      ["gloamwood", "briarfen"],
      ["marches_of_dawn", "briarfen"],
      ["eastern_reach", "briarfen"],
      ["eastern_reach", "sunscar_steppe"],
      ["briarfen", "sunscar_steppe"],
      ["sunscar_steppe", "ashen_wastes"],
      ["sunscar_steppe", "crownfall_expanse"],
      ["stonehold", "duskmoor"],
      ["stonehold", "old_kingdom"],
      ["duskmoor", "ashen_wastes"],
      ["old_kingdom", "crownfall_expanse"],
      ["old_kingdom", "ashen_wastes"],
      ["ashen_wastes", "crownfall_expanse"],
      ["ashen_wastes", "black_citadel"],
      ["crownfall_expanse", "veilscar_highlands"],
      ["black_citadel", "veilscar_highlands"],
      ["veilscar_highlands", "nightveil_coast"],
      ["nightveil_coast", "hollow_expanse"],
      ["veilscar_highlands", "hollow_expanse"],
      ["marches_of_dawn", "dawnwatch"],
      ["ashen_wastes", "ebonharbor"],
      ["ebonharbor", "duskmoor"],
    ];
    const point = (id) => {
      const p = nodes[id];
      return p ? [p[0] * w, p[1] * h] : null;
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [a, b] of roads) {
      const A = point(a),
        B = point(b);
      if (!A || !B) continue;
      ctx.strokeStyle = "#111b22";
      ctx.lineWidth = 24;
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.stroke();
      ctx.strokeStyle = "#4f6f78";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const fallbackZonePoint = (index: number, total: number) => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total))));
      const rows = Math.max(1, Math.ceil(total / cols));
      const col = index % cols,
        row = Math.floor(index / cols);
      return [
        0.1 + (col / Math.max(1, cols - 1)) * 0.8,
        0.14 + (row / Math.max(1, rows - 1)) * 0.72,
      ] as [number, number];
    };
    const allZones = (state.zones || []).filter(
      (z: any) => z && z.id && !String(z.id).startsWith("arena_"),
    );
    const fallbackNodes: any = {};
    let fallbackIndex = 0;
    for (const z of allZones) {
      if (!nodes[z.id]) {
        fallbackNodes[z.id] = fallbackZonePoint(
          fallbackIndex++,
          allZones.length,
        );
      }
    }
    const occupied: any[] = [];
    const placeLabel = (
      x: number,
      y: number,
      text: string,
      font: string,
      baseY: number,
    ) => {
      ctx.font = font;
      const tw = ctx.measureText(text).width + 10,
        th = 15;
      const candidates = [
        [0, baseY],
        [0, baseY + 18],
        [0, baseY - 18],
        [tw / 2 + 8, baseY],
        [-tw / 2 - 8, baseY],
      ];
      for (const [ox, oy] of candidates) {
        const rx = x + ox - tw / 2,
          ry = y + oy - th,
          box = { x: rx, y: ry, w: tw, h: th };
        if (rx < 6 || rx + tw > w - 6 || ry < 6 || ry + th > h - 6) continue;
        if (
          !occupied.some(
            (b: any) =>
              box.x < b.x + b.w &&
              box.x + box.w > b.x &&
              box.y < b.y + b.h &&
              box.y + box.h > b.y,
          )
        ) {
          occupied.push(box);
          ctx.fillText(text, x + ox, y + oy);
          return;
        }
      }
      ctx.globalAlpha = 0.55;
      ctx.fillText(text, x, y + baseY);
      ctx.globalAlpha = 1;
    };
    for (const z of allZones) {
      const p = nodes[z.id] || fallbackNodes[z.id];
      if (!p) continue;
      const x = p[0] * w,
        y = p[1] * h,
        isCity = !!z.city,
        r = isCity ? 32 : 22;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      glow.addColorStop(0, isCity ? "#c39d5c33" : "#6f9aa333");
      glow.addColorStop(1, "#00000000");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a1116";
      ctx.strokeStyle = isCity ? "#c39d5c" : "#52737b";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isCity ? "#e5d3a6" : "#b6c3c7";
      ctx.textAlign = "center";
      placeLabel(x, y, z.name, "bold 13px system-ui", -r - 8);
      ctx.fillStyle = "#7e8e93";
      ctx.font = "9px system-ui";
      ctx.fillText(isCity ? "CITY" : "WILDERNESS", x, y + r + 14);
    }
    const partyMembers = (state.party?.members || []).filter(
      (m) => m.id !== state.player.id && m.online,
    );
    for (const m of partyMembers) {
      const pp = nodes[m.zone];
      if (!pp) continue;
      const x = pp[0] * w,
        y = pp[1] * h;
      ctx.save();
      ctx.fillStyle = "#69c9ef";
      ctx.strokeStyle = "#e5f7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 7, y + 6);
      ctx.lineTo(x - 7, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#bfeaff";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(m.name, x, y + 18);
      ctx.restore();
    }
    const p = nodes[state.player.zone];
    if (p) {
      ctx.fillStyle = "#fff1a6";
      ctx.strokeStyle = "#b78c43";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p[0] * w, p[1] * h, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#e6d7ba";
    ctx.font = "bold 18px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Ashenfall World", 18, 28);
    publishWorldMapLegend(
      "All regions • roads • connections • discovered locations",
    );
  }

  return {
    setWorldLayout(layout: any) {
      WORLD_LAYOUT = layout || {};
      invalidate();
    },
    getVisualAssets() {
      return visualAssets;
    },
    canvasLogicalSize: () => {
      sync();
      return canvasLogicalSize();
    },
    isSpriteClass: (id: string) => SPRITE_CLASSES.has(id),
    getZoomBounds() {
      return { min: MIN_ZOOM, max: MAX_ZOOM };
    },
    invalidate,
    loadVisualAssets,
    resizeWorldCanvas: () => {
      sync();
      return resizeWorldCanvas();
    },
    screenToWorld: (x: number, y: number) => {
      sync();
      return screenToWorld(x, y);
    },
    worldToScreen: (x: number, y: number) => {
      sync();
      return worldToScreen(x, y);
    },
    visibleFrac: () => {
      sync();
      return visibleFrac();
    },
    zoneWorldMeters: () => {
      sync();
      return zoneWorldMeters();
    },
    worldMetersForRenderRange: (m: number) => {
      sync();
      return worldMetersForRenderRange(m);
    },
    isClientBlocked: (zone: string, x: number, y: number) => {
      sync();
      return isClientBlocked(zone, x, y);
    },
    drawWorld: (t = performance.now()) => {
      sync();
      return drawWorld(t);
    },
    drawFallbackWorld: () => {
      const c = $("worldCanvas");
      const ctx = c?.getContext?.("2d");
      if (!ctx || !c) return;
      const { w, h } = canvasLogicalSize(),
        dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8f9aa0";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("World renderer recovering…", w / 2, h / 2);
    },
    drawMinimap: (force = false) => {
      sync();
      return drawMinimap(force);
    },
    drawWorldMap: () => {
      sync();
      return drawWorldMap();
    },
    getCamera() {
      return camera;
    },
    getMinimapZoom() {
      return minimapZoom;
    },
    setMinimapZoom(v: number) {
      minimapZoom = Math.max(
        MINIMAP_MIN_ZOOM,
        Math.min(MINIMAP_MAX_ZOOM, Number(v) || 1),
      );
      setLastMinimapSignature?.("");
    },
  };
}
