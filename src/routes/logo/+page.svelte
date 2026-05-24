<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import {
    createMetaballRenderer,
    METABALL_MAX_CLICK_BALLS,
    type Metaball,
    type MetaballRenderer,
  } from "./metaball-gl";
  import {
    anchorBaseFromBall,
    ballFromAnchor,
    canvasPointFromPointer,
    clampBallPosition,
    clampRadius,
    hitBall,
    jitterAmount01,
    newBallAnchor,
    type BallAnchor,
    type CanvasPoint,
  } from "./metaball-interaction";
  import { ensurePenStrokeFont } from "./pen-stroke-from-text";
  import {
    metaballsFromText,
    suggestTypeFontSize,
    type TextDotPlacementMode,
    typeFontSizeRange,
  } from "./text-to-metaballs";
  import { computeBallLinks, linksForShader } from "./ball-links";
  import {
    computeRemovalOrder,
    remapRemovalOrderAfterPoolIndexRemoved,
    visibleFromPool,
  } from "./ball-pool";
  import {
    DEFAULT_METABALL_FIELD_PARAMS,
    METABALL_FIELD_SLIDER,
    type MetaballFieldParams,
  } from "./metaball-params";
  import {
    scalePresetToCanvas,
    snapshotFromEditor,
    type LogoDotCurrent,
    type LogoDotPreset,
    type LogoDotPresetSummary,
  } from "./preset-types";
  import {
    clampTextLayerPosition,
    defaultLogoTextLayer,
    fontOptionLabel,
    fontWeightOptionLabel,
    LOGO_TEXT_FONT_OPTIONS,
    LOGO_TEXT_FONT_WEIGHT_OPTIONS,
    LOGO_TEXT_FONT_SIZE_MAX,
    LOGO_TEXT_FONT_SIZE_MIN,
    scaleTextLayersToCanvas,
    normalizeTextLayer,
    type LogoTextLayer,
  } from "./text-layer";

  const CLICK_R_MIN = 2;
  const CLICK_R_MAX = 72;
  const NOISE_AMOUNT_MAX = 0.6;
  const NOISE_AMOUNT_STEP = 0.01;
  const ADD_CLICK_MOVE_THRESHOLD = 4;
  const POSITION_JITTER_MAX = 100;
  const VIEW_ZOOM_MIN = 0.25;
  const VIEW_ZOOM_MAX = 8;
  const VIEW_ZOOM_STEP = 0.05;
  const AUTOSAVE_INTERVAL_MS = 5000;

  let stageEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let canvasWidth = $state(1);
  let canvasHeight = $state(1);
  /** Full layout; visibility is controlled by removalOrder + visible count. */
  let poolBallAnchors = $state<BallAnchor[]>([]);
  /** Pool indices in the order they are hidden when lowering visible %. */
  let ballRemovalOrder = $state<number[]>([]);
  /** Maps visible ballAnchors[i] → poolBallAnchors index. */
  let visiblePoolIndices = $state<number[]>([]);
  let ballAnchors = $state<BallAnchor[]>([]);
  let balls = $state<Metaball[]>([]);
  let ballRadius = $state(8);
  let positionJitter = $state(0);
  let typeText = $state("");
  let typeFontSize = $state(48);
  let typePlacementMode = $state<TextDotPlacementMode>("fill");

  const TYPE_PLACEMENT_LABELS: Record<TextDotPlacementMode, string> = {
    fill: "Fill (packed interior)",
    skeleton: "Pen strokes (minimal points)",
  };
  let noiseAmount = $state(0);
  let noiseSeed = $state(0);
  let glError = $state<string | null>(null);
  let atBallLimit = $state(false);
  let selectedIndex = $state<number | null>(null);
  let canvasCursor = $state("crosshair");
  let connectBalls = $state(true);
  let linkAllPairs = $state(false);
  let linkNeighborsPerBall = $state(2);
  let linkMaxDistance = $state(0);
  let linkDistanceThinning = $state(0.75);
  let settingsMinimized = $state(false);
  let presetSummaries = $state<LogoDotPresetSummary[]>([]);
  let selectedPresetId = $state("");
  let presetStatus = $state<string | null>(null);
  let presetBusy = $state(false);
  let draftRestoreStarted = false;
  let draftRestoreComplete = false;
  let lastAutosaveJson = "";
  let viewZoom = $state(1);
  let viewPanX = $state(0);
  let viewPanY = $state(0);
  let ballCountPercent = $state(100);
  let textLayers = $state<LogoTextLayer[]>([]);
  let selectedTextLayerId = $state<string | null>(null);
  let nextTextLayerId = 1;

  const ballPoolSize = $derived(poolBallAnchors.length);
  const selectedTextLayer = $derived(
    textLayers.find((layer) => layer.id === selectedTextLayerId) ?? null,
  );
  let metaThreshold = $state(DEFAULT_METABALL_FIELD_PARAMS.threshold);
  let metaAttraction = $state(DEFAULT_METABALL_FIELD_PARAMS.fieldStrength);
  let metaFalloff = $state(DEFAULT_METABALL_FIELD_PARAMS.falloffExponent);
  let metaMinDistance = $state(DEFAULT_METABALL_FIELD_PARAMS.minDistance);
  let metaNoiseMaskOuter = $state(DEFAULT_METABALL_FIELD_PARAMS.noiseMaskOuter);
  let metaNoiseMaskInner = $state(DEFAULT_METABALL_FIELD_PARAMS.noiseMaskInner);
  let metaBridgeStrength = $state(DEFAULT_METABALL_FIELD_PARAMS.bridgeStrength);
  let metaBridgeThinning = $state(DEFAULT_METABALL_FIELD_PARAMS.bridgeThinning);

  const fieldParams = $derived<MetaballFieldParams>({
    threshold: metaThreshold,
    fieldStrength: metaAttraction,
    falloffExponent: metaFalloff,
    minDistance: metaMinDistance,
    noiseMaskOuter: metaNoiseMaskOuter,
    noiseMaskInner: metaNoiseMaskInner,
    bridgeStrength: metaBridgeStrength,
    bridgeThinning: metaBridgeThinning,
  });

  const viewZoomPercent = $derived(Math.round(viewZoom * 100));

  const ballLinkSegments = $derived.by(() => {
    if (!connectBalls || balls.length < 2) return [];
    return computeBallLinks(balls, {
      canvasWidth,
      canvasHeight,
      topology: linkAllPairs ? "all-pairs" : "nearest",
      neighborsPerBall: linkNeighborsPerBall,
      maxLinkDistance: linkMaxDistance,
      distanceThinning: linkDistanceThinning,
      minStrokeWidth: 0.2,
      maxStrokeWidth: 1.25,
      baseStrokeOpacity: 0.22,
      bridgeStrength: fieldParams.bridgeStrength,
      bridgeThinning: fieldParams.bridgeThinning,
    });
  });

  const shaderBallLinks = $derived(
    connectBalls && fieldParams.bridgeStrength > 0
      ? linksForShader(ballLinkSegments)
      : [],
  );

  let renderer: MetaballRenderer | null = null;

  type DragMode =
    | {
        kind: "move";
        index: number;
        offsetX: number;
        offsetY: number;
      }
    | {
        kind: "resize";
        index: number;
      }
    | {
        kind: "pending-add";
        start: CanvasPoint;
      }
    | {
        kind: "pan";
        startClientX: number;
        startClientY: number;
        startPanX: number;
        startPanY: number;
      }
    | {
        kind: "text-move";
        layerId: string;
        offsetX: number;
        offsetY: number;
      };

  let drag: DragMode | null = null;

  function newTextLayerId(): string {
    const id = `text-${nextTextLayerId}`;
    nextTextLayerId += 1;
    return id;
  }

  function updateTextLayer(id: string, patch: Partial<LogoTextLayer>) {
    textLayers = textLayers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer));
  }

  function addTextLayer() {
    if (glError || canvasWidth < 1 || canvasHeight < 1) return;
    const id = newTextLayerId();
    textLayers = [...textLayers, defaultLogoTextLayer(canvasWidth, canvasHeight, id)];
    selectedTextLayerId = id;
    selectedIndex = null;
    void autosaveCurrentDraft();
  }

  function removeSelectedTextLayer() {
    if (!selectedTextLayerId) return;
    textLayers = textLayers.filter((layer) => layer.id !== selectedTextLayerId);
    selectedTextLayerId = textLayers[0]?.id ?? null;
    void autosaveCurrentDraft();
  }

  function onTextLayerPointerDown(event: PointerEvent, layerId: string) {
    const canvas = canvasEl;
    if (!canvas || glError) return;
    event.stopPropagation();
    event.preventDefault();
    const layer = textLayers.find((item) => item.id === layerId);
    if (!layer || layer.locked) return;
    selectedTextLayerId = layerId;
    selectedIndex = null;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPointFromPointer(event, canvas);
    drag = {
      kind: "text-move",
      layerId,
      offsetX: point.x - layer.x,
      offsetY: point.y - layer.y,
    };
    canvasCursor = "grabbing";
  }

  function syncBallCountPercent() {
    const pool = poolBallAnchors.length;
    ballCountPercent = pool === 0 ? 100 : Math.round((ballAnchors.length / pool) * 100);
  }

  function updateAtBallLimit() {
    atBallLimit = poolBallAnchors.length >= METABALL_MAX_CLICK_BALLS;
  }

  function applyVisibleCount(targetVisible: number) {
    const { anchors, poolIndices } = visibleFromPool(
      poolBallAnchors,
      ballRemovalOrder,
      targetVisible,
    );
    if (selectedIndex !== null) {
      const poolIdx = visiblePoolIndices[selectedIndex];
      if (poolIdx === undefined || !poolIndices.includes(poolIdx)) {
        selectedIndex = null;
      }
    }
    ballAnchors = anchors;
    visiblePoolIndices = poolIndices;
    rebuildBallsFromAnchors();
  }

  function setBallPool(anchors: BallAnchor[], visibleCount?: number) {
    poolBallAnchors = anchors.map((a) => ({ ...a }));
    ballRemovalOrder = computeRemovalOrder(poolBallAnchors);
    const n =
      visibleCount === undefined
        ? poolBallAnchors.length
        : Math.min(poolBallAnchors.length, Math.max(0, visibleCount));
    applyVisibleCount(n);
    syncBallCountPercent();
    updateAtBallLimit();
  }

  function clampViewZoom(zoom: number): number {
    return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, zoom));
  }

  function setActiveBallCount(target: number) {
    if (glError) return;
    const pool = poolBallAnchors.length;
    if (pool === 0) return;

    const n = Math.min(pool, Math.max(0, Math.floor(target)));
    if (n === ballAnchors.length) {
      updateAtBallLimit();
      return;
    }

    applyVisibleCount(n);
    updateAtBallLimit();
    drag = null;
    syncBallCountPercent();
  }

  function setBallCountFromPercent(percent: number) {
    const pool = poolBallAnchors.length;
    if (pool === 0) return;
    const pct = Math.min(100, Math.max(0, percent));
    ballCountPercent = pct;
    setActiveBallCount(Math.round((pct / 100) * pool));
  }

  function resetViewport() {
    viewZoom = 1;
    viewPanX = 0;
    viewPanY = 0;
  }

  function zoomAtStagePoint(
    stageX: number,
    stageY: number,
    nextZoom: number,
  ) {
    const zoom = clampViewZoom(nextZoom);
    const contentX = (stageX - viewPanX) / viewZoom;
    const contentY = (stageY - viewPanY) / viewZoom;
    viewPanX = stageX - contentX * zoom;
    viewPanY = stageY - contentY * zoom;
    viewZoom = zoom;
  }

  function onStageWheel(event: WheelEvent) {
    if (glError) return;
    const stage = stageEl;
    if (!stage) return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        "#logo-settings-panel, button, input, textarea, select, label",
      )
    ) {
      return;
    }

    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const stageX = event.clientX - rect.left;
    const stageY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAtStagePoint(stageX, stageY, viewZoom * factor);
  }

  function render() {
    renderer?.draw(
      balls,
      { amount: noiseAmount, seed: noiseSeed },
      fieldParams,
      shaderBallLinks,
    );
  }

  function applyFieldParams(params: MetaballFieldParams) {
    metaThreshold = params.threshold;
    metaAttraction = params.fieldStrength;
    metaFalloff = params.falloffExponent;
    metaMinDistance = params.minDistance;
    metaNoiseMaskOuter = params.noiseMaskOuter;
    metaNoiseMaskInner = params.noiseMaskInner;
    metaBridgeStrength = params.bridgeStrength;
    metaBridgeThinning = params.bridgeThinning;
  }

  function resetFieldParams() {
    applyFieldParams(DEFAULT_METABALL_FIELD_PARAMS);
  }

  function rebuildBallsFromAnchors() {
    const jitter = jitterAmount01(positionJitter, POSITION_JITTER_MAX);
    balls = ballAnchors.map((anchor) =>
      ballFromAnchor(anchor, jitter, canvasWidth, canvasHeight),
    );
  }

  function updateBall(index: number, patch: Partial<Metaball>) {
    balls = balls.map((b, i) => (i === index ? { ...b, ...patch } : b));
  }

  function commitAnchorFromBall(index: number): boolean {
    const ball = balls[index];
    const anchor = ballAnchors[index];
    const poolIdx = visiblePoolIndices[index];
    if (!ball || !anchor || poolIdx === undefined) return false;
    const jitter = jitterAmount01(positionJitter, POSITION_JITTER_MAX);
    const base = anchorBaseFromBall(ball, anchor, jitter);
    const updated = { ...anchor, x: base.x, y: base.y, r: ball.r };
    poolBallAnchors = poolBallAnchors.map((a, i) => (i === poolIdx ? updated : a));
    ballAnchors[index] = updated;
    return true;
  }

  /** Only when the Ball size slider moves — never on reload or preset restore. */
  function applyGlobalBallRadiusToAll() {
    if (poolBallAnchors.length === 0) return;
    poolBallAnchors = poolBallAnchors.map((a) => ({ ...a, r: ballRadius }));
    applyVisibleCount(ballAnchors.length);
  }

  function addBallAt(point: CanvasPoint) {
    if (poolBallAnchors.length >= METABALL_MAX_CLICK_BALLS) {
      atBallLimit = true;
      return;
    }
    atBallLimit = false;
    const anchor = newBallAnchor(point.x, point.y, ballRadius);
    const poolIdx = poolBallAnchors.length;
    poolBallAnchors = [...poolBallAnchors, anchor];
    ballRemovalOrder = [...ballRemovalOrder, poolIdx];
    applyVisibleCount(ballAnchors.length + 1);
    selectedIndex = visiblePoolIndices.indexOf(poolIdx);
    syncBallCountPercent();
  }

  function setCursorForPoint(point: CanvasPoint) {
    const hit = hitBall(point, balls);
    if (!hit) {
      canvasCursor = "crosshair";
      return;
    }
    canvasCursor = hit.kind === "resize" ? "nwse-resize" : "grab";
  }

  function onPointerDown(event: PointerEvent) {
    const canvas = canvasEl;
    if (!canvas || glError || !renderer) return;

    const panGesture = event.button === 1 || (event.button === 0 && event.altKey);
    if (panGesture) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drag = {
        kind: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: viewPanX,
        startPanY: viewPanY,
      };
      canvasCursor = "grabbing";
      return;
    }

    if (event.button !== 0) return;

    const point = canvasPointFromPointer(event, canvas);
    const hit = hitBall(point, balls);

    if (hit) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      selectedTextLayerId = null;
      selectedIndex = hit.index;
      const b = balls[hit.index];
      if (hit.kind === "move") {
        drag = {
          kind: "move",
          index: hit.index,
          offsetX: point.x - b.x,
          offsetY: point.y - b.y,
        };
        canvasCursor = "grabbing";
      } else {
        drag = { kind: "resize", index: hit.index };
        canvasCursor = "nwse-resize";
      }
      return;
    }

    drag = { kind: "pending-add", start: point };
    selectedIndex = null;
    selectedTextLayerId = null;
    canvasCursor = "crosshair";
  }

  function onPointerMove(event: PointerEvent) {
    const canvas = canvasEl;
    if (!canvas || glError || !renderer) return;
    const point = canvasPointFromPointer(event, canvas);

    if (!drag) {
      setCursorForPoint(point);
      return;
    }

    if (drag.kind === "pan") {
      viewPanX = drag.startPanX + (event.clientX - drag.startClientX);
      viewPanY = drag.startPanY + (event.clientY - drag.startClientY);
      return;
    }

    if (drag.kind === "move") {
      const b = balls[drag.index];
      const { x, y } = clampBallPosition(
        point.x - drag.offsetX,
        point.y - drag.offsetY,
        b.r,
        canvasWidth,
        canvasHeight,
      );
      updateBall(drag.index, { x, y });
      return;
    }

    if (drag.kind === "resize") {
      const b = balls[drag.index];
      const dist = Math.hypot(point.x - b.x, point.y - b.y);
      const r = clampRadius(dist, CLICK_R_MIN, CLICK_R_MAX);
      const { x, y } = clampBallPosition(b.x, b.y, r, canvasWidth, canvasHeight);
      updateBall(drag.index, { r, x, y });
      return;
    }

    if (drag.kind === "text-move") {
      const { x, y } = clampTextLayerPosition(
        point.x - drag.offsetX,
        point.y - drag.offsetY,
        canvasWidth,
        canvasHeight,
      );
      updateTextLayer(drag.layerId, { x, y });
      return;
    }
  }

  function onPointerUp(event: PointerEvent) {
    const canvas = canvasEl;
    if (!canvas) return;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (drag?.kind === "pending-add") {
      const point = canvasPointFromPointer(event, canvas);
      const moved = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
      if (moved < ADD_CLICK_MOVE_THRESHOLD) {
        addBallAt(point);
      }
    }

    if (drag?.kind === "move" || drag?.kind === "resize") {
      const committed = commitAnchorFromBall(drag.index);
      if (committed && drag.kind === "resize") {
        ballRadius = balls[drag.index]?.r ?? ballRadius;
        void autosaveCurrentDraft();
      }
    }

    if (drag?.kind === "text-move") {
      void autosaveCurrentDraft();
    }

    if (drag?.kind === "pan") {
      canvasCursor = "crosshair";
    }

    drag = null;
    if (canvas && !glError) {
      setCursorForPoint(canvasPointFromPointer(event, canvas));
    }
  }

  function onPointerCancel(event: PointerEvent) {
    onPointerUp(event);
  }

  function initRenderer() {
    const canvas = canvasEl;
    if (!canvas || canvasWidth < 1 || canvasHeight < 1) return;

    renderer?.dispose();
    renderer = null;

    try {
      renderer = createMetaballRenderer(canvas, canvasWidth, canvasHeight);
      glError = null;
      render();
    } catch (err) {
      glError = err instanceof Error ? err.message : "WebGL2 unavailable";
    }
  }

  function syncCanvasSize(rect: DOMRectReadOnly) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (w === canvasWidth && h === canvasHeight) return;

    const prevW = canvasWidth;
    const prevH = canvasHeight;
    if (poolBallAnchors.length > 0 && prevW > 1 && prevH > 1) {
      const sx = w / prevW;
      const sy = h / prevH;
      const scaleAnchor = (a: BallAnchor) => ({ ...a, x: a.x * sx, y: a.y * sy });
      poolBallAnchors = poolBallAnchors.map(scaleAnchor);
      applyVisibleCount(ballAnchors.length);
    }
    if (textLayers.length > 0 && prevW > 1 && prevH > 1) {
      textLayers = scaleTextLayersToCanvas(textLayers, w / prevW, h / prevH);
    }

    canvasWidth = w;
    canvasHeight = h;
    rebuildBallsFromAnchors();
  }

  $effect(() => {
    if (!canvasEl || canvasWidth < 1 || canvasHeight < 1) return;
    initRenderer();
  });

  onMount(() => {
    syncBallCountPercent();
    void refreshPresetList().catch((err) => {
      presetStatus = err instanceof Error ? err.message : "Could not load preset list";
    });
    void ensurePenStrokeFont();

    const autosaveTimer = window.setInterval(() => {
      void autosaveCurrentDraft();
    }, AUTOSAVE_INTERVAL_MS);

    const flushOnHide = () => {
      if (document.visibilityState === "hidden") void autosaveCurrentDraft();
    };
    document.addEventListener("visibilitychange", flushOnHide);

    return () => {
      window.clearInterval(autosaveTimer);
      document.removeEventListener("visibilitychange", flushOnHide);
      void autosaveCurrentDraft();
      renderer?.dispose();
      renderer = null;
    };
  });

  $effect(() => {
    if (canvasWidth > 1 && canvasHeight > 1 && !glError && !draftRestoreStarted) {
      void loadCurrentDraft();
    }
  });

  $effect(() => {
    const el = stageEl;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) syncCanvasSize(entry.contentRect);
    });
    ro.observe(el);
    syncCanvasSize(el.getBoundingClientRect());

    return () => ro.disconnect();
  });

  function layoutViewport() {
    const rect = stageEl?.getBoundingClientRect();
    const layoutW = rect?.width ?? 1;
    const layoutH = rect?.height ?? 1;
    const pixelScale = layoutW > 0 ? canvasWidth / layoutW : 1;
    return { layoutW, layoutH, pixelScale };
  }

  const typeFontBounds = $derived.by(() => {
    const { layoutW, layoutH } = layoutViewport();
    return typeFontSizeRange(layoutW, layoutH, typeText.trim().length || 1);
  });

  $effect(() => {
    const { min, max } = typeFontBounds;
    if (typeFontSize > max) typeFontSize = max;
    else if (typeFontSize < min) typeFontSize = min;
  });

  async function applyTypeText() {
    if (glError || !renderer) return;
    const trimmed = typeText.trim();
    if (!trimmed) return;
    const { layoutW, layoutH, pixelScale } = layoutViewport();
    try {
      const { balls: placed, placementRadius, fontSize } = await metaballsFromText({
        text: trimmed,
        width: canvasWidth,
        height: canvasHeight,
        layoutWidth: layoutW,
        layoutHeight: layoutH,
        pixelScale,
        ballRadius,
        fontSize: typeFontSize,
        maxBalls: METABALL_MAX_CLICK_BALLS,
        placementMode: typePlacementMode,
      });
      typeFontSize = fontSize;
      ballRadius = placementRadius;
      setBallPool(placed.map((b) => newBallAnchor(b.x, b.y, b.r)));
      selectedIndex = null;
      drag = null;
      if (typePlacementMode === "skeleton" && placed.length === 0) {
        presetStatus = "Pen strokes produced no points — try different text or use Fill mode.";
      }
    } catch (err) {
      presetStatus =
        err instanceof Error ? err.message : "Could not place text (pen stroke font failed to load)";
    }
  }

  function resetTypeFontSizeToFit() {
    const trimmed = typeText.trim();
    if (!trimmed) return;
    const { layoutW, layoutH } = layoutViewport();
    typeFontSize = suggestTypeFontSize(trimmed, layoutW, layoutH);
    applyTypeText();
  }

  function shuffleNoise() {
    if (glError || !renderer) return;
    noiseSeed = Math.random() * 1000;
  }

  const noisePercent = $derived(Math.round((noiseAmount / NOISE_AMOUNT_MAX) * 100));

  function clearCanvas() {
    if (glError || !renderer) return;
    poolBallAnchors = [];
    ballRemovalOrder = [];
    visiblePoolIndices = [];
    ballAnchors = [];
    balls = [];
    textLayers = [];
    selectedTextLayerId = null;
    noiseAmount = 0;
    noiseSeed = 0;
    atBallLimit = false;
    selectedIndex = null;
    drag = null;
    syncBallCountPercent();
  }

  function removeSelected() {
    if (selectedIndex === null) return;
    const poolIdx = visiblePoolIndices[selectedIndex];
    if (poolIdx === undefined) return;
    poolBallAnchors = poolBallAnchors.filter((_, i) => i !== poolIdx);
    ballRemovalOrder = remapRemovalOrderAfterPoolIndexRemoved(ballRemovalOrder, poolIdx);
    applyVisibleCount(Math.min(ballAnchors.length - 1, poolBallAnchors.length));
    selectedIndex = null;
    updateAtBallLimit();
    syncBallCountPercent();
  }

  function buildSnapshot() {
    return snapshotFromEditor({
      canvasWidth,
      canvasHeight,
      ballAnchors: poolBallAnchors,
      ballRadius,
      positionJitter,
      noiseAmount,
      noiseSeed,
      connectBalls,
      typeText,
      typeFontSize,
      typePlacementMode,
      textLayers,
      linkAllPairs,
      linkNeighborsPerBall,
      linkMaxDistance,
      linkDistanceThinning,
      fieldParams,
    });
  }

  async function refreshPresetList() {
    const res = await fetch("/api/logo/presets");
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Failed to list presets (${res.status})`);
    }
    const data = (await res.json()) as { presets: LogoDotPresetSummary[] };
    presetSummaries = data.presets;
  }

  async function savePreset() {
    if (glError || presetBusy) return;
    presetBusy = true;
    presetStatus = null;
    try {
      const res = await fetch("/api/logo/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSnapshot()),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Save failed (${res.status})`);
      }
      const data = (await res.json()) as { preset: { id: number } };
      await refreshPresetList();
      selectedPresetId = String(data.preset.id);
      presetStatus = `Saved named preset #${data.preset.id}`;
      lastAutosaveJson = JSON.stringify(buildSnapshot());
      void autosaveCurrentDraft();
    } catch (err) {
      presetStatus = err instanceof Error ? err.message : "Save failed";
    } finally {
      presetBusy = false;
    }
  }

  function applyEditorSnapshot(snapshot: Omit<LogoDotPreset, "id" | "savedAt">) {
    const scaled = scalePresetToCanvas(
      { ...snapshot, id: 0, savedAt: "" },
      canvasWidth,
      canvasHeight,
    );
    ballRadius = scaled.ballRadius;
    positionJitter = scaled.positionJitter;
    noiseAmount = scaled.noiseAmount;
    noiseSeed = scaled.noiseSeed;
    connectBalls = scaled.connectBalls;
    linkAllPairs = scaled.linkAllPairs ?? false;
    linkNeighborsPerBall = scaled.linkNeighborsPerBall ?? 2;
    linkMaxDistance = scaled.linkMaxDistance ?? 0;
    linkDistanceThinning = scaled.linkDistanceThinning ?? 0.75;
    typeText = scaled.typeText;
    typeFontSize = scaled.typeFontSize;
    typePlacementMode = scaled.typePlacementMode ?? "fill";
    applyFieldParams(scaled.fieldParams);
    setBallPool(scaled.ballAnchors);
    textLayers = (scaled.textLayers ?? []).map((layer) => normalizeTextLayer({ ...layer }));
    selectedTextLayerId = textLayers[0]?.id ?? null;
    selectedIndex = null;
    drag = null;
  }

  function applyPreset(preset: LogoDotPreset) {
    applyEditorSnapshot(preset);
  }

  async function autosaveCurrentDraft() {
    if (glError || presetBusy || !draftRestoreComplete) return;
    const payload = buildSnapshot();
    const json = JSON.stringify(payload);
    if (json === lastAutosaveJson) return;
    try {
      const res = await fetch("/api/logo/current", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: json,
        keepalive: true,
      });
      if (!res.ok) return;
      lastAutosaveJson = json;
    } catch {
      /* background save — do not touch editor state or status */
    }
  }

  async function loadCurrentDraft() {
    if (glError || draftRestoreStarted || canvasWidth < 1 || canvasHeight < 1) return;
    draftRestoreStarted = true;
    try {
      const res = await fetch("/api/logo/current");
      if (!res.ok) return;
      const data = (await res.json()) as { current: LogoDotCurrent | null };
      if (data.current) {
        applyEditorSnapshot(data.current);
        lastAutosaveJson = JSON.stringify(buildSnapshot());
      }
    } catch {
      /* keep whatever is on canvas */
    } finally {
      draftRestoreComplete = true;
    }
  }

  async function loadSelectedPreset() {
    if (glError || presetBusy || !selectedPresetId) return;
    const id = Number(selectedPresetId);
    if (!Number.isInteger(id) || id < 1) return;

    presetBusy = true;
    presetStatus = null;
    try {
      const res = await fetch(`/api/logo/presets/${id}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Load failed (${res.status})`);
      }
      const data = (await res.json()) as { preset: LogoDotPreset };
      applyPreset(data.preset);
      presetStatus = `Loaded preset #${id}`;
    } catch (err) {
      presetStatus = err instanceof Error ? err.message : "Load failed";
    } finally {
      presetBusy = false;
    }
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    if (selectedIndex === null) return;
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("input, textarea, select, button") || target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    removeSelected();
  }

  $effect(() => {
    if (!renderer || glError) return;
    balls;
    noiseAmount;
    noiseSeed;
    fieldParams;
    connectBalls;
    linkAllPairs;
    linkNeighborsPerBall;
    linkMaxDistance;
    linkDistanceThinning;
    ballLinkSegments;
    shaderBallLinks;
    render();
  });
