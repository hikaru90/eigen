<script lang="ts">
  import type { PageData } from "./$types";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Card from "$lib/components/ui/card";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Drawer from "$lib/components/ui/drawer";
  import * as Select from "$lib/components/ui/select";
  import {
    nodeFillForGraph,
    customEntityFillsFromLegendSections,
    filterNodesByEntityTypes,
  } from "$lib/graph/graph-ontology-legend";
  import { filterGraphVizEdgesToNodes, resolveForceLinks } from "$lib/graph/sanitize-viz-snapshot";
  import {
    COMMUNITY_HULL_GRADIENT,
    communityCircleFromPositions,
    communityGradientId,
    communityHullChromeStyleForLevel,
    communityHullFill,
    communityHullFillOpacityForZoom,
  } from "$lib/graph/community-hull";
  import {
    canonicalCommunityLevels,
    COMMUNITY_LEAF_LEVEL,
  } from "$lib/graph/community-levels";
  import {
    deleteGraphEntity,
    deleteGraphThought,
    fetchEntityCaptures,
    fetchEntityForGraphEdit,
    fetchThoughtForGraphEdit,
    submitGraphThoughtEdit,
    submitGraphThoughtRelink,
    syncGraphEntity,
    updateGraphEntity,
  } from "$lib/graph/graph-edit-api";
  import type {
    EntityCaptureRow,
    GraphEntityEditorStored,
    GraphThoughtEditorStored,
  } from "$lib/graph/graph-page-types";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import X from "@lucide/svelte/icons/x";
  import { CAPTURE_INGEST_PHASE_COPY, type CaptureIngestPhase } from "$lib/capture/ingest-phases";
  import { pollUntilEnrichmentComplete } from "$lib/capture/poll-enrichment";
  import { subscribeCaptureQueue } from "$lib/capture/queue";
  import { pollGraphEnrichRefresh } from "$lib/graph/poll-graph-enrich-refresh";
  import EmbeddingMap from "./EmbeddingMap.svelte";
  import TemporalEvents from "./TemporalEvents.svelte";
  import GraphFiltersToolbar from "./graph-filters-toolbar.svelte";
  import GraphEntityKindsLegend from "./graph-entity-kinds-legend.svelte";
  import type { EmbeddingSnapshotItem } from "../api/embeddings/snapshot/+server";
  import type { TemporalEventListItem } from "../api/temporal-events/+server";

  let { data }: { data: PageData } = $props();

  /** Live prop accessors for D3 callbacks created in onMount (avoids stale snapshot closures). */
  const vizCtx = {
    get snapshot() {
      return data.snapshot;
    },
    get communities() {
      return data.communities ?? [];
    },
    get legendSections() {
      return data.graphLegendSections ?? [];
    },
    get selectedCommunityLevel(): number | null {
      const parsed = Number.parseInt(communityLevel, 10);
      return Number.isFinite(parsed) ? parsed : null;
    },
  };

  /** Which tab is visible: graph, embedding map, or temporal events timeline. */
  let activeTab = $state<"graph" | "embeddings" | "temporal">("graph");
  /** Mount embedding map only after first visit so projection runs in a sized panel. */
  let embeddingsTabOpened = $state(false);
  let selectedTemporalId = $state<string | null>(null);
  const initialTemporalEventId = $derived(page.url.searchParams.get("event"));

  $effect(() => {
    if (activeTab === "embeddings") embeddingsTabOpened = true;
  });

  onMount(() => {
    const tab = page.url.searchParams.get("tab");
    if (tab === "temporal") activeTab = "temporal";
    const eventId = page.url.searchParams.get("event");
    if (eventId) selectedTemporalId = eventId;
  });

  const legendSections = $derived(data.graphLegendSections ?? []);
  const ontologyEntityKindSelectOptions = $derived.by(() => {
    const sec = legendSections.find((s) => s.title === "Your ontology: entity kinds");
    return (
      sec?.items.map((i) => ({
        value: i.key.replace(/^onto-entity-/, ""),
        label: i.label,
      })) ?? []
    );
  });

  let rootEl: HTMLDivElement | undefined;
  let search = $state("");
  let edgeKind = $state<string>("all");
  let visibleEntityTypes = $state<Set<string>>(new Set());
  let communityLevel = $state<string>(String(COMMUNITY_LEAF_LEVEL));
  let status = $state<string>("");
  let graphStats = $state<string>("");
  let scheduleGraphUpdate: (() => void) | null = null;
  let scheduleGraphResize: (() => void) | null = null;
  let scheduleGraphRelayout: (() => void) | null = null;
  let scheduleApplyHighlight: ((id: string | null) => void) | null = null;
  let scheduleRestorePreEntityZoom: (() => void) | null = null;
  let schedulePreserveGraphZoom: (() => void) | null = null;
  let scheduleMarkEnrichGraphUpdate: (() => void) | null = null;
  let scheduleUpdateCommunityHulls: (() => void) | null = null;
  /** Entity node ids that should pop in on the next graph paint after tier-2 enrich. */
  let pendingPopInNodeIds = new Set<string>();
  let entityIdsBeforeEnrichRefresh: Set<string> | null = null;
  let selectedNode = $state<(typeof data.snapshot.nodes)[number] | null>(null);
  let selectedCommunityId = $state<string | null>(null);
  let nodeDrawerOpen = $state(false);

  const selectedCommunity = $derived.by(() => {
    if (!selectedCommunityId) return null;
    return (data.communities ?? []).find((c) => c.id === selectedCommunityId) ?? null;
  });

  $effect(() => {
    nodeDrawerOpen =
      (selectedNode !== null || selectedCommunity !== null) && activeTab !== "temporal";
  });

  function onNodeDrawerOpenChange(open: boolean) {
    if (!open) {
      selectedNode = null;
      selectedCommunityId = null;
    }
  }

  /** Convert an embedding-map dot click into the same selectedNode shape so the detail panel works for both tabs. */
  function handleEmbeddingSelect(item: EmbeddingSnapshotItem | null) {
    if (!item) {
      selectedNode = null;
      return;
    }
    selectedTemporalId = null;
    selectedNode = { id: item.id, kind: item.kind, label: item.label, subtype: item.subtype };
  }

  function handleTemporalSelect(item: TemporalEventListItem | null) {
    selectedTemporalId = item?.id ?? null;
    if (item) selectedNode = null;
  }

  $effect(() => {
    if (activeTab === "temporal") return;
    selectedTemporalId = null;
  });

  let thoughtEditorLoadSeq = 0;
  let thoughtEditorLoading = $state(false);
  let thoughtEditorDraft = $state("");
  let thoughtEditorErr = $state<string | null>(null);
  let thoughtEditorBusy = $state(false);
  let thoughtEditorRelinkBusy = $state(false);
  let thoughtEditorDeleteBusy = $state(false);
  let thoughtEditorPhase = $state<CaptureIngestPhase | null>(null);
  let thoughtEditorStored = $state<GraphThoughtEditorStored | null>(null);

  function thoughtLifecycleStatus(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== "object") return null;
    const s = (metadata as { status?: unknown }).status;
    return typeof s === "string" ? s : null;
  }
  let entityCaptures = $state<EntityCaptureRow[]>([]);
  let entityCapturesLoading = $state(false);
  let entityCapturesErr = $state<string | null>(null);
  let entityCapturesLoadSeq = 0;
  /** Postgres capture being edited from the entity detail panel (not a graph node). */
  let editingThoughtId = $state<string | null>(null);
  let entityEditorLoadSeq = 0;
  let entityEditorLoading = $state(false);
  let entityEditorDraft = $state("");
  let entityEditorEntityType = $state("");
  let entityEditorErr = $state<string | null>(null);
  let entityEditorBusy = $state(false);
  let entityEditorSyncBusy = $state(false);
  let entityEditorDeleteBusy = $state(false);
  let entityEditorStored = $state<GraphEntityEditorStored | null>(null);
  let graphDeleteDialogOpen = $state(false);
  let graphDeleteTarget = $state<"thought" | "entity" | null>(null);

  const graphDeleteDialogCopy = $derived.by(() => {
    if (graphDeleteTarget === "entity") {
      return {
        title: "Delete this entity?",
        description:
          "It will be removed from the graph and canonical store permanently. This cannot be undone.",
      };
    }
    return {
      title: "Delete this capture?",
      description:
        "It will be removed from search and the graph permanently. This cannot be undone.",
    };
  });

  const graphDeleteBusy = $derived(thoughtEditorDeleteBusy || entityEditorDeleteBusy);

  const thoughtIngestStatus = $derived(
    thoughtEditorPhase
      ? CAPTURE_INGEST_PHASE_COPY[thoughtEditorPhase]
      : {
          title: "Working…",
          description: "Running the same ingest steps as on Capture.",
        },
  );

  $effect(() => {
    const id = editingThoughtId;
    if (!id) {
      thoughtEditorDraft = "";
      thoughtEditorErr = null;
      thoughtEditorStored = null;
      thoughtEditorLoading = false;
      return;
    }
    const seq = ++thoughtEditorLoadSeq;
    thoughtEditorLoading = true;
    thoughtEditorErr = null;
    thoughtEditorDraft = "";
    thoughtEditorStored = null;
    void (async () => {
      try {
        const row = await fetchThoughtForGraphEdit(id);
        if (seq !== thoughtEditorLoadSeq) return;
        thoughtEditorDraft = row.rawText;
        thoughtEditorStored = {
          id: row.id,
          rawText: row.rawText,
          normalizedText: row.normalizedText,
          category: row.category,
        };
      } catch (e) {
        if (seq !== thoughtEditorLoadSeq) return;
        thoughtEditorErr = e instanceof Error ? e.message : String(e);
      } finally {
        if (seq === thoughtEditorLoadSeq) thoughtEditorLoading = false;
      }
    })();
  });

  $effect(() => {
    const n = selectedNode;
    editingThoughtId = null;
    if (!n || n.kind !== "Entity") {
      entityEditorDraft = "";
      entityEditorEntityType = "";
      entityEditorErr = null;
      entityEditorStored = null;
      entityEditorLoading = false;
      entityCaptures = [];
      entityCapturesErr = null;
      entityCapturesLoading = false;
      return;
    }
    const id = n.id;
    const captureSeq = ++entityCapturesLoadSeq;
    entityCapturesLoading = true;
    entityCapturesErr = null;
    entityCaptures = [];
    void (async () => {
      try {
        entityCaptures = await fetchEntityCaptures(id);
        if (captureSeq !== entityCapturesLoadSeq) return;
      } catch (e) {
        if (captureSeq !== entityCapturesLoadSeq) return;
        entityCapturesErr = e instanceof Error ? e.message : String(e);
      } finally {
        if (captureSeq === entityCapturesLoadSeq) entityCapturesLoading = false;
      }
    })();

    const seq = ++entityEditorLoadSeq;
    entityEditorLoading = true;
    entityEditorErr = null;
    entityEditorDraft = "";
    entityEditorEntityType = "";
    entityEditorStored = null;
    void (async () => {
      try {
        const row = await fetchEntityForGraphEdit(id);
        if (seq !== entityEditorLoadSeq) return;
        entityEditorDraft = row.label;
        entityEditorEntityType = row.entityType;
        entityEditorStored = row;
      } catch (e) {
        if (seq !== entityEditorLoadSeq) return;
        entityEditorErr = e instanceof Error ? e.message : String(e);
      } finally {
        if (seq === entityEditorLoadSeq) entityEditorLoading = false;
      }
    })();
  });

  async function reloadEntityCaptures(entityId: string) {
    const captureSeq = ++entityCapturesLoadSeq;
    entityCapturesLoading = true;
    entityCapturesErr = null;
    try {
      entityCaptures = await fetchEntityCaptures(entityId);
      if (captureSeq !== entityCapturesLoadSeq) return;
    } catch (e) {
      if (captureSeq !== entityCapturesLoadSeq) return;
      entityCapturesErr = e instanceof Error ? e.message : String(e);
    } finally {
      if (captureSeq === entityCapturesLoadSeq) entityCapturesLoading = false;
    }
  }

  async function submitThoughtUpdateFromGraph() {
    const id = editingThoughtId ?? "";
    if (!id || !thoughtEditorDraft.trim()) return;
    thoughtEditorErr = null;
    thoughtEditorPhase = null;
    thoughtEditorBusy = true;
    try {
      const thought = await submitGraphThoughtEdit({
        thoughtId: id,
        editRequest: thoughtEditorDraft,
        onPhase: (phase) => {
          thoughtEditorPhase = phase;
        },
      });
      thoughtEditorStored = thought;
      thoughtEditorDraft = thought.rawText;
      if (selectedNode?.kind === "Entity") await reloadEntityCaptures(selectedNode.id);
      if (selectedNode && selectedNode.id === id) {
        selectedNode = {
          ...selectedNode,
          label: thought.normalizedText.slice(0, 120),
          subtype: thought.category,
        };
      }
      await refreshGraphAfterRearrange("Thought saved.");
    } catch (e) {
      thoughtEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      thoughtEditorBusy = false;
      thoughtEditorPhase = null;
    }
  }

  async function refreshGraphAfterRearrange(message: string) {
    await invalidateAll();
    queueMicrotask(() => {
      scheduleGraphUpdate?.();
      scheduleGraphRelayout?.();
    });
    status = message;
  }

  let enrichGraphRefreshInFlight = false;

  async function refreshGraphAfterEnrichment() {
    if (enrichGraphRefreshInFlight) return;
    enrichGraphRefreshInFlight = true;
    try {
      schedulePreserveGraphZoom?.();
      scheduleMarkEnrichGraphUpdate?.();
      entityIdsBeforeEnrichRefresh = new Set(
        data.snapshot.nodes.filter((n) => n.kind === "Entity").map((n) => n.id),
      );
      await invalidateAll();
      status = "Memory indexed — graph updated.";
    } finally {
      enrichGraphRefreshInFlight = false;
    }
  }

  async function submitThoughtRelinkFromGraph() {
    const id = editingThoughtId ?? "";
    if (!id) return;
    thoughtEditorErr = null;
    thoughtEditorPhase = null;
    thoughtEditorRelinkBusy = true;
    try {
      const thought = await submitGraphThoughtRelink({
        thoughtId: id,
        onPhase: (phase) => {
          thoughtEditorPhase = phase;
        },
      });
      thoughtEditorStored = thought;
      thoughtEditorDraft = thought.rawText;
      if (selectedNode?.kind === "Entity") await reloadEntityCaptures(selectedNode.id);
      await refreshGraphAfterRearrange("Capture relinked to graph — layout refreshed.");
    } catch (e) {
      thoughtEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      thoughtEditorRelinkBusy = false;
      thoughtEditorPhase = null;
    }
  }

  function openGraphThoughtDeleteDialog() {
    if (!(editingThoughtId ?? "")) return;
    graphDeleteTarget = "thought";
    graphDeleteDialogOpen = true;
  }

  function openGraphEntityDeleteDialog() {
    if (selectedNode?.kind !== "Entity") return;
    graphDeleteTarget = "entity";
    graphDeleteDialogOpen = true;
  }

  async function confirmGraphNodeDelete() {
    if (graphDeleteTarget === "thought") {
      await executeThoughtDeleteFromGraph();
      return;
    }
    if (graphDeleteTarget === "entity") {
      await executeEntityDeleteFromGraph();
    }
  }

  async function executeThoughtDeleteFromGraph() {
    const id = editingThoughtId ?? "";
    if (!id) return;
    thoughtEditorErr = null;
    thoughtEditorDeleteBusy = true;
    try {
      await deleteGraphThought(id);
      editingThoughtId = null;
      graphDeleteDialogOpen = false;
      graphDeleteTarget = null;
      if (selectedNode?.kind === "Entity") await reloadEntityCaptures(selectedNode.id);
      await invalidateAll();
    } catch (e) {
      thoughtEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      thoughtEditorDeleteBusy = false;
    }
  }

  async function submitEntityUpdateFromGraph() {
    const id = selectedNode?.kind === "Entity" ? selectedNode.id : "";
    if (!id || !entityEditorDraft.trim()) return;
    entityEditorErr = null;
    entityEditorBusy = true;
    try {
      const entity = await updateGraphEntity({
        entityId: id,
        label: entityEditorDraft,
        entityType: entityEditorEntityType,
      });
      entityEditorStored = entity;
      entityEditorDraft = entity.label;
      entityEditorEntityType = entity.entityType;
      if (selectedNode?.kind === "Entity" && selectedNode.id === id) {
        selectedNode = {
          ...selectedNode,
          label: entity.label,
          subtype: entity.entityType,
        };
      }
      await refreshGraphAfterRearrange("Entity saved.");
    } catch (e) {
      entityEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      entityEditorBusy = false;
    }
  }

  async function submitEntitySyncFromGraph() {
    const id = selectedNode?.kind === "Entity" ? selectedNode.id : "";
    if (!id) return;
    entityEditorErr = null;
    entityEditorSyncBusy = true;
    try {
      const repair = await syncGraphEntity(id);
      const added = repair?.edgesAdded ?? 0;
      await refreshGraphAfterRearrange(
        added > 0
          ? `Entity synced — ${added} relation edge${added === 1 ? "" : "s"} repaired.`
          : "Entity synced to graph — layout refreshed.",
      );
    } catch (e) {
      entityEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      entityEditorSyncBusy = false;
    }
  }

  async function executeEntityDeleteFromGraph() {
    const id = selectedNode?.kind === "Entity" ? selectedNode.id : "";
    if (!id) return;
    entityEditorErr = null;
    entityEditorDeleteBusy = true;
    try {
      await deleteGraphEntity(id);
      selectedNode = null;
      graphDeleteDialogOpen = false;
      graphDeleteTarget = null;
      await invalidateAll();
    } catch (e) {
      entityEditorErr = e instanceof Error ? e.message : String(e);
    } finally {
      entityEditorDeleteBusy = false;
    }
  }

  const nodeById = $derived(new Map(data.snapshot.nodes.map((n) => [n.id, n])));

  const selectedEdges = $derived.by(() => {
    if (!selectedNode) return [];
    const id = selectedNode.id;
    return data.snapshot.edges.filter((e) => e.sourceId === id || e.targetId === id);
  });

  const selectedCommunityMembers = $derived.by(() => {
    if (!selectedCommunity) return [];
    const memberIds = new Set(selectedCommunity.memberEntityIds);
    return data.snapshot.nodes.filter((n) => n.kind === "Entity" && memberIds.has(n.id));
  });

  const legendCustomEntityFills = $derived(
    customEntityFillsFromLegendSections(data.graphLegendSections ?? []),
  );
  const availableCommunityLevels = $derived.by(() =>
    canonicalCommunityLevels((data.communities ?? []).map((c) => c.level)),
  );
  const selectedCommunityLevel = $derived.by(() => vizCtx.selectedCommunityLevel);
  const communityEvidenceById = $derived.by(() => {
    const edgeMap = new Map<string, number>();
    for (const edge of data.snapshot.edges) {
      const key = `${edge.sourceId}|${edge.targetId}`;
      edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
      const reverse = `${edge.targetId}|${edge.sourceId}`;
      edgeMap.set(reverse, (edgeMap.get(reverse) ?? 0) + 1);
    }

    const evidence = new Map<string, string>();
    for (const community of data.communities ?? []) {
      const memberSet = new Set(community.memberEntityIds);
      const kindCounts = new Map<string, number>();
      let supportEdges = 0;
      for (const edge of data.snapshot.edges) {
        if (!memberSet.has(edge.sourceId) || !memberSet.has(edge.targetId)) continue;
        supportEdges++;
        kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
      }
      const topKinds = [...kindCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([kind, count]) => `${kind}:${count}`);
      const detail = topKinds.length > 0 ? ` (${topKinds.join(", ")})` : "";
      evidence.set(
        community.id,
        `${community.levelLabel} ${community.levelIntent}; support edges: ${supportEdges}${detail}`,
      );
    }
    return evidence;
  });

  function selectedNodeFill(node: (typeof data.snapshot.nodes)[number]): string {
    return nodeFillForGraph(node.kind, node.subtype, legendCustomEntityFills);
  }

  type SimNode = {
    id: string;
    kind: string;
    label: string;
    subtype: string;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
  };

  type SimLink = {
    id: string;
    source: string | SimNode;
    target: string | SimNode;
    relationType: string;
    kind: string;
  };

  type CommunityHull = {
    id: string;
    level: number;
    name: string;
    description: string | null;
    cx: number;
    cy: number;
    r: number;
  };

  let teardown: (() => void) | undefined;

  function norm(s: string): string {
    return s.trim().toLowerCase();
  }

  $effect(() => {
    search;
    edgeKind;
    visibleEntityTypes;
    queueMicrotask(() => scheduleGraphUpdate?.());
  });

  $effect(() => {
    data.snapshot;
    data.communities;
    if (entityIdsBeforeEnrichRefresh) {
      const after = new Set(
        data.snapshot.nodes.filter((n) => n.kind === "Entity").map((n) => n.id),
      );
      pendingPopInNodeIds = new Set([...after].filter((id) => !entityIdsBeforeEnrichRefresh!.has(id)));
      entityIdsBeforeEnrichRefresh = null;
    }
    queueMicrotask(() => scheduleGraphUpdate?.());
  });

  $effect(() => {
    const id = selectedNode?.id ?? null;
    queueMicrotask(() => scheduleApplyHighlight?.(id));
  });

  $effect(() => {
    if (selectedNode !== null) return;
    queueMicrotask(() => scheduleRestorePreEntityZoom?.());
  });

  $effect(() => {
    const levels = availableCommunityLevels;
    if (communityLevel === "leaf") {
      communityLevel = String(COMMUNITY_LEAF_LEVEL);
    } else if (levels.length > 0 && !levels.some((l) => String(l) === communityLevel)) {
      communityLevel = String(levels[0]);
    }
    data.communities;
    const level = selectedCommunityLevel;
    if (selectedCommunityId && level !== null) {
      const selected = (data.communities ?? []).find((c) => c.id === selectedCommunityId);
      if (selected && selected.level !== level) {
        selectedCommunityId = null;
      }
    }
    queueMicrotask(() => scheduleUpdateCommunityHulls?.());
  });

  onMount(() => {
    const enrichPollCancel = pollGraphEnrichRefresh({
      onEnrichComplete: () => refreshGraphAfterEnrichment(),
    });
    const fastEnrichPollCancelByThoughtId = new Map<string, () => void>();
    const unsubCaptureQueue = subscribeCaptureQueue((message) => {
      if (message.type !== "done") return;
      if (message.thought.enrichmentComplete) {
        void refreshGraphAfterEnrichment();
        return;
      }
      const thoughtId = message.thought.id;
      fastEnrichPollCancelByThoughtId.get(thoughtId)?.();
      const cancel = pollUntilEnrichmentComplete({
        thoughtId,
        onUpdate: (thought) => {
          if (!thought.enrichmentComplete) return;
          fastEnrichPollCancelByThoughtId.delete(thoughtId);
          void refreshGraphAfterEnrichment();
        },
      });
      fastEnrichPollCancelByThoughtId.set(thoughtId, cancel);
    });

    const origHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    let cancelled = false;

    (async () => {
      const d3 = await import("d3");
      if (cancelled || !rootEl) return;

      const persistentNodes = new Map<string, SimNode>();

      function simNodeFromSnapshot(n: (typeof data.snapshot.nodes)[number]): SimNode {
        let s = persistentNodes.get(n.id);
        if (!s) {
          s = { id: n.id, kind: n.kind, label: n.label, subtype: n.subtype };
          persistentNodes.set(n.id, s);
        } else {
          s.kind = n.kind;
          s.label = n.label;
          s.subtype = n.subtype;
        }
        return s;
      }

      function prunePersistentToSnapshot(snapshot: typeof data.snapshot) {
        const keep = new Set(snapshot.nodes.map((n) => n.id));
        for (const id of persistentNodes.keys()) {
          if (!keep.has(id)) persistentNodes.delete(id);
        }
      }

      const svg = d3
        .select(rootEl)
        .append("svg")
        .attr("class", "graph-svg block h-full w-full touch-none");
      svg
        .append("defs")
        .append("filter")
        .attr("id", "graph-node-selected-glow")
        .attr("x", "-40%")
        .attr("y", "-40%")
        .attr("width", "180%")
        .attr("height", "180%")
        .call((f) => {
          f.append("feGaussianBlur")
            .attr("in", "SourceAlpha")
            .attr("stdDeviation", 2)
            .attr("result", "graphBlur");
          const m = f.append("feMerge");
          m.append("feMergeNode").attr("in", "graphBlur");
          m.append("feMergeNode").attr("in", "SourceGraphic");
        });

      const defs = svg.select("defs");
      const grad = defs
        .append("radialGradient")
        .attr("id", communityGradientId())
        .attr("cx", "50%")
        .attr("cy", "50%")
        .attr("r", "50%");
      grad.append("stop").attr("offset", "0%").attr("stop-color", COMMUNITY_HULL_GRADIENT.center);
      grad.append("stop").attr("offset", "65%").attr("stop-color", COMMUNITY_HULL_GRADIENT.mid);
      grad.append("stop").attr("offset", "100%").attr("stop-color", COMMUNITY_HULL_GRADIENT.edge);

      const gZoom = svg.append("g");
      const gCommunityFills = gZoom
        .append("g")
        .attr("class", "graph-community-fills")
        .attr("pointer-events", "none");
      const gLinks = gZoom
        .append("g")
        .attr("class", "graph-links")
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.35);
      const gNodes = gZoom.append("g").attr("class", "graph-nodes");
      const gCommunityChrome = gZoom
        .append("g")
        .attr("class", "graph-community-chrome")
        .attr("pointer-events", "none");

      function applyCommunityHullZoomOpacity(scale = 1) {
        communityFillSelection
          .select("circle")
          .attr("fill-opacity", (d) => communityHullFillOpacityForZoom(scale, d.level));
      }

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 8])
        .on("zoom", (event) => {
          gZoom.attr("transform", event.transform.toString());
          applyCommunityHullZoomOpacity(event.transform.k);
        });
      svg.call(zoom);
      svg.on("click.details-clear", (event) => {
        const el = event.target as Element | null;
        if (!el?.closest?.(".graph-node")) selectedNode = null;
        if (!el?.closest?.(".community-hull-label-wrap")) selectedCommunityId = null;
      });

      let preEntityZoomTransform: ReturnType<typeof d3.zoomIdentity> | null = null;
      let focusSessionBaseK: number | null = null;
      let pendingEnrichGraphUpdate = false;
      let preservedGraphZoomTransform: ReturnType<typeof d3.zoomIdentity> | null = null;

      function preserveGraphZoom() {
        const svgEl = svg.node();
        if (!svgEl) return;
        preservedGraphZoomTransform = d3.zoomTransform(svgEl).copy();
      }

      function restorePreservedGraphZoom() {
        if (!preservedGraphZoomTransform) return;
        const t = preservedGraphZoomTransform;
        preservedGraphZoomTransform = null;
        svg.interrupt("zoom-preserve");
        svg.call(zoom.transform, t);
      }

      function linkEndpointId(endpoint: string | SimNode) {
        return typeof endpoint === "string" ? endpoint : endpoint.id;
      }

      /** Place newly enriched entities near existing neighbors so the viewport does not jump. */
      function seedPopInNodePositions(nodes: SimNode[], links: SimLink[], popInIds: Set<string>) {
        if (popInIds.size === 0) return;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        for (const node of nodes) {
          if (!popInIds.has(node.id)) continue;
          if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
          const neighbors: SimNode[] = [];
          for (const link of links) {
            const sourceId = linkEndpointId(link.source);
            const targetId = linkEndpointId(link.target);
            if (sourceId === node.id) {
              const target = byId.get(targetId);
              if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) neighbors.push(target);
            } else if (targetId === node.id) {
              const source = byId.get(sourceId);
              if (source && Number.isFinite(source.x) && Number.isFinite(source.y)) neighbors.push(source);
            }
          }
          if (neighbors.length === 0) continue;
          const cx = neighbors.reduce((sum, n) => sum + (n.x ?? 0), 0) / neighbors.length;
          const cy = neighbors.reduce((sum, n) => sum + (n.y ?? 0), 0) / neighbors.length;
          node.x = cx + (Math.random() - 0.5) * 24;
          node.y = cy + (Math.random() - 0.5) * 24;
        }
      }

      function restorePreEntityZoom() {
        const svgEl = svg.node();
        if (!svgEl || !preEntityZoomTransform) return;
        const t = preEntityZoomTransform;
        preEntityZoomTransform = null;
        focusSessionBaseK = null;
        resizeSvg();
        const next = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
        svg.interrupt("zoom-center");
        svg
          .transition("zoom-center")
          .duration(520)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, next);
      }

      function scheduleRestorePreEntityZoomInner() {
        requestAnimationFrame(() => {
          if (selectedNode !== null) return;
          restorePreEntityZoom();
        });
      }

      /** `panOnly`: after resize, pan without changing scale. `focus`: one zoom step from `focusSessionBaseK` then pan. */
      function centerViewOnNode(d: SimNode, mode: "focus" | "panOnly" = "focus") {
        const svgEl = svg.node();
        if (!svgEl || !rootEl) return;
        resizeSvg();

        if (simulation) {
          let i = 0;
          const cap = 500;
          while (
            i < cap &&
            (!Number.isFinite(d.x) || !Number.isFinite(d.y) || simulation.alpha() > 0.02)
          ) {
            simulation.tick();
            i++;
          }
        }

        const nx = d.x ?? 0;
        const ny = d.y ?? 0;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

        const w =
          svgEl instanceof SVGSVGElement && svgEl.width.baseVal
            ? Math.max(1, svgEl.width.baseVal.value)
            : Math.max(1, svgEl.clientWidth);
        const h =
          svgEl instanceof SVGSVGElement && svgEl.height.baseVal
            ? Math.max(1, svgEl.height.baseVal.value)
            : Math.max(1, svgEl.clientHeight);
        const cx = w / 2;
        const cy = h / 2;

        const t = d3.zoomTransform(svgEl);
        const [minK, maxK] = zoom.scaleExtent();
        const FOCUS_ZOOM_STEP = 1.32;
        const baseK = focusSessionBaseK ?? t.k;
        const targetK =
          mode === "panOnly"
            ? t.k
            : Math.min(maxK, Math.max(minK, Math.min(2.35, baseK * FOCUS_ZOOM_STEP)));

        svg.interrupt("zoom-center");
        const tr = svg.transition("zoom-center").duration(320).ease(d3.easeCubicInOut);
        if (mode === "panOnly" || Math.abs(t.k - targetK) <= 0.04) {
          tr.call(zoom.translateTo, nx, ny, [cx, cy]);
        } else {
          tr.call(zoom.scaleTo, targetK, [cx, cy])
            .transition()
            .duration(320)
            .ease(d3.easeCubicInOut)
            .call(zoom.translateTo, nx, ny, [cx, cy]);
        }
      }

      function scheduleCenterViewOnNode(nodeId: string) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const sim = persistentNodes.get(nodeId);
            if (!sim || selectedNode?.id !== nodeId) return;
            centerViewOnNode(sim);
          });
        });
      }

      function maybeRecenterSelectedNode() {
        const n = selectedNode;
        if (!n) return;
        const id = n.id;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (selectedNode?.id !== id) return;
            const simFresh = persistentNodes.get(id);
            if (!simFresh) return;
            centerViewOnNode(simFresh, "panOnly");
          });
        });
      }

      function resizeSvg() {
        if (!rootEl) return;
        const w = rootEl.clientWidth;
        const h = Math.max(1, rootEl.clientHeight);
        svg.attr("width", w).attr("height", h);
        return { w, h };
      }

      let simulation: d3.Simulation<SimNode, SimLink> | null = null;
      let linkSelection = gLinks.selectAll<SVGGElement, SimLink>("g");
      let communityFillSelection = gCommunityFills.selectAll<SVGGElement, CommunityHull>("g");
      let communityChromeSelection = gCommunityChrome.selectAll<SVGGElement, CommunityHull>("g");
      let nodeSelection = gNodes.selectAll<SVGGElement, SimNode>("g.graph-node");

      const dragBehavior = d3
        .drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation?.alphaTarget(0.35).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });

      function nodeRadius(_d: SimNode) {
        return 8;
      }

      let customEntityFills = new Map<string, string>();

      function nodeFill(d: SimNode) {
        return nodeFillForGraph(d.kind, d.subtype, customEntityFills);
      }

      function labelText(d: SimNode) {
        const base = d.label || d.id;
        return base.length > 42 ? `${base.slice(0, 40)}…` : base;
      }

      function applyHighlight(selectedId: string | null) {
        nodeSelection.each(function (d) {
          const sel = d3.select(this);
          const circle = sel.select<SVGCircleElement>(".graph-node-core, circle");
          const on = selectedId !== null && d.id === selectedId;
          circle
            .attr("stroke-width", on ? 3.2 : 1)
            .attr("stroke", on ? "#fbbf24" : "currentColor")
            .attr("filter", on ? "url(#graph-node-selected-glow)" : null);
        });
      }

      function communityHullsForNodes(nodes: SimNode[]): CommunityHull[] {
        const posById = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          if (Number.isFinite(x) && Number.isFinite(y)) posById.set(n.id, { x, y });
        }

        const activeLevel = vizCtx.selectedCommunityLevel;
        if (activeLevel === null) return [];
        const hulls: CommunityHull[] = [];
        for (const community of vizCtx.communities) {
          if (community.level !== activeLevel) continue;
          const positions: { x: number; y: number }[] = [];
          for (const entityId of community.memberEntityIds) {
            const p = posById.get(entityId);
            if (p) positions.push(p);
          }
          if (positions.length === 0) continue;
          const circle = communityCircleFromPositions(positions, community.level === 0 ? 48 : 36);
          if (!circle) continue;
          hulls.push({
            id: community.id,
            level: community.level,
            name: community.name,
            description: [community.description, communityEvidenceById.get(community.id)]
              .filter((v) => typeof v === "string" && v.trim().length > 0)
              .join("\n\n"),
            cx: circle.cx,
            cy: circle.cy,
            r: circle.r,
          });
        }
        return hulls.sort((a, b) => a.level - b.level);
      }

      function updateCommunityHulls(nodes: SimNode[]) {
        const hulls = communityHullsForNodes(nodes);

        communityFillSelection = gCommunityFills
          .selectAll<SVGGElement, CommunityHull>("g.community-hull-fill")
          .data(hulls, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "community-hull-fill");
              g.append("circle").attr("stroke", "none");
              return g;
            },
            (update) => update,
            (exit) => exit.remove(),
          )
          .attr("transform", (d) => `translate(${d.cx},${d.cy})`)
          .select("circle")
          .attr("r", (d) => d.r)
          .attr("fill", (d) => communityHullFill(d.level));
        const svgEl = svg.node();
        if (svgEl) {
          applyCommunityHullZoomOpacity(d3.zoomTransform(svgEl).k);
        }

        communityChromeSelection = gCommunityChrome
          .selectAll<SVGGElement, CommunityHull>("g.community-hull-chrome")
          .data(hulls, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "community-hull-chrome");
              g.append("circle")
                .attr("class", "community-hull-border")
                .attr("fill", "none")
                .attr("stroke", "#ffffff")
                .attr("stroke-width", 1.25)
                .attr("stroke-dasharray", "3 4")
                .attr("pointer-events", "none");
              const labelWrap = g
                .append("g")
                .attr("class", "community-hull-label-wrap")
                .attr("pointer-events", "all");
              labelWrap
                .append("rect")
                .attr("class", "community-hull-label-bg")
                .attr("fill", "#ffffff")
                .attr("rx", 3);
              labelWrap
                .append("text")
                .attr("class", "community-hull-label")
                .attr("text-anchor", "middle")
                .attr("font-size", "10px")
                .attr("font-family", "monospace")
                .attr("fill", "#000000")
                .attr("dy", "0.35em");
              return g;
            },
            (update) => update,
            (exit) => exit.remove(),
          )
          .attr("transform", (d) => `translate(${d.cx},${d.cy})`)
          .each(function (d) {
            const g = d3.select(this);
            const chrome = communityHullChromeStyleForLevel(d.level);
            g.select("circle.community-hull-border")
              .attr("r", d.r)
              .attr("stroke", chrome.stroke)
              .attr("stroke-width", chrome.strokeWidth)
              .attr("stroke-dasharray", chrome.strokeDasharray)
              .attr("stroke-opacity", chrome.strokeOpacity);
            const labelWrap = g.select("g.community-hull-label-wrap");
            labelWrap.attr("transform", `translate(0, ${-(d.r + 8)})`);
            const label = labelWrap.select("text.community-hull-label").text(d.name);
            const bbox = (label.node() as SVGTextElement | null)?.getBBox();
            if (bbox) {
              labelWrap
                .select("rect.community-hull-label-bg")
                .attr("x", bbox.x - 4)
                .attr("y", bbox.y - 2)
                .attr("width", bbox.width + 8)
                .attr("height", bbox.height + 4);
            }
            labelWrap.select("title").remove();
            if (d.description) {
              labelWrap.append("title").text(d.description);
            }
            labelWrap.style("cursor", "pointer").on("click", (event, hull) => onCommunityClick(event, hull));
          });
      }

      function ticked() {
        linkSelection
          .select("line")
          .attr("x1", (d) => (d.source as SimNode).x ?? 0)
          .attr("y1", (d) => (d.source as SimNode).y ?? 0)
          .attr("x2", (d) => (d.target as SimNode).x ?? 0)
          .attr("y2", (d) => (d.target as SimNode).y ?? 0);

        linkSelection.select("circle").attr("cx", midpointX).attr("cy", midpointY);

        linkSelection.select("text").attr("x", midpointX).attr("y", midpointY);

        nodeSelection.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

        updateCommunityHulls(simulation?.nodes() ?? []);
      }

      function midpointX(d: SimLink) {
        const sx = (d.source as SimNode).x ?? 0;
        const tx = (d.target as SimNode).x ?? 0;
        return (sx + tx) / 2;
      }

      function midpointY(d: SimLink) {
        const sy = (d.source as SimNode).y ?? 0;
        const ty = (d.target as SimNode).y ?? 0;
        return (sy + ty) / 2;
      }

      function onNodeClick(event: MouseEvent, d: SimNode) {
        event.stopPropagation();
        selectedCommunityId = null;
        const prev = selectedNode;
        const hit = vizCtx.snapshot.nodes.find((n) => n.id === d.id && n.kind === "Entity");
        selectedNode = hit ?? null;
        if (hit) selectedTemporalId = null;
        if (hit) {
          if (!prev) {
            const svgEl = svg.node();
            if (svgEl) {
              const cur = d3.zoomTransform(svgEl);
              preEntityZoomTransform = cur.copy();
              focusSessionBaseK = cur.k;
            }
          }
          if (prev?.id !== hit.id) {
            scheduleCenterViewOnNode(hit.id);
          }
        }
        scheduleApplyHighlight?.(hit?.id ?? null);
      }

      function onCommunityClick(event: MouseEvent, d: CommunityHull) {
        event.stopPropagation();
        selectedNode = null;
        selectedCommunityId = d.id;
        scheduleApplyHighlight?.(null);
      }

      function updateGraph() {
        const dims = resizeSvg();
        if (!dims) return;

        customEntityFills = customEntityFillsFromLegendSections(vizCtx.legendSections);

        prunePersistentToSnapshot(vizCtx.snapshot);

        const rawNodes: SimNode[] = vizCtx.snapshot.nodes
          .filter((n) => n.kind === "Entity")
          .map((n) => simNodeFromSnapshot(n));
        const typeFiltered = filterNodesByEntityTypes(rawNodes, visibleEntityTypes);
        const q = norm(search);
        const nodeMatch = (n: SimNode) =>
          q.length === 0 ||
          norm(n.label).includes(q) ||
          norm(n.id).includes(q) ||
          norm(n.subtype).includes(q);

        const rawNodeIds = new Set(typeFiltered.map((n) => n.id));
        const visibleIds = new Set(typeFiltered.filter(nodeMatch).map((n) => n.id));
        if (q.length > 0) {
          let expanded = true;
          while (expanded) {
            expanded = false;
            for (const e of vizCtx.snapshot.edges) {
              if (visibleIds.has(e.sourceId) && rawNodeIds.has(e.targetId) && !visibleIds.has(e.targetId)) {
                visibleIds.add(e.targetId);
                expanded = true;
              }
              if (visibleIds.has(e.targetId) && rawNodeIds.has(e.sourceId) && !visibleIds.has(e.sourceId)) {
                visibleIds.add(e.sourceId);
                expanded = true;
              }
            }
          }
        }

        const nodes = typeFiltered.filter((n) => visibleIds.has(n.id));
        if (selectedNode && !visibleIds.has(selectedNode.id)) {
          selectedNode = null;
        }
        const edgeFilter = (e: (typeof vizCtx.snapshot.edges)[0]) => {
          if (edgeKind !== "all" && e.kind !== edgeKind) return false;
          return visibleIds.has(e.sourceId) && visibleIds.has(e.targetId);
        };
        const safeEdges = filterGraphVizEdgesToNodes(
          vizCtx.snapshot.nodes,
          vizCtx.snapshot.edges.filter(edgeFilter),
        ).edges;
        const links: SimLink[] = resolveForceLinks(nodes, safeEdges);

        linkSelection = gLinks
          .selectAll<SVGGElement, SimLink>("g")
          .data(links, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "graph-link");
              g.append("line").attr("stroke-width", 1.2);
              g.append("circle").attr("r", 2).attr("fill", "currentColor").attr("stroke", "none");
              g.append("text")
                .attr("class", "fill-muted-foreground text-[9px] font-mono")
                .attr("text-anchor", "middle")
                .attr("dy", "1.4em")
                .attr("stroke", "var(--background)")
                .attr("stroke-width", "2.5")
                .attr("paint-order", "stroke")
                .text((d) => d.relationType || d.kind);
              return g;
            },
            (update) => {
              update.select("text").text((d) => d.relationType || d.kind);
              return update;
            },
            (exit) => exit.remove(),
          );

        const popInIds = pendingPopInNodeIds;

        nodeSelection = gNodes
          .selectAll<SVGGElement, SimNode>("g.graph-node")
          .data(nodes, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "graph-node");
              g.each(function (d) {
                const node = d3.select(this);
                const inner = node.append("g").attr("class", "graph-node-inner");
                const shouldPop = popInIds.has(d.id);
                if (shouldPop) {
                  inner
                    .append("circle")
                    .attr("class", "graph-node-flash-bg")
                    .attr("r", nodeRadius(d))
                    .attr("fill", "#28F97F")
                    .attr("stroke", "none")
                    .attr("opacity", 0);
                  inner
                    .append("circle")
                    .attr("class", "graph-node-reveal-ring")
                    .attr("r", nodeRadius(d))
                    .attr("fill", "none")
                    .attr("stroke", "#28F97F")
                    .attr("stroke-width", 2)
                    .attr("opacity", 0);
                }
                inner
                  .append("circle")
                  .attr("class", "graph-node-core")
                  .attr("r", nodeRadius(d))
                  .attr("fill", nodeFill(d))
                  .attr("stroke", "currentColor")
                  .attr("stroke-width", 1);
                node.append("title").text(`${d.kind}: ${d.label || d.id}\n${d.subtype}`);
                inner
                  .append("text")
                  .attr("x", 12)
                  .attr("y", 4)
                  .attr("class", "fill-foreground text-[10px] font-mono")
                  .text(labelText(d));
                if (shouldPop) {
                  inner.attr("opacity", 0).attr("transform", "scale(0.08)");
                  inner
                    .transition("graph-node-pop")
                    .duration(520)
                    .ease(d3.easeCubicOut)
                    .attr("opacity", 1)
                    .attr("transform", "scale(1)");
                  inner
                    .select(".graph-node-flash-bg")
                    .transition("graph-node-flash")
                    .duration(520)
                    .attr("opacity", 0.85)
                    .attr("r", nodeRadius(d) + 5)
                    .transition()
                    .attr("opacity", 0);
                  inner
                    .select(".graph-node-reveal-ring")
                    .transition("graph-node-ring")
                    .duration(520)
                    .attr("opacity", 0.95)
                    .attr("r", nodeRadius(d) + 24)
                    .transition()
                    .attr("opacity", 0);
                }
              });
              return g;
            },
            (update) => {
              update.select("title").text((d) => `${d.kind}: ${d.label || d.id}\n${d.subtype}`);
              update.select(".graph-node-inner text").text(labelText);
              update
                .select(".graph-node-core")
                .attr("r", nodeRadius)
                .attr("fill", nodeFill);
              return update;
            },
            (exit) => exit.remove(),
          )
          .style("cursor", "pointer")
          .call(dragBehavior)
          .on("click.details", onNodeClick);

        if (!simulation) {
          simulation = d3
            .forceSimulation<SimNode>(nodes)
            .force(
              "link",
              d3
                .forceLink<SimNode, SimLink>(links)
                .id((d) => d.id)
                .distance(40),
            )
            .force("charge", d3.forceManyBody<SimNode>().strength(-500))
            .force("x", d3.forceX<SimNode>(dims.w / 2).strength(0.08))
            .force("y", d3.forceY<SimNode>(dims.h / 2).strength(0.08))
            .force("collision", d3.forceCollide<SimNode>().radius(40))
            .on("tick", ticked);
          // Run headless to present an already-relaxed layout on first paint
          simulation.stop();
          for (let i = 0; i < 80; i++) simulation.tick();
          ticked();
          simulation.restart();
        } else {
          simulation.nodes(nodes);
          const linkForce = simulation.force("link") as ReturnType<
            typeof d3.forceLink<SimNode, SimLink>
          >;
          linkForce.links(links);
          simulation.force("x", d3.forceX<SimNode>(dims.w / 2).strength(0.08));
          simulation.force("y", d3.forceY<SimNode>(dims.h / 2).strength(0.08));
          simulation.force("collision", d3.forceCollide<SimNode>().radius(40));
          if (pendingEnrichGraphUpdate) {
            seedPopInNodePositions(nodes, links, popInIds);
            pendingEnrichGraphUpdate = false;
            simulation.alpha(0.12).restart();
            restorePreservedGraphZoom();
          } else {
            simulation.alpha(0.35).restart();
          }
        }

        applyHighlight(selectedNode?.id ?? null);
        if (popInIds.size > 0) {
          pendingPopInNodeIds = new Set();
        }
        graphStats = `${nodes.length} nodes · ${links.length} edges`;
      }

      function resizeGraph() {
        const dims = resizeSvg();
        if (!dims || !simulation) return;
        simulation.force("x", d3.forceX<SimNode>(dims.w / 2).strength(0.08));
        simulation.force("y", d3.forceY<SimNode>(dims.h / 2).strength(0.08));
        simulation.alpha(0.08).restart();
      }

      scheduleGraphUpdate = updateGraph;
      scheduleGraphResize = resizeGraph;
      scheduleGraphRelayout = () => {
        if (!simulation) return;
        simulation.alpha(1).restart();
      };
      schedulePreserveGraphZoom = preserveGraphZoom;
      scheduleMarkEnrichGraphUpdate = () => {
        pendingEnrichGraphUpdate = true;
      };
      scheduleApplyHighlight = (id) => applyHighlight(id);
      scheduleRestorePreEntityZoom = scheduleRestorePreEntityZoomInner;
      scheduleUpdateCommunityHulls = () => {
        updateCommunityHulls(simulation?.nodes() ?? []);
      };

      let lastGraphResizeHeight: number | null = null;

      updateGraph();

      const ro = new ResizeObserver(() => {
        scheduleGraphResize?.();
        const h = rootEl?.clientHeight ?? 0;
        if (selectedNode && lastGraphResizeHeight !== null && h !== lastGraphResizeHeight) {
          maybeRecenterSelectedNode();
        }
        lastGraphResizeHeight = h;
      });
      ro.observe(rootEl);

      teardown = () => {
        cancelled = true;
        enrichPollCancel();
        unsubCaptureQueue();
        for (const cancel of fastEnrichPollCancelByThoughtId.values()) cancel();
        fastEnrichPollCancelByThoughtId.clear();
        document.documentElement.style.overflow = origHtmlOverflow;
        scheduleGraphUpdate = null;
        scheduleGraphResize = null;
        scheduleGraphRelayout = null;
        schedulePreserveGraphZoom = null;
        scheduleMarkEnrichGraphUpdate = null;
        scheduleApplyHighlight = null;
        scheduleRestorePreEntityZoom = null;
        scheduleUpdateCommunityHulls = null;
        preservedGraphZoomTransform = null;
        pendingEnrichGraphUpdate = false;
        preEntityZoomTransform = null;
        focusSessionBaseK = null;
        simulation?.stop();
        ro.disconnect();
        svg.remove();
      };
    })();

    return () => teardown?.();
  });