</script>

<svelte:window onkeydown={onWindowKeyDown} />

<main class="bg-background fixed inset-0 z-0">
  <div
    bind:this={stageEl}
    class="absolute inset-0 overflow-hidden"
    onwheel={onStageWheel}
  >
    <div
      class="absolute top-0 left-0 size-full origin-top-left"
      style="transform: translate({viewPanX}px, {viewPanY}px) scale({viewZoom});"
    >
    <canvas
      bind:this={canvasEl}
      width={canvasWidth}
      height={canvasHeight}
      class="bg-background relative z-10 size-full touch-none select-none"
      style="cursor: {canvasCursor}"
      aria-label="Metaball logo canvas; click empty area to add, drag to move or resize"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerCancel}
      oncontextmenu={(e) => e.preventDefault()}
    ></canvas>
    {#if connectBalls && ballLinkSegments.length > 0}
      <svg
        class="pointer-events-none absolute inset-0 z-20 size-full text-foreground"
        viewBox="0 0 {canvasWidth} {canvasHeight}"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {#each ballLinkSegments as link, idx (idx)}
          <line
            x1={link.x1}
            y1={link.y1}
            x2={link.x2}
            y2={link.y2}
            stroke="currentColor"
            stroke-opacity={link.strokeOpacity}
            stroke-width={link.strokeWidth}
            vector-effect="non-scaling-stroke"
          />
        {/each}
      </svg>
    {/if}
    <div
      class="pointer-events-none absolute inset-0 z-25 size-full"
      aria-hidden={textLayers.length === 0}
    >
      {#each textLayers as layer (layer.id)}
        <div
          role="textbox"
          tabindex={layer.locked ? -1 : 0}
          class="absolute max-w-[min(90%,40rem)] text-foreground leading-tight whitespace-pre-wrap select-none {layer.locked
            ? 'pointer-events-none'
            : 'pointer-events-auto cursor-grab active:cursor-grabbing'} {!layer.locked &&
          selectedTextLayerId === layer.id
            ? 'rounded-sm ring-2 ring-foreground/50'
            : ''}"
          style="left: {(layer.x / canvasWidth) * 100}%; top: {(layer.y / canvasHeight) *
            100}%; font-size: {layer.fontSize}px; font-family: {layer.fontFamily}; font-weight: {layer.fontWeight}; transform: translate(-50%, -50%);"
          onpointerdown={(event) => onTextLayerPointerDown(event, layer.id)}
        >
          {layer.text || " "}
        </div>
      {/each}
    </div>
    {#if selectedIndex !== null && balls[selectedIndex]}
      {@const b = balls[selectedIndex]}
      <div
        class="pointer-events-none absolute z-30 rounded-full border border-dashed border-foreground/35"
        style="left: {(b.x / canvasWidth) * 100}%; top: {(b.y / canvasHeight) * 100}%; width: {(b.r *
          2) /
          canvasWidth *
          100}%; height: {(b.r * 2) / canvasHeight * 100}%; transform: translate(-50%, -50%);"
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute z-30 size-2 rounded-full bg-foreground/70 ring-2 ring-background"
        style="left: {((b.x + b.r) / canvasWidth) * 100}%; top: {(b.y / canvasHeight) *
          100}%; transform: translate(-50%, -50%);"
        aria-hidden="true"
        title="Resize handle"
      ></div>
    {/if}
    </div>
  </div>

  {#if settingsMinimized}
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="border-border/80 bg-background/88 pointer-events-auto absolute top-4 left-4 z-30 shadow-lg backdrop-blur-md"
      onclick={() => {
        settingsMinimized = false;
      }}
      aria-expanded={false}
      aria-controls="logo-settings-panel"
    >
      Settings
    </Button>
  {:else}
  <div
    id="logo-settings-panel"
    class="border-border/80 bg-background/88 pointer-events-auto absolute top-4 left-4 z-30 max-h-[min(72dvh,calc(100dvh-2rem))] w-[min(100%-2rem,26rem)] overflow-y-auto rounded-lg border p-4 shadow-lg backdrop-blur-md"
  >
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-medium">Settings</h2>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs"
        onclick={() => {
          settingsMinimized = true;
        }}
        aria-expanded={true}
        aria-controls="logo-settings-panel"
      >
        Minimize
      </Button>
    </div>
    <div class="flex flex-col gap-3">
      <div class="flex w-full flex-col gap-2">
      <Label for="type-text" class="text-xs">Type tool</Label>
      <div class="flex gap-2">
        <Input
          id="type-text"
          type="text"
          placeholder="Enter text…"
          bind:value={typeText}
          disabled={!!glError}
          autocapitalize="off"
          autocomplete="off"
          spellcheck={false}
          class="text-xs"
          style="text-transform: none;"
          onkeydown={(e) => {
            if (e.key === "Enter") applyTypeText();
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          class="shrink-0"
          onclick={applyTypeText}
          disabled={!!glError || typeText.trim().length === 0}
        >
          Place text
        </Button>
      </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="type-placement-mode" class="text-xs">Text dot style</Label>
        <Select.Root
          type="single"
          bind:value={typePlacementMode}
          onValueChange={() => {
            if (typeText.trim()) applyTypeText();
          }}
        >
          <Select.Trigger id="type-placement-mode" class="w-full text-xs">
            {TYPE_PLACEMENT_LABELS[typePlacementMode]}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="fill">{TYPE_PLACEMENT_LABELS.fill}</Select.Item>
            <Select.Item value="skeleton">{TYPE_PLACEMENT_LABELS.skeleton}</Select.Item>
          </Select.Content>
        </Select.Root>
        <p class="text-muted-foreground text-[0.65rem] leading-snug">
          Fill packs dots inside each letter. Pen strokes uses corner points plus extra dots along each
          stroke segment. Connect balls to join the path.
        </p>
      </div>
      <div class="border-border/60 flex flex-col gap-2 rounded-md border p-3">
        <p class="text-xs font-medium">Text overlay</p>
        <p class="text-muted-foreground text-[0.65rem] leading-snug">
          Normal text on top of the metaballs. Drag on the canvas to position; separate from the dot
          type tool above.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onclick={addTextLayer}
            disabled={!!glError}
          >
            Add text
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={removeSelectedTextLayer}
            disabled={!!glError || !selectedTextLayer}
          >
            Remove
          </Button>
        </div>
        {#if textLayers.length > 1}
          <div class="flex flex-col gap-1">
            <Label for="text-layer-select" class="text-xs">Active layer</Label>
            <select
              id="text-layer-select"
              bind:value={selectedTextLayerId}
              disabled={!!glError}
              class="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
            >
              {#each textLayers as layer, index (layer.id)}
                <option value={layer.id}>
                  Layer {index + 1}{layer.locked ? " (locked)" : ""}
                  {layer.text.trim() ? ` — ${layer.text.trim().slice(0, 24)}` : ""}
                </option>
              {/each}
            </select>
          </div>
        {/if}
        {#if selectedTextLayer}
          <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={selectedTextLayer.locked}
              disabled={!!glError}
              class="accent-foreground size-3.5 rounded border"
              onchange={(event) => {
                updateTextLayer(selectedTextLayer.id, {
                  locked: event.currentTarget.checked,
                });
                if (event.currentTarget.checked && drag?.kind === "text-move") {
                  drag = null;
                }
                void autosaveCurrentDraft();
              }}
            />
            Lock (not selectable on canvas)
          </label>
          <div class="flex flex-col gap-1.5">
            <Label for="overlay-text-content" class="text-xs">Text</Label>
            <textarea
              id="overlay-text-content"
              rows={3}
              value={selectedTextLayer.text}
              disabled={!!glError}
              class="border-input bg-background w-full resize-y rounded-md border px-2 py-1.5 text-xs"
              oninput={(event) => {
                updateTextLayer(selectedTextLayer.id, {
                  text: event.currentTarget.value,
                });
              }}
              onchange={() => {
                void autosaveCurrentDraft();
              }}
            ></textarea>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="overlay-text-font" class="text-xs">Font</Label>
            <Select.Root
              type="single"
              value={selectedTextLayer.fontFamily}
              onValueChange={(value) => {
                if (!value || !selectedTextLayer) return;
                updateTextLayer(selectedTextLayer.id, { fontFamily: value });
                void autosaveCurrentDraft();
              }}
            >
              <Select.Trigger id="overlay-text-font" class="w-full text-xs">
                {fontOptionLabel(selectedTextLayer.fontFamily)}
              </Select.Trigger>
              <Select.Content>
                {#each LOGO_TEXT_FONT_OPTIONS as option (option.value)}
                  <Select.Item value={option.value}>{option.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="overlay-text-weight" class="text-xs">Weight</Label>
            <Select.Root
              type="single"
              value={String(selectedTextLayer.fontWeight)}
              onValueChange={(value) => {
                if (!value || !selectedTextLayer) return;
                updateTextLayer(selectedTextLayer.id, { fontWeight: Number(value) });
                void autosaveCurrentDraft();
              }}
            >
              <Select.Trigger id="overlay-text-weight" class="w-full text-xs">
                {fontWeightOptionLabel(selectedTextLayer.fontWeight)}
              </Select.Trigger>
              <Select.Content>
                {#each LOGO_TEXT_FONT_WEIGHT_OPTIONS as option (option.value)}
                  <Select.Item value={String(option.value)}>{option.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="overlay-text-size" class="text-xs">
              Size ({Math.round(selectedTextLayer.fontSize)}px)
            </Label>
            <input
              id="overlay-text-size"
              type="range"
              min={LOGO_TEXT_FONT_SIZE_MIN}
              max={LOGO_TEXT_FONT_SIZE_MAX}
              step={1}
              value={Math.round(selectedTextLayer.fontSize)}
              disabled={!!glError}
              class="accent-foreground w-full"
              oninput={(event) => {
                updateTextLayer(selectedTextLayer.id, {
                  fontSize: Number(event.currentTarget.value),
                });
              }}
              onchange={() => {
                void autosaveCurrentDraft();
              }}
            />
          </div>
        {:else}
          <p class="text-muted-foreground text-xs">Add text to place a layer you can drag on the canvas.</p>
        {/if}
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <Label for="type-font-size" class="text-xs">Font size ({typeFontSize}px)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            onclick={resetTypeFontSizeToFit}
            disabled={!!glError || typeText.trim().length === 0}
          >
            Auto fit
          </Button>
        </div>
        <input
          id="type-font-size"
          type="range"
          min={typeFontBounds.min}
          max={typeFontBounds.max}
          step={1}
          bind:value={typeFontSize}
          disabled={!!glError || typeText.trim().length === 0}
          class="accent-foreground w-full"
          onchange={() => {
            if (typeText.trim()) applyTypeText();
          }}
        />
      </div>
      <div class="flex flex-wrap items-end justify-center gap-3">
      <div class="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label for="ball-radius" class="text-xs">
          Ball size ({ballRadius}px) — slider sets all; drag a ball edge for one-off size
        </Label>
        <input
          id="ball-radius"
          type="range"
          min={CLICK_R_MIN}
          max={CLICK_R_MAX}
          step={1}
          bind:value={ballRadius}
          oninput={applyGlobalBallRadiusToAll}
          class="accent-foreground w-full"
        />
      </div>
      <div class="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label for="position-jitter" class="text-xs">Position jitter ({positionJitter}%)</Label>
        <input
          id="position-jitter"
          type="range"
          min={0}
          max={POSITION_JITTER_MAX}
          step={1}
          bind:value={positionJitter}
          disabled={!!glError}
          class="accent-foreground w-full"
        />
      </div>
      <div class="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label for="noise-amount" class="text-xs">Noise amount ({noisePercent}%)</Label>
        <input
          id="noise-amount"
          type="range"
          min={0}
          max={NOISE_AMOUNT_MAX}
          step={NOISE_AMOUNT_STEP}
          bind:value={noiseAmount}
          disabled={!!glError}
          class="accent-foreground w-full"
        />
      </div>
      </div>
      <div class="border-border/60 flex flex-col gap-2 rounded-md border p-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium">Metaball field</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            onclick={resetFieldParams}
            disabled={!!glError}
          >
            Reset field
          </Button>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-attraction" class="text-xs">
            Attraction ({metaAttraction.toFixed(2)})
          </Label>
          <input
            id="meta-attraction"
            type="range"
            min={METABALL_FIELD_SLIDER.fieldStrength.min}
            max={METABALL_FIELD_SLIDER.fieldStrength.max}
            step={METABALL_FIELD_SLIDER.fieldStrength.step}
            bind:value={metaAttraction}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-falloff" class="text-xs">Falloff ({metaFalloff.toFixed(1)})</Label>
          <input
            id="meta-falloff"
            type="range"
            min={METABALL_FIELD_SLIDER.falloffExponent.min}
            max={METABALL_FIELD_SLIDER.falloffExponent.max}
            step={METABALL_FIELD_SLIDER.falloffExponent.step}
            bind:value={metaFalloff}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-threshold" class="text-xs">
            Surface threshold ({metaThreshold.toFixed(2)})
          </Label>
          <input
            id="meta-threshold"
            type="range"
            min={METABALL_FIELD_SLIDER.threshold.min}
            max={METABALL_FIELD_SLIDER.threshold.max}
            step={METABALL_FIELD_SLIDER.threshold.step}
            bind:value={metaThreshold}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-min-distance" class="text-xs">
            Core cutoff ({metaMinDistance.toFixed(2)}px)
          </Label>
          <input
            id="meta-min-distance"
            type="range"
            min={METABALL_FIELD_SLIDER.minDistance.min}
            max={METABALL_FIELD_SLIDER.minDistance.max}
            step={METABALL_FIELD_SLIDER.minDistance.step}
            bind:value={metaMinDistance}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-noise-outer" class="text-xs">
            Noise reach ({metaNoiseMaskOuter.toFixed(2)}× radius)
          </Label>
          <input
            id="meta-noise-outer"
            type="range"
            min={METABALL_FIELD_SLIDER.noiseMaskOuter.min}
            max={METABALL_FIELD_SLIDER.noiseMaskOuter.max}
            step={METABALL_FIELD_SLIDER.noiseMaskOuter.step}
            bind:value={metaNoiseMaskOuter}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="meta-noise-inner" class="text-xs">
            Noise core ({metaNoiseMaskInner.toFixed(2)}× radius)
          </Label>
          <input
            id="meta-noise-inner"
            type="range"
            min={METABALL_FIELD_SLIDER.noiseMaskInner.min}
            max={METABALL_FIELD_SLIDER.noiseMaskInner.max}
            step={METABALL_FIELD_SLIDER.noiseMaskInner.step}
            bind:value={metaNoiseMaskInner}
            disabled={!!glError}
            class="accent-foreground w-full"
          />
        </div>
        <p class="text-muted-foreground text-xs">
          Attraction and falloff control how balls merge. Threshold sets blob size. Noise sliders
          apply when noise amount is above zero.
        </p>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="ball-count" class="text-xs">
          Visible balls — {ballCountPercent}% ({ballAnchors.length} of {ballPoolSize}
          {#if ballPoolSize < METABALL_MAX_CLICK_BALLS}
            , max {METABALL_MAX_CLICK_BALLS}
          {/if})
        </Label>
        <input
          id="ball-count"
          type="range"
          min={0}
          max={100}
          step={1}
          bind:value={ballCountPercent}
          disabled={!!glError || ballPoolSize === 0}
          class="accent-foreground w-full"
          oninput={() => setBallCountFromPercent(ballCountPercent)}
        />
        <p class="text-muted-foreground text-xs">
          100% shows every ball in the current layout. Lower values hide balls in a fixed random
          order for this layout (same positions when you raise it again). New clicks add to the pool
          (up to {METABALL_MAX_CLICK_BALLS} total).
        </p>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <Label for="view-zoom" class="text-xs">Canvas zoom ({viewZoomPercent}%)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            onclick={resetViewport}
            disabled={viewZoom === 1 && viewPanX === 0 && viewPanY === 0}
          >
            Reset view
          </Button>
        </div>
        <input
          id="view-zoom"
          type="range"
          min={VIEW_ZOOM_MIN}
          max={VIEW_ZOOM_MAX}
          step={VIEW_ZOOM_STEP}
          value={viewZoom}
          disabled={!!glError}
          class="accent-foreground w-full"
          oninput={(e) => {
            const stage = stageEl;
            const next = clampViewZoom(Number(e.currentTarget.value));
            if (stage) {
              const rect = stage.getBoundingClientRect();
              zoomAtStagePoint(rect.width / 2, rect.height / 2, next);
            } else {
              viewZoom = next;
            }
          }}
        />
      </div>
      <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        bind:checked={connectBalls}
        disabled={!!glError}
        class="accent-foreground size-3.5 rounded border"
      />
      Connect balls
      </label>
      {#if connectBalls}
        <div class="border-border/60 flex flex-col gap-2 rounded-md border p-3">
          <p class="text-xs font-medium">Distance-based links</p>
          <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              bind:checked={linkAllPairs}
              disabled={!!glError}
              class="accent-foreground size-3.5 rounded border"
            />
            All pairs (dense; lines cross through the middle)
          </label>
          {#if !linkAllPairs}
            <div class="flex flex-col gap-1.5">
              <Label for="link-neighbors" class="text-xs">
                Neighbors per ball ({linkNeighborsPerBall})
              </Label>
              <input
                id="link-neighbors"
                type="range"
                min={1}
                max={6}
                step={1}
                bind:value={linkNeighborsPerBall}
                disabled={!!glError || balls.length < 3}
                class="accent-foreground w-full"
              />
            </div>
          {/if}
          <div class="flex flex-col gap-1.5">
            <Label for="link-max-distance" class="text-xs">
              Max link distance ({linkMaxDistance <= 0 ? "unlimited" : `${Math.round(linkMaxDistance * 100)}% ref`})
            </Label>
            <input
              id="link-max-distance"
              type="range"
              min={METABALL_FIELD_SLIDER.linkMaxDistance.min}
              max={METABALL_FIELD_SLIDER.linkMaxDistance.max}
              step={METABALL_FIELD_SLIDER.linkMaxDistance.step}
              bind:value={linkMaxDistance}
              disabled={!!glError}
              class="accent-foreground w-full"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="link-distance-thinning" class="text-xs">
              Line thinning ({linkDistanceThinning.toFixed(2)})
            </Label>
            <input
              id="link-distance-thinning"
              type="range"
              min={METABALL_FIELD_SLIDER.linkDistanceThinning.min}
              max={METABALL_FIELD_SLIDER.linkDistanceThinning.max}
              step={METABALL_FIELD_SLIDER.linkDistanceThinning.step}
              bind:value={linkDistanceThinning}
              disabled={!!glError}
              class="accent-foreground w-full"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="meta-bridge-strength" class="text-xs">
              Metaball bridges ({metaBridgeStrength.toFixed(2)})
            </Label>
            <input
              id="meta-bridge-strength"
              type="range"
              min={METABALL_FIELD_SLIDER.bridgeStrength.min}
              max={METABALL_FIELD_SLIDER.bridgeStrength.max}
              step={METABALL_FIELD_SLIDER.bridgeStrength.step}
              bind:value={metaBridgeStrength}
              disabled={!!glError}
              class="accent-foreground w-full"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="meta-bridge-thinning" class="text-xs">
              Bridge thinning ({metaBridgeThinning.toFixed(2)})
            </Label>
            <input
              id="meta-bridge-thinning"
              type="range"
              min={METABALL_FIELD_SLIDER.bridgeThinning.min}
              max={METABALL_FIELD_SLIDER.bridgeThinning.max}
              step={METABALL_FIELD_SLIDER.bridgeThinning.step}
              bind:value={metaBridgeThinning}
              disabled={!!glError || metaBridgeStrength <= 0}
              class="accent-foreground w-full"
            />
          </div>
          <p class="text-muted-foreground text-xs">
            By default each ball links to its nearest neighbors (not every other ball). Use max link
            distance to drop connections beyond that length while still targeting the neighbor count.
            Far links are drawn longer and thinner. Metaball bridges add faint merged tubes (best with
            lower surface threshold).
          </p>
        </div>
      {/if}
      <div class="border-border/60 flex flex-col gap-2 rounded-md border p-3">
        <p class="text-xs font-medium">Saved dot layouts</p>
        <p class="text-muted-foreground text-xs">
          Your work autosaves every {AUTOSAVE_INTERVAL_MS / 1000}s to
          <code class="text-[0.7rem]">data/logo-dot-current.json</code> and restores after a dev reload.
          Use <strong class="font-medium">Save named preset</strong> to keep a numbered snapshot in
          <code class="text-[0.7rem]">data/logo-dot-presets.json</code>.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onclick={savePreset}
            disabled={!!glError || presetBusy}
          >
            Save named preset
          </Button>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <div class="flex min-w-40 flex-1 flex-col gap-1">
            <Label for="preset-select" class="text-xs">Load preset</Label>
            <select
              id="preset-select"
              bind:value={selectedPresetId}
              disabled={!!glError || presetBusy || presetSummaries.length === 0}
              class="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
            >
              <option value="">Select preset…</option>
              {#each presetSummaries as summary (summary.id)}
                <option value={String(summary.id)}>
                  #{summary.id} · {summary.ballCount} balls · {new Date(
                    summary.savedAt,
                  ).toLocaleString()}
                </option>
              {/each}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            onclick={loadSelectedPreset}
            disabled={!!glError || presetBusy || !selectedPresetId}
          >
            Load
          </Button>
        </div>
        {#if presetStatus}
          <p class="text-muted-foreground text-xs">{presetStatus}</p>
        {/if}
      </div>
      <div class="flex flex-wrap justify-center gap-3">
      <Button type="button" variant="outline" size="sm" onclick={shuffleNoise} disabled={!!glError}>
        Shuffle noise pattern
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onclick={removeSelected}
        disabled={!!glError || selectedIndex === null}
      >
        Remove selected
      </Button>
      <Button type="button" variant="ghost" size="sm" onclick={clearCanvas} disabled={!!glError}>
        Clear
      </Button>
      </div>

      {#if glError}
        <p class="text-destructive text-xs">{glError}</p>
      {:else}
        <p class="text-muted-foreground text-xs">
          Scroll on the canvas to zoom toward the cursor. Alt-drag or middle-drag to pan. Ball size
          and jitter update all balls. Noise appears only near balls.
          {#if atBallLimit}
            <span class="text-destructive">
              Ball pool limit ({METABALL_MAX_CLICK_BALLS}) reached.
            </span>
          {/if}
        </p>
      {/if}
    </div>
  </div>
  {/if}
</main>