</script>

<div class="h-dvh overflow-hidden">
  <Card.Root class="relative flex h-full flex-col overflow-hidden bg-transparent shadow-none">
    <Tabs.Root bind:value={activeTab} class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        class="pointer-events-none fixed top-16 right-0 left-0 z-30 flex justify-center"
        aria-label="Graph view tabs"
      >
        <Tabs.List
          class="bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card pointer-events-auto flex h-9 w-fit shrink-0 items-stretch gap-1 rounded-full border border-white/80 p-0.5"
        >
          <Tabs.Trigger
            value="graph"
            class="!h-full rounded-full !px-3 text-xs after:hidden text-black hover:text-black data-active:bg-black data-active:text-white data-active:hover:text-white dark:text-foreground dark:hover:text-foreground dark:data-active:bg-foreground dark:data-active:text-background dark:data-active:hover:text-background"
          >
            Graph
          </Tabs.Trigger>
          <Tabs.Trigger
            value="embeddings"
            class="!h-full rounded-full !px-3 text-xs after:hidden text-black hover:text-black data-active:bg-black data-active:text-white data-active:hover:text-white dark:text-foreground dark:hover:text-foreground dark:data-active:bg-foreground dark:data-active:text-background dark:data-active:hover:text-background"
          >
            Embedding Map
          </Tabs.Trigger>
          <Tabs.Trigger
            value="temporal"
            class="!h-full rounded-full !px-3 text-xs after:hidden text-black hover:text-black data-active:bg-black data-active:text-white data-active:hover:text-white dark:text-foreground dark:hover:text-foreground dark:data-active:bg-foreground dark:data-active:text-background dark:data-active:hover:text-background"
          >
            Timeline
          </Tabs.Trigger>
        </Tabs.List>
      </div>
      <Card.Content class="flex h-full min-h-0 flex-1 flex-col p-0">
        <Tabs.Content
          value="graph"
          class="relative h-full min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <div class="relative h-full min-h-0 w-full flex-1 bg-transparent">
            <div
              bind:this={rootEl}
              class="text-foreground h-full min-h-0 w-full bg-transparent"
              role="img"
              aria-label="Interactive graph visualization"
            ></div>
            <div
              class="pointer-events-none absolute right-3 bottom-16 left-3 z-10 flex items-end justify-between gap-3"
              aria-label="Graph legend and filters"
            >
              <div class="w-[min(calc(100vw-1.5rem),11rem)] shrink-0">
                <GraphEntityKindsLegend bind:visibleEntityTypes {legendSections} {graphStats} />
              </div>
              <div class="pointer-events-auto flex shrink-0 flex-col items-end gap-1">
                <GraphFiltersToolbar
                  bind:search
                  bind:edgeKind
                  bind:communityLevel
                  {availableCommunityLevels}
                />
                {#if status}
                  <p
                    class="text-muted-foreground border-border/60 bg-background/85 rounded-md border px-2 py-1 font-mono text-[11px] leading-tight backdrop-blur-sm"
                  >
                    {status}
                  </p>
                {/if}
              </div>
            </div>
          </div>
        </Tabs.Content>
        <Tabs.Content
          value="embeddings"
          class="relative z-0 h-full min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          {#if embeddingsTabOpened}
            <EmbeddingMap
              visible={activeTab === "embeddings"}
              graphLegendSections={data.graphLegendSections ?? []}
              bind:visibleEntityTypes
              onSelectItem={handleEmbeddingSelect}
              selectedItemId={selectedNode?.id ?? null}
            />
          {/if}
        </Tabs.Content>
        <Tabs.Content
          value="temporal"
          class="relative h-full min-h-0 flex-1 pt-24 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <TemporalEvents
            onSelectItem={handleTemporalSelect}
            selectedItemId={selectedTemporalId}
            initialEventId={initialTemporalEventId}
            userTimeZone={data.preferredTimezone}
          />
        </Tabs.Content>
      </Card.Content>
    </Tabs.Root>
  </Card.Root>

  <Drawer.Root
    bind:open={nodeDrawerOpen}
    onOpenChange={onNodeDrawerOpenChange}
    shouldScaleBackground={false}
  >
    <Drawer.Content
      class="border-border max-h-[min(92dvh,920px)]! flex flex-col gap-0 overflow-hidden border-t bg-background p-0 select-text!"
    >
      {#if selectedCommunity && activeTab !== "temporal"}
        <Drawer.Description class="sr-only">
          Community summary for the selected graph cluster.
        </Drawer.Description>
        <div
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-10"
          data-vaul-no-drag
        >
          <div class="flex items-start justify-between gap-3">
            <Drawer.Header class="min-w-0 flex-1 space-y-1 p-0 text-left">
              <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                Community
              </p>
              <Drawer.Title class="text-foreground text-sm font-semibold">
                {selectedCommunity.name || "—"}
              </Drawer.Title>
              <dl
                class="text-muted-foreground grid gap-x-4 gap-y-1 pt-1 font-mono text-[11px] sm:grid-cols-2"
              >
                <div class="contents">
                  <dt class="text-muted-foreground/80">Level</dt>
                  <dd class="text-foreground truncate">{selectedCommunity.levelLabel}</dd>
                </div>
                <div class="contents">
                  <dt class="text-muted-foreground/80">Scope</dt>
                  <dd class="text-foreground truncate">{selectedCommunity.levelIntent}</dd>
                </div>
                <div class="contents sm:col-span-2">
                  <dt class="text-muted-foreground/80">Members</dt>
                  <dd class="text-foreground truncate">
                    {selectedCommunity.memberEntityIds.length} entities
                  </dd>
                </div>
              </dl>
            </Drawer.Header>
            <Drawer.Close
              class="text-destructive hover:text-destructive/80 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none"
              aria-label="Close"
            >
              <X class="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </Drawer.Close>
          </div>
          <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
            <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
              Summary
            </p>
            {#if selectedCommunity.description}
              <p class="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {selectedCommunity.description}
              </p>
            {:else}
              <p class="text-muted-foreground text-sm">
                No summary generated yet. Run the overnight heartbeat to build community summaries.
              </p>
            {/if}
          </div>
          {#if selectedCommunityMembers.length > 0}
            <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
              <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                Entities ({selectedCommunityMembers.length})
              </p>
              <ul class="max-h-40 space-y-1.5 overflow-y-auto font-mono text-[11px]">
                {#each selectedCommunityMembers as member (member.id)}
                  <li class="text-foreground flex min-w-0 items-baseline gap-x-2">
                    {#if member.subtype}
                      <span class="text-muted-foreground shrink-0">{member.subtype}</span>
                      <span class="text-muted-foreground shrink-0">·</span>
                    {/if}
                    <span class="min-w-0 truncate">{member.label || member.id}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {:else if selectedNode && activeTab !== "temporal"}
        <Drawer.Description class="sr-only">
          Details and edits for the selected graph or embedding-map node.
        </Drawer.Description>
        <div
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-10"
          data-vaul-no-drag
        >
          <div class="flex items-start justify-between gap-3">
            <Drawer.Header class="min-w-0 flex-1 space-y-1 p-0 text-left">
              <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                Node
              </p>
              <Drawer.Title class="text-foreground truncate text-sm font-semibold">
                {selectedNode.label || "—"}
              </Drawer.Title>
              <dl
                class="text-muted-foreground grid gap-x-4 gap-y-1 pt-1 font-mono text-[11px] sm:grid-cols-2"
              >
                <div class="contents">
                  <dt class="text-muted-foreground/80">Kind</dt>
                  <dd class="text-foreground truncate">{selectedNode.kind}</dd>
                </div>
                <div class="contents">
                  <dt class="text-muted-foreground/80">Ontology</dt>
                  <dd class="text-foreground flex items-center gap-1.5 truncate">
                    {#if selectedNode.subtype}
                      <span
                        class="size-2 shrink-0 rounded-full ring-1 ring-border/60"
                        style="background-color: {selectedNodeFill(selectedNode)}"
                        aria-hidden="true"
                      ></span>
                    {/if}
                    {selectedNode.subtype || "—"}
                  </dd>
                </div>
                <div class="contents sm:col-span-2">
                  <dt class="text-muted-foreground/80">Id</dt>
                  <dd class="text-foreground truncate">{selectedNode.id}</dd>
                </div>
              </dl>
            </Drawer.Header>
            <Drawer.Close
              class="text-destructive hover:text-destructive/80 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none"
              aria-label="Close"
            >
              <X class="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </Drawer.Close>
          </div>
          {#if selectedEdges.length > 0}
            <div class="mt-3 border-t border-black/5 pt-3 pb-3 dark:border-white/10">
              <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                Connections ({selectedEdges.length})
              </p>
              <ul class="max-h-32 space-y-1.5 overflow-y-auto font-mono text-[11px]">
                {#each selectedEdges as e (e.id)}
                  {@const otherId = e.sourceId === selectedNode.id ? e.targetId : e.sourceId}
                  {@const other = nodeById.get(otherId)}
                  <li class="text-foreground flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span class="text-muted-foreground shrink-0">{e.kind}</span>
                    <span class="text-muted-foreground shrink-0">·</span>
                    <span class="min-w-0 truncate">{e.relationType}</span>
                    <span class="text-muted-foreground shrink-0">→</span>
                    <span class="min-w-0 truncate" title={otherId}>
                      {#if other?.subtype}
                        <span class="text-muted-foreground">{other.subtype}</span>
                        <span class="text-muted-foreground"> · </span>
                      {/if}
                      {other?.label || otherId}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
            <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
              Edit
            </p>
            {#if entityEditorLoading}
              <div class="text-muted-foreground flex items-center gap-2 text-xs">
                <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                Loading…
              </div>
            {:else}
              {#if entityEditorErr}
                <p class="text-destructive text-xs">{entityEditorErr}</p>
              {/if}
              <div class="space-y-2">
                <Label for="graph-entity-label" class="text-xs">Label</Label>
                <Input
                  id="graph-entity-label"
                  bind:value={entityEditorDraft}
                  class="font-mono text-xs"
                  disabled={entityEditorBusy || entityEditorSyncBusy || entityEditorDeleteBusy}
                />
              </div>
              <div class="mt-3 space-y-2">
                <Label for="graph-entity-type" class="text-xs">Ontology kind key</Label>
                {#if ontologyEntityKindSelectOptions.length > 0}
                  <Select.Root type="single" bind:value={entityEditorEntityType}>
                    <Select.Trigger
                      id="graph-entity-type"
                      class="w-full font-mono text-xs"
                      disabled={entityEditorBusy ||
                        entityEditorSyncBusy ||
                        entityEditorDeleteBusy}
                    >
                      {entityEditorEntityType || "—"}
                    </Select.Trigger>
                    <Select.Content>
                      {#each ontologyEntityKindSelectOptions as opt (opt.value)}
                        <Select.Item value={opt.value}>{opt.label}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {:else}
                  <Input
                    id="graph-entity-type"
                    bind:value={entityEditorEntityType}
                    class="font-mono text-xs"
                    disabled={entityEditorBusy || entityEditorSyncBusy || entityEditorDeleteBusy}
                  />
                {/if}
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  class="shrink-0"
                  disabled={entityEditorBusy ||
                    entityEditorSyncBusy ||
                    entityEditorDeleteBusy ||
                    !entityEditorDraft.trim()}
                  onclick={() => void submitEntityUpdateFromGraph()}
                >
                  {#if entityEditorBusy}
                    <LoaderCircleIcon
                      class="mr-1 size-3 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                  {/if}
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="shrink-0"
                  disabled={entityEditorBusy || entityEditorSyncBusy || entityEditorDeleteBusy}
                  onclick={() => void submitEntitySyncFromGraph()}
                >
                  {#if entityEditorSyncBusy}
                    <LoaderCircleIcon
                      class="mr-1 size-3 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                  {/if}
                  Rearrange in graph
                </Button>
              </div>
              <p class="text-muted-foreground mt-2 text-[10px] leading-relaxed">
                Rearrange writes the saved row for this node back to the graph store so layout and
                edges stay consistent.
              </p>
              <div class="border-destructive/25 mt-4 border-t pt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  class="shrink-0"
                  disabled={entityEditorBusy ||
                    entityEditorSyncBusy ||
                    entityEditorDeleteBusy ||
                    entityEditorLoading}
                  onclick={() => openGraphEntityDeleteDialog()}
                >
                  {#if entityEditorDeleteBusy}
                    <LoaderCircleIcon
                      class="mr-1 size-3 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                  {/if}
                  Delete
                </Button>
              </div>
              {#if entityEditorStored && !entityEditorBusy && !entityEditorSyncBusy && !entityEditorDeleteBusy}
                <div class="text-muted-foreground mt-2 space-y-0.5 font-mono text-[10px]">
                  <p>
                    <span class="text-muted-foreground/80">Canonical key</span>
                    <span class="text-foreground"> · {entityEditorStored.canonicalKey}</span>
                  </p>
                </div>
              {/if}
              <div class="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
                <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                  Supporting captures (Postgres)
                </p>
                {#if entityCapturesLoading}
                  <div class="text-muted-foreground flex items-center gap-2 text-xs">
                    <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                    Loading…
                  </div>
                {:else if entityCapturesErr}
                  <p class="text-destructive text-xs">{entityCapturesErr}</p>
                {:else if entityCaptures.length === 0}
                  <p class="text-muted-foreground text-xs">
                    No linked captures for this entity yet.
                  </p>
                {:else}
                  <ul class="max-h-40 space-y-2 overflow-y-auto">
                    {#each entityCaptures as cap (cap.id)}
                      <li class="rounded-md border border-black/5 p-2 dark:border-white/10">
                        <p class="text-foreground line-clamp-2 text-xs">{cap.rawText}</p>
                        <div class="mt-2 flex items-center justify-between gap-2">
                          <span class="text-muted-foreground font-mono text-[10px]">
                            {cap.category}
                            {#if thoughtLifecycleStatus(cap.metadata) === "completed"}
                              <span class="text-accent ml-1">· completed</span>
                            {/if}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant={editingThoughtId === cap.id ? "default" : "outline"}
                            class="h-7 shrink-0 text-xs"
                            onclick={() => (editingThoughtId = cap.id)}
                          >
                            {editingThoughtId === cap.id ? "Editing" : "Edit"}
                          </Button>
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              {#if editingThoughtId}
                <div class="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
                  <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                    Edit capture
                  </p>
                  {#if thoughtEditorLoading}
                    <div class="text-muted-foreground flex items-center gap-2 text-xs">
                      <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                      Loading…
                    </div>
                  {:else}
                    {#if thoughtEditorErr}
                      <p class="text-destructive text-xs">{thoughtEditorErr}</p>
                    {/if}
                    <div class="space-y-2">
                      <Label for="graph-thought-body" class="text-xs">Raw text</Label>
                      <Textarea
                        id="graph-thought-body"
                        bind:value={thoughtEditorDraft}
                        rows={4}
                        class="font-mono text-xs"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy}
                      />
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy ||
                          !thoughtEditorDraft.trim()}
                        onclick={() => void submitThoughtUpdateFromGraph()}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy}
                        onclick={() => void submitThoughtRelinkFromGraph()}
                      >
                        {#if thoughtEditorRelinkBusy}
                          <LoaderCircleIcon
                            class="mr-1 size-3 shrink-0 animate-spin"
                            aria-hidden="true"
                          />
                        {/if}
                        Rearrange in graph
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy}
                        onclick={() => (editingThoughtId = null)}
                      >
                        Cancel
                      </Button>
                    </div>
                    <div class="border-destructive/25 mt-3 border-t pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy}
                        onclick={() => openGraphThoughtDeleteDialog()}
                      >
                        Delete capture
                      </Button>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </Drawer.Content>
  </Drawer.Root>

  <AlertDialog.Root
    bind:open={graphDeleteDialogOpen}
    onOpenChange={(open) => {
      if (!open && !graphDeleteBusy) graphDeleteTarget = null;
    }}
  >
    <AlertDialog.Content class="max-w-sm rounded-none border-2 border-black dark:border-border">
      <AlertDialog.Header>
        <AlertDialog.Title>{graphDeleteDialogCopy.title}</AlertDialog.Title>
        <AlertDialog.Description>{graphDeleteDialogCopy.description}</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel class="rounded-none" disabled={graphDeleteBusy}>Cancel</AlertDialog.Cancel>
        <Button
          type="button"
          variant="destructive"
          class="rounded-none"
          disabled={graphDeleteBusy}
          onclick={() => void confirmGraphNodeDelete()}
        >
          {graphDeleteBusy ? "Deleting…" : "Delete"}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</div>
