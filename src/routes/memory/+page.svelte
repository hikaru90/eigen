<script lang="ts">
  import type { PageData } from "./$types";
  import { invalidateAll } from "$app/navigation";
  import { browser } from "$app/environment";
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
  import MemorySurfaceDrawer from "$lib/components/memory-surface-drawer.svelte";
  import * as Select from "$lib/components/ui/select";
  import {
    nodeFillForGraph,
    customEntityFillsFromLegendSections,
    filterNodesByEntityTypes,
  } from "$lib/graph/graph-ontology-legend";
  import {
    filterNodesByAuthorLayers,
  } from "$lib/graph/graph-author-layers";
  import { filterGraphVizEdgesToNodes, resolveForceLinks } from "$lib/graph/sanitize-viz-snapshot";
  import {
    COMMUNITY_HULL_ACCENT,
    communityCircleFromPositions,
  } from "$lib/graph/community-hull";
  import {
    createDrawScheduler,
    drawGraphCanvasScene,
    findNearestGraphNode,
    GRAPH_CANVAS_POP_IN_DURATION_MS,
    GRAPH_NODE_HIT_PADDING,
    readGraphCanvasTheme,
    screenToWorld,
    type GraphCanvasHull,
    type GraphCanvasPopIn,
  } from "$lib/graph/graph-canvas-render";
  import {
    canonicalCommunityLevels,
    COMMUNITY_LEAF_LEVEL,
  } from "$lib/graph/community-levels";
  import {
    clustersForZoomLod,
    graphClusterBadgeRadius,
    graphZoomClusterExitScale,
    graphZoomClusterLevelForScale,
    graphZoomLodMode,
    isCoarsePointerGraphDevice,
    type GraphZoomCluster,
    type GraphZoomLodMode,
  } from "$lib/graph/graph-zoom-lod";
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
  import {
    ensureEmbeddingProjection,
    invalidateEmbeddingProjection,
  } from "$lib/graph/embedding-map-projection";
  import EmbeddingMap from "../graph/EmbeddingMap.svelte";
  import GraphFiltersToolbar from "../graph/graph-filters-toolbar.svelte";
  import MemoryAuthorBadge from "$lib/components/memory-author-badge.svelte";
  import ThoughtLinkedNotes from "$lib/components/thought-linked-notes.svelte";
  import type { EmbeddingSnapshotItem } from "../api/embeddings/snapshot/+server";
  import {
    GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE,
    graphEntitySyncStatusMessage,
  } from "$lib/graph/graph-i18n";
  import { m } from "$lib/paraglide/messages.js";
  import { graphFilters } from "$lib/stores/graph-filters";
  import { currentUserView } from "$lib/stores/current-user-view";
  import { viewToVisibleAuthorLayers } from "$lib/memory/current-user-view";
  import { get } from "svelte/store";

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
    get coMentionEdgeLayerKeys() {
      return data.coMentionEdgeLayerKeys ?? {};
    },
    get selectedCommunityLevel(): number | null {
      const parsed = Number.parseInt(communityLevel, 10);
      return Number.isFinite(parsed) ? parsed : null;
    },
  };

  /** Which tab is visible: graph or embedding map (driven by ?view=embeddings). */
  const activeTab = $derived<"graph" | "embeddings">(
    page.url.searchParams.get("view") === "embeddings" ? "embeddings" : "graph",
  );
  /** Mount embedding map only after first visit (projection prefetches from /memory layout). */
  let embeddingsTabOpened = $state(false);

  $effect(() => {
    if (activeTab === "embeddings") embeddingsTabOpened = true;
  });

  const legendSections = $derived(data.graphLegendSections ?? []);
  const ontologyEntityKindSelectOptions = $derived.by(() => {
    const sec = legendSections.find((s) => s.title === GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE);
    return (
      sec?.items.map((i) => ({
        value: i.key.replace(/^onto-entity-/, ""),
        label: i.label,
      })) ?? []
    );
  });

  let rootEl: HTMLDivElement | undefined;
  let search = $state($graphFilters.search);
  let edgeKind = $state<string>($graphFilters.edgeKind);
  let visibleEntityTypes = $state<Set<string>>($graphFilters.visibleEntityTypes);
  let visibleAuthorLayers = $state<Set<string>>($graphFilters.visibleAuthorLayers);
  let communityLevel = $state<string>($graphFilters.communityLevel);

  let dataView = $state(get(currentUserView));

  $effect(() => {
    return currentUserView.subscribe((view) => {
      dataView = view;
      visibleAuthorLayers = viewToVisibleAuthorLayers(view);
    });
  });
  
  // Sync filter state to store for persistence across tab switches
  $effect(() => {
    graphFilters.set({
      search,
      edgeKind,
      visibleEntityTypes,
      visibleAuthorLayers,
      communityLevel
    });
  });
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
    nodeDrawerOpen = selectedNode !== null || selectedCommunity !== null;
  });

  function onNodeDrawerOpenChange(open: boolean) {
    if (!open) {
      selectedNode = null;
      selectedCommunityId = null;
    }
  }

  function blurActiveElement() {
    if (!browser) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  }

  function beginThoughtEdit(thoughtId: string) {
    blurActiveElement();
    editingThoughtId = thoughtId;
  }

  function resetDocumentScroll() {
    if (!browser) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  /** Convert an embedding-map dot click into the same selectedNode shape so the detail panel works for both tabs. */
  function handleEmbeddingSelect(item: EmbeddingSnapshotItem | null) {
    blurActiveElement();
    if (!item) {
      selectedNode = null;
      return;
    }
    selectedNode = { id: item.id, kind: item.kind, label: item.label, subtype: item.subtype };
  }

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
  let graphProjectBusy = $state(false);
  let graphProjectErr = $state<string | null>(null);
  let entityEditorStored = $state<GraphEntityEditorStored | null>(null);
  let graphDeleteDialogOpen = $state(false);
  let graphDeleteTarget = $state<"thought" | "entity" | null>(null);

  const graphDeleteDialogCopy = $derived.by(() => {
    if (graphDeleteTarget === "entity") {
      return {
        title: m.graph_delete_entity_title(),
        description: m.graph_delete_entity_description(),
      };
    }
    return {
      title: m.graph_delete_capture_title(),
      description: m.graph_delete_capture_description(),
    };
  });

  const graphDeleteBusy = $derived(thoughtEditorDeleteBusy || entityEditorDeleteBusy);

  const thoughtIngestStatus = $derived(
    thoughtEditorPhase
      ? CAPTURE_INGEST_PHASE_COPY[thoughtEditorPhase]
      : {
          title: m.graph_working_title(),
          description: m.graph_working_description(),
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
          attachedFiles: row.attachedFiles ?? [],
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
    if (n?.kind === "Thought") {
      blurActiveElement();
      editingThoughtId = n.id;
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
      await refreshGraphAfterRearrange(m.graph_status_thought_saved());
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
      invalidateEmbeddingProjection();
      void ensureEmbeddingProjection(true);
      await invalidateAll();
      status = m.graph_status_memory_indexed();
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
      await refreshGraphAfterRearrange(m.graph_status_capture_relinked());
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
      await refreshGraphAfterRearrange(m.graph_status_entity_saved());
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
      await refreshGraphAfterRearrange(graphEntitySyncStatusMessage(added));
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

  async function declareEntityAsProject() {
    const node = selectedNode;
    if (!node || node.kind !== "Entity") return;
    const label = (node.label || entityEditorDraft).trim();
    if (!label) return;
    graphProjectBusy = true;
    graphProjectErr = null;
    try {
      const res = await fetch("/api/timeline/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, status: "active" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { entityId: string; label: string; status: string };
      selectedNode = {
        ...node,
        id: body.entityId,
        label: body.label,
        subtype: "project",
        projectStatus: body.status,
        projectSource: "manual",
      };
      await invalidateAll();
    } catch (e) {
      graphProjectErr = e instanceof Error ? e.message : String(e);
    } finally {
      graphProjectBusy = false;
    }
  }

  async function dismissEntityProject() {
    const node = selectedNode;
    if (!node || node.kind !== "Entity" || !node.id) return;
    graphProjectBusy = true;
    graphProjectErr = null;
    try {
      const res = await fetch(`/api/timeline/projects/${encodeURIComponent(node.id)}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      selectedNode = {
        ...node,
        projectStatus: "dismissed",
      };
      await invalidateAll();
    } catch (e) {
      graphProjectErr = e instanceof Error ? e.message : String(e);
    } finally {
      graphProjectBusy = false;
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
    visibleAuthorLayers;
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
    const thoughtId = page.url.searchParams.get("thought")?.trim();
    if (thoughtId) {
      const hit = data.snapshot.nodes.find(
        (node) => node.id === thoughtId && node.kind === "Thought",
      );
      selectedNode =
        hit ??
        ({
          id: thoughtId,
          kind: "Thought",
          label: thoughtId,
          subtype: "",
        } as (typeof data.snapshot.nodes)[number]);
    }

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
    const origBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    resetDocumentScroll();

    let lastVisualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const onVisualViewportResize = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      if (height > lastVisualViewportHeight) {
        resetDocumentScroll();
      }
      lastVisualViewportHeight = height;
    };
    window.visualViewport?.addEventListener("resize", onVisualViewportResize);

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

      const canvas = d3
        .select(rootEl)
        .append("canvas")
        .attr("class", "graph-canvas pointer-events-none absolute inset-0 block h-full w-full")
        .node() as HTMLCanvasElement;
      const canvasCtx = canvas.getContext("2d");
      if (!canvasCtx) return;

      const svg = d3
        .select(rootEl)
        .append("svg")
        .attr("class", "graph-svg absolute inset-0 block h-full w-full touch-none");

      const gZoom = svg.append("g");
      const gCommunityChrome = gZoom
        .append("g")
        .attr("class", "graph-community-chrome")
        .attr("pointer-events", "none");
      const gClusterMarkers = gZoom.append("g").attr("class", "graph-cluster-markers");

      const graphTooltip = d3
        .select(rootEl)
        .append("div")
        .attr("class", "graph-node-tooltip pointer-events-none absolute z-10 hidden max-w-[14rem] truncate whitespace-pre-line rounded border border-border/70 bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-foreground shadow-sm")
        .node() as HTMLDivElement;

      rootEl.style.position = "relative";

      const coarsePointerGraph = isCoarsePointerGraphDevice();
      let zoomLodMode: GraphZoomLodMode = "nodes";
      let currentZoomScale = 1;
      let currentZoomTransform = { k: 1, x: 0, y: 0 };
      let lastClusterRebuildKey = "";
      let zoomLabelEndTimer: ReturnType<typeof setTimeout> | undefined;
      const INITIAL_LAYOUT_SYNC_TICKS = 32;
      const ZOOM_LABEL_CHROME_DELAY_MS = 120;
      const DRAG_CLICK_THRESHOLD_PX = 4;

      let currentGraphNodes: SimNode[] = [];
      let currentGraphLinks: SimLink[] = [];
      let canvasHulls: GraphCanvasHull[] = [];
      const popInAnims = new Map<string, number>();
      let dragStartScreen: { x: number; y: number } | null = null;
      let didPointerDrag = false;
      let hoveredNodeId: string | null = null;

      function graphTheme() {
        return readGraphCanvasTheme(rootEl!);
      }

      function drawGraph() {
        if (!canvasCtx || !rootEl) return;
        const dims = resizeGraphViewport();
        if (!dims) return;

        const selectedId = selectedNode?.id ?? null;
        const nowMs = performance.now();
        let popInsStillAnimating = false;

        const popIns: GraphCanvasPopIn[] = [];
        for (const [nodeId, startMs] of popInAnims) {
          const elapsed = nowMs - startMs;
          if (elapsed < GRAPH_CANVAS_POP_IN_DURATION_MS) {
            popInsStillAnimating = true;
            popIns.push({
              nodeId,
              startMs,
              durationMs: GRAPH_CANVAS_POP_IN_DURATION_MS,
            });
          }
        }
        if (!popInsStillAnimating && popInAnims.size > 0) {
          popInAnims.clear();
        }

        if (zoomLodMode === "clusters") {
          canvasCtx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
          canvasCtx.clearRect(0, 0, dims.w, dims.h);
          if (popInsStillAnimating) drawScheduler.requestDraw();
          return;
        }

        drawGraphCanvasScene(canvasCtx, {
          width: dims.w,
          height: dims.h,
          dpr: dims.dpr,
          transform: currentZoomTransform,
          zoomScale: currentZoomScale,
          hulls: canvasHulls,
          links: currentGraphLinks.map((link) => ({
            sourceX: (link.source as SimNode).x ?? 0,
            sourceY: (link.source as SimNode).y ?? 0,
            targetX: (link.target as SimNode).x ?? 0,
            targetY: (link.target as SimNode).y ?? 0,
          })),
          nodes: currentGraphNodes.map((node) => ({
            id: node.id,
            x: node.x ?? 0,
            y: node.y ?? 0,
            radius: nodeRadius(node),
            fill: nodeFill(node),
            label: labelText(node),
            selected: selectedId === node.id,
          })),
          popIns,
          nowMs,
          theme: graphTheme(),
        });

        if (popInsStillAnimating) drawScheduler.requestDraw();
      }

      const drawScheduler = createDrawScheduler(drawGraph);

      function requestGraphDraw() {
        drawScheduler.requestDraw();
      }

      function flushZoomLabelChrome(scale: number) {
        applyLabelFontScale(scale);
        resizeSummaryLabelBackgrounds();
        bringFocusedSummaryToFront();
      }

      function scheduleZoomLabelChrome(scale: number, immediate = false) {
        currentZoomScale = scale;
        if (immediate) {
          if (zoomLabelEndTimer !== undefined) {
            clearTimeout(zoomLabelEndTimer);
            zoomLabelEndTimer = undefined;
          }
          flushZoomLabelChrome(scale);
          return;
        }
        applyLabelFontScale(scale);
        if (zoomLabelEndTimer !== undefined) clearTimeout(zoomLabelEndTimer);
        zoomLabelEndTimer = setTimeout(() => {
          zoomLabelEndTimer = undefined;
          flushZoomLabelChrome(currentZoomScale);
        }, ZOOM_LABEL_CHROME_DELAY_MS);
      }

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 8])
        .on("zoom", (event) => {
          currentZoomScale = event.transform.k;
          currentZoomTransform = {
            k: event.transform.k,
            x: event.transform.x,
            y: event.transform.y,
          };
          gZoom.attr("transform", event.transform.toString());
          applyZoomLod(event.transform.k);
          scheduleZoomLabelChrome(event.transform.k, !event.sourceEvent);
          requestGraphDraw();
        });
      svg.call(zoom);
      svg.on("click.details-clear", (event) => {
        const el = event.target as Element | null;
        if (didPointerDrag) {
          didPointerDrag = false;
          return;
        }
        if (!el?.closest?.(".community-hull-label-wrap") && !el?.closest?.(".graph-cluster")) {
          selectedCommunityId = null;
        }
        const svgEl = svg.node();
        if (!svgEl || zoomLodMode === "clusters") {
          if (!el?.closest?.(".community-hull-label-wrap") && !el?.closest?.(".graph-cluster")) {
            selectedNode = null;
          }
          return;
        }
        const [px, py] = d3.pointer(event, svgEl);
        const world = screenToWorld(px, py, currentZoomTransform);
        const hit = findSimNodeAtWorld(world.x, world.y);
        if (
          !hit &&
          !el?.closest?.(".community-hull-label-wrap") &&
          !el?.closest?.(".graph-cluster")
        ) {
          selectedNode = null;
        }
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
        resizeGraphViewport();
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
        resizeGraphViewport();

        const runPan = () => {
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
        };

        if (!simulation) {
          runPan();
          return;
        }

        let ticks = 0;
        const cap = 120;
        const step = () => {
          if (
            ticks >= cap ||
            (Number.isFinite(d.x) && Number.isFinite(d.y) && simulation!.alpha() <= 0.02)
          ) {
            runPan();
            return;
          }
          const batch = 8;
          for (let i = 0; i < batch && ticks < cap; i++) {
            simulation!.tick();
            ticks++;
          }
          ticked();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
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

      function resizeGraphViewport() {
        if (!rootEl) return;
        const w = rootEl.clientWidth;
        const h = Math.max(1, rootEl.clientHeight);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        svg.attr("width", w).attr("height", h);
        return { w, h, dpr };
      }

      let simulation: d3.Simulation<SimNode, SimLink> | null = null;
      let communityChromeGroupSelection = gCommunityChrome.selectAll<SVGGElement, CommunityHull>(
        "g.community-hull-chrome",
      );
      let clusterSelection = gClusterMarkers.selectAll<SVGGElement, GraphZoomCluster>("g.graph-cluster");

      function findSimNodeAtWorld(worldX: number, worldY: number): SimNode | null {
        const fromSim = simulation?.find(
          worldX,
          worldY,
          nodeRadius({} as SimNode) + GRAPH_NODE_HIT_PADDING,
        );
        if (fromSim) return fromSim;
        const nearest = findNearestGraphNode(
          worldX,
          worldY,
          currentGraphNodes.map((node) => ({
            id: node.id,
            x: node.x ?? 0,
            y: node.y ?? 0,
            radius: nodeRadius(node),
            fill: "",
            label: "",
            selected: false,
          })),
        );
        if (!nearest) return null;
        return currentGraphNodes.find((node) => node.id === nearest.id) ?? null;
      }

      let dragSubjectNode: SimNode | null = null;

      const pointerDrag = d3
        .drag<SVGSVGElement, unknown>()
        .filter((event) => {
          if (zoomLodMode === "clusters") return false;
          const svgEl = svg.node();
          if (!svgEl) return false;
          const [px, py] = d3.pointer(event, svgEl);
          const world = screenToWorld(px, py, currentZoomTransform);
          return findSimNodeAtWorld(world.x, world.y) !== null;
        })
        .subject((event) => {
          const svgEl = svg.node();
          if (!svgEl) return null;
          const [px, py] = d3.pointer(event, svgEl);
          const world = screenToWorld(px, py, currentZoomTransform);
          return findSimNodeAtWorld(world.x, world.y);
        })
        .on("start", (event) => {
          const d = event.subject as SimNode | null;
          if (!d) return;
          dragSubjectNode = d;
          dragStartScreen = { x: event.x, y: event.y };
          didPointerDrag = false;
          if (!event.active) simulation?.alphaTarget(0.35).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event) => {
          const d = dragSubjectNode;
          if (!d) return;
          const svgEl = svg.node();
          if (!svgEl) return;
          const [px, py] = d3.pointer(event, svgEl);
          const world = screenToWorld(px, py, currentZoomTransform);
          d.fx = world.x;
          d.fy = world.y;
          if (dragStartScreen) {
            const dist = Math.hypot(event.x - dragStartScreen.x, event.y - dragStartScreen.y);
            if (dist > DRAG_CLICK_THRESHOLD_PX) didPointerDrag = true;
          }
          requestGraphDraw();
        })
        .on("end", (event) => {
          const d = dragSubjectNode;
          dragSubjectNode = null;
          dragStartScreen = null;
          if (!d) return;
          if (!event.active) simulation?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
          if (!didPointerDrag) {
            onNodeClick(event.sourceEvent as MouseEvent, d);
          }
        });

      svg.call(pointerDrag);

      if (!coarsePointerGraph) {
        svg
          .on("pointermove.graph-tooltip", (event) => {
            if (zoomLodMode === "clusters") {
              graphTooltip.classList.add("hidden");
              hoveredNodeId = null;
              return;
            }
            const svgEl = svg.node();
            if (!svgEl || !rootEl) return;
            const [px, py] = d3.pointer(event, svgEl);
            const world = screenToWorld(px, py, currentZoomTransform);
            const hit = findSimNodeAtWorld(world.x, world.y);
            if (!hit) {
              graphTooltip.classList.add("hidden");
              hoveredNodeId = null;
              return;
            }
            if (hoveredNodeId !== hit.id) {
              hoveredNodeId = hit.id;
              graphTooltip.textContent = `${hit.kind}: ${hit.label || hit.id}\n${hit.subtype}`;
            }
            const rect = rootEl.getBoundingClientRect();
            graphTooltip.classList.remove("hidden");
            graphTooltip.style.left = `${event.clientX - rect.left + 12}px`;
            graphTooltip.style.top = `${event.clientY - rect.top + 12}px`;
          })
          .on("pointerleave.graph-tooltip", () => {
            graphTooltip.classList.add("hidden");
            hoveredNodeId = null;
          });
      }

      function nodeRadius(_d: SimNode) {
        return 8;
      }

      /** Summary label counter-scale — community hull and cluster labels stay legible at every zoom level */
      const MIN_SUMMARY_FONT_PX = 12;

      function counterScaleFont(base: number, k: number): number {
        return k < 1 ? Math.max(MIN_SUMMARY_FONT_PX, base / k) : base;
      }

      function applyLabelFontScale(k: number) {
        const hullLabelPx = counterScaleFont(14, k);
        const clusterLabelPx = counterScaleFont(14, k);
        const clusterCountPx = counterScaleFont(15, k);
        gCommunityChrome.selectAll<SVGTextElement, CommunityHull>('text.community-hull-label').style('font-size', `${hullLabelPx}px`);
        gClusterMarkers.selectAll<SVGTextElement, GraphZoomCluster>('text.graph-cluster-label').style('font-size', `${clusterLabelPx}px`);
        gClusterMarkers.selectAll<SVGTextElement, GraphZoomCluster>('text.graph-cluster-count').style('font-size', `${clusterCountPx}px`);
      }

      function resizeSummaryLabelBackgrounds() {
        gCommunityChrome.selectAll<SVGGElement, CommunityHull>('g.community-hull-label-wrap').each(function () {
          const wrap = d3.select(this);
          const text = wrap.select<SVGTextElement>('text.community-hull-label');
          const bg = wrap.select<SVGRectElement>('rect.community-hull-label-bg');
          if (text.empty() || bg.empty()) return;
          const bbox = text.node()?.getBBox();
          if (!bbox) return;
          bg.attr('x', bbox.x - 4).attr('y', bbox.y - 2).attr('width', bbox.width + 8).attr('height', bbox.height + 4);
        });
        gClusterMarkers.selectAll<SVGGElement, GraphZoomCluster>('g.graph-cluster-label-wrap').each(function () {
          const wrap = d3.select(this);
          const text = wrap.select<SVGTextElement>('text.graph-cluster-label');
          const bg = wrap.select<SVGRectElement>('rect.graph-cluster-label-bg');
          if (text.empty() || bg.empty()) return;
          const bbox = text.node()?.getBBox();
          if (!bbox) return;
          bg.attr('x', bbox.x - 4).attr('y', bbox.y - 2).attr('width', bbox.width + 8).attr('height', bbox.height + 4);
        });
      }

      function summaryLabelScreenDistance(
        bgNode: SVGRectElement,
        svgEl: SVGSVGElement,
        screenCx: number,
        screenCy: number,
      ): number | null {
        const ctm = bgNode.getCTM();
        if (!ctm) return null;
        const bbox = bgNode.getBBox();
        const p = svgEl.createSVGPoint();
        p.x = bbox.x + bbox.width / 2;
        p.y = bbox.y + bbox.height / 2;
        const s = p.matrixTransform(ctm);
        return Math.hypot(s.x - screenCx, s.y - screenCy);
      }

      /** Paint order: labels farther from screen center first, closest on top. */
      function orderSummaryGroupsByScreenCenter(
        container: d3.Selection<SVGGElement, unknown, null, undefined>,
        groupSelector: string,
        bgSelector: string,
      ) {
        const parent = container.node();
        const svgEl = svg.node();
        if (!parent || !svgEl || !rootEl) return;
        const screenCx = rootEl.clientWidth / 2;
        const screenCy = rootEl.clientHeight / 2;
        const ranked: { el: Element; dist: number }[] = [];
        container.selectAll<SVGGElement, unknown>(groupSelector).each(function () {
          const bgNode = d3.select(this).select<SVGRectElement>(bgSelector).node();
          if (!bgNode) return;
          const dist = summaryLabelScreenDistance(bgNode, svgEl, screenCx, screenCy);
          if (dist === null) return;
          ranked.push({ el: this as Element, dist });
        });
        ranked.sort((a, b) => b.dist - a.dist);
        for (const { el } of ranked) parent.appendChild(el);
      }

      /** Re-stack overlapping summary labels after zoom settles. */
      function bringFocusedSummaryToFront() {
        orderSummaryGroupsByScreenCenter(
          gCommunityChrome,
          'g.community-hull-chrome',
          'rect.community-hull-label-bg',
        );
        orderSummaryGroupsByScreenCenter(
          gClusterMarkers,
          'g.graph-cluster',
          'rect.graph-cluster-label-bg',
        );
      }

      let customEntityFills = new Map<string, string>();

      function nodeFill(d: SimNode) {
        return nodeFillForGraph(d.kind, d.subtype, customEntityFills);
      }

      function labelText(d: SimNode) {
        const base = d.label || d.id;
        return base.length > 42 ? `${base.slice(0, 40)}…` : base;
      }

      function applyHighlight(_selectedId: string | null) {
        requestGraphDraw();
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

      function syncCanvasHulls(hulls: CommunityHull[]) {
        canvasHulls = hulls.map((h) => ({
          id: h.id,
          level: h.level,
          cx: h.cx,
          cy: h.cy,
          r: h.r,
        }));
      }

      function rebuildCommunityHulls(nodes: SimNode[]) {
        const hulls = communityHullsForNodes(nodes);
        syncCanvasHulls(hulls);

        communityChromeGroupSelection = gCommunityChrome
          .selectAll<SVGGElement, CommunityHull>("g.community-hull-chrome")
          .data(hulls, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "community-hull-chrome");
              const labelWrap = g
                .append("g")
                .attr("class", "community-hull-label-wrap")
                .attr("pointer-events", "all");
              labelWrap
                .append("rect")
                .attr("class", "community-hull-label-bg")
                .attr("fill", COMMUNITY_HULL_ACCENT)
                .attr("rx", 3);
              labelWrap
                .append("text")
                .attr("class", "community-hull-label")
                .attr("text-anchor", "middle")
                .attr("font-size", "14px")
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
        scheduleZoomLabelChrome(currentZoomScale, true);
        requestGraphDraw();
      }

      /** Position-only hull update during force simulation ticks (no join / getBBox). */
      function positionCommunityHulls(nodes: SimNode[]) {
        const hulls = communityHullsForNodes(nodes);
        if (hulls.length === 0) {
          canvasHulls = [];
          return;
        }
        if (communityChromeGroupSelection.size() !== hulls.length) {
          rebuildCommunityHulls(nodes);
          return;
        }
        syncCanvasHulls(hulls);
        const hullById = new Map(hulls.map((h) => [h.id, h]));
        communityChromeGroupSelection.each(function (d) {
          const h = hullById.get(d.id);
          if (!h) return;
          const g = d3.select(this);
          g.attr("transform", `translate(${h.cx},${h.cy})`);
          g.select("g.community-hull-label-wrap").attr("transform", `translate(0, ${-(h.r + 8)})`);
        });
      }

      function nodePositionsForZoomLod(nodes: SimNode[]) {
        return nodes
          .map((n) => {
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { id: n.id, x, y, label: n.label };
          })
          .filter((n): n is { id: string; x: number; y: number; label: string } => n !== null);
      }

      function clusterRebuildKey(scale: number, nodes: SimNode[]): string {
        const levels = canonicalCommunityLevels(
          (vizCtx.communities ?? []).map((c) => c.level),
        );
        const level = graphZoomClusterLevelForScale(scale, levels);
        const scaleBucket = scale < 0.34 ? 0 : scale < 0.54 ? 1 : 2;
        return `${level ?? "spatial"}:${nodes.length}:${scaleBucket}`;
      }

      function rebuildClusterMarkers(scale: number, nodes: SimNode[]) {
        const positions = nodePositionsForZoomLod(nodes);
        const levels = canonicalCommunityLevels(
          (vizCtx.communities ?? []).map((c) => c.level),
        );
        const clusters = clustersForZoomLod(
          vizCtx.communities ?? [],
          positions,
          scale,
          levels,
          coarsePointerGraph,
        );

        clusterSelection = gClusterMarkers
          .selectAll<SVGGElement, GraphZoomCluster>("g.graph-cluster")
          .data(clusters, (d) => d.id)
          .join(
            (enter) => {
              const g = enter.append("g").attr("class", "graph-cluster");
              g.append("circle")
                .attr("class", "graph-cluster-hull")
                .attr("fill", "oklch(1 0 0 / 0.08)")
                .attr("stroke", "currentColor")
                .attr("stroke-opacity", 0.22)
                .attr("stroke-width", 1.25)
                .attr("stroke-dasharray", "8 5");
              g.append("circle")
                .attr("class", "graph-cluster-badge")
                .attr("fill", "#000000")
                .attr("stroke", "none");
              g.append("text")
                .attr("class", "graph-cluster-count")
                .attr("text-anchor", "middle")
                .attr("dy", "0.35em")
                .attr("font-size", "15px")
                .attr("font-family", "monospace")
                .attr("font-weight", "700")
                .attr("fill", COMMUNITY_HULL_ACCENT);
              const labelWrap = g.append("g").attr("class", "graph-cluster-label-wrap");
              labelWrap
                .append("rect")
                .attr("class", "graph-cluster-label-bg")
                .attr("fill", COMMUNITY_HULL_ACCENT)
                .attr("stroke", "none")
                .attr("rx", 3);
              labelWrap
                .append("text")
                .attr("class", "graph-cluster-label")
                .attr("text-anchor", "middle")
                .attr("font-size", "14px")
                .attr("font-family", "monospace")
                .attr("fill", "#000000")
                .attr("dy", "0.35em");
              return g;
            },
            (update) => update,
            (exit) => exit.remove(),
          )
          .attr("transform", (d) => `translate(${d.cx},${d.cy})`)
          .style("cursor", "pointer")
          .on("click", (event, cluster) => onClusterClick(event, cluster))
          .each(function (d) {
            const g = d3.select(this);
            const badgeR = graphClusterBadgeRadius(d.memberCount);
            g.select("circle.graph-cluster-hull").attr("r", d.r);
            g.select("circle.graph-cluster-badge").attr("r", badgeR);
            g.select("text.graph-cluster-count").text(String(d.memberCount));
            const label = d.name.length > 36 ? `${d.name.slice(0, 34)}…` : d.name;
            const labelWrap = g.select("g.graph-cluster-label-wrap");
            labelWrap.attr("transform", `translate(0, ${badgeR + 10})`);
            const labelText = labelWrap.select("text.graph-cluster-label").text(label);
            let labelBg = labelWrap.select<SVGRectElement>("rect.graph-cluster-label-bg");
            if (labelBg.empty()) {
              labelBg = labelWrap
                .insert("rect", "text")
                .attr("class", "graph-cluster-label-bg")
                .attr("fill", COMMUNITY_HULL_ACCENT)
                .attr("stroke", "none")
                .attr("rx", 3);
            }
            const bbox = (labelText.node() as SVGTextElement | null)?.getBBox();
            if (bbox) {
              labelBg
                .attr("x", bbox.x - 4)
                .attr("y", bbox.y - 2)
                .attr("width", bbox.width + 8)
                .attr("height", bbox.height + 4);
            }
            g.select("title").remove();
            if (d.description) {
              g.append("title").text(d.description);
            }
          });
        lastClusterRebuildKey = clusterRebuildKey(scale, nodes);
      }

      function maybeRebuildClusterMarkers(scale: number, nodes: SimNode[], force = false) {
        const key = clusterRebuildKey(scale, nodes);
        if (force || key !== lastClusterRebuildKey) {
          rebuildClusterMarkers(scale, nodes);
        }
      }

      function setZoomLodPresentation(mode: GraphZoomLodMode) {
        const clustered = mode === "clusters";
        gCommunityChrome.style("display", clustered ? "none" : null);
        gClusterMarkers.style("display", clustered ? null : "none");
        if (clustered) {
          simulation?.stop();
          simulation?.alphaTarget(0);
          maybeRebuildClusterMarkers(currentZoomScale, simulation?.nodes() ?? [], true);
        } else if (simulation) {
          simulation.alphaTarget(0);
          simulation.alpha(0.12).restart();
        }
        requestGraphDraw();
      }

      function applyZoomLod(scale: number) {
        const nextMode = graphZoomLodMode(scale, coarsePointerGraph, zoomLodMode);
        if (nextMode !== zoomLodMode) {
          zoomLodMode = nextMode;
          setZoomLodPresentation(zoomLodMode);
        }
        if (zoomLodMode === "clusters") {
          maybeRebuildClusterMarkers(scale, simulation?.nodes() ?? []);
        }
      }

      function zoomToCluster(cluster: GraphZoomCluster) {
        const svgEl = svg.node();
        if (!svgEl || !rootEl) return;
        resizeGraphViewport();

        const w = Math.max(1, rootEl.clientWidth);
        const h = Math.max(1, rootEl.clientHeight);
        const cx = w / 2;
        const cy = h / 2;
        const targetK = Math.min(8, graphZoomClusterExitScale(coarsePointerGraph) + 0.08);

        svg.interrupt("zoom-cluster");
        svg
          .transition("zoom-cluster")
          .duration(360)
          .ease(d3.easeCubicInOut)
          .call(zoom.scaleTo, targetK, [cx, cy])
          .transition()
          .duration(360)
          .ease(d3.easeCubicInOut)
          .call(zoom.translateTo, cluster.cx, cluster.cy, [cx, cy]);
      }

      function onClusterClick(event: MouseEvent, cluster: GraphZoomCluster) {
        event.stopPropagation();
        blurActiveElement();
        selectedNode = null;
        selectedCommunityId = cluster.level >= 0 ? cluster.id : null;
        scheduleApplyHighlight?.(null);
        zoomToCluster(cluster);
      }

      function ticked() {
        if (zoomLodMode === "nodes") {
          positionCommunityHulls(simulation?.nodes() ?? []);
        }
        requestGraphDraw();
      }

      function onNodeClick(event: MouseEvent, d: SimNode) {
        event.stopPropagation();
        blurActiveElement();
        selectedCommunityId = null;
        const prev = selectedNode;
        const hit = vizCtx.snapshot.nodes.find((n) => n.id === d.id && n.kind === "Entity");
        selectedNode = hit ?? null;
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
        const dims = resizeGraphViewport();
        if (!dims) return;

        customEntityFills = customEntityFillsFromLegendSections(vizCtx.legendSections);

        prunePersistentToSnapshot(vizCtx.snapshot);

        const rawNodes: SimNode[] = filterNodesByAuthorLayers(
          vizCtx.snapshot.nodes.filter((n) => n.kind === "Entity"),
          visibleAuthorLayers,
        ).map((n) => simNodeFromSnapshot(n));
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
          if (!visibleIds.has(e.sourceId) || !visibleIds.has(e.targetId)) return false;
          if (visibleAuthorLayers.size === 0) return true;
          if (e.kind === "entity_relation") return true;
          const a = e.sourceId;
          const b = e.targetId;
          const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`;
          const layers = vizCtx.coMentionEdgeLayerKeys[edgeKey] ?? [];
          return layers.some((key) => visibleAuthorLayers.has(key));
        };
        const safeEdges = filterGraphVizEdgesToNodes(
          vizCtx.snapshot.nodes,
          vizCtx.snapshot.edges.filter(edgeFilter),
        ).edges;
        const links: SimLink[] = resolveForceLinks(nodes, safeEdges);
        currentGraphNodes = nodes;
        currentGraphLinks = links;

        const popInIds = pendingPopInNodeIds;
        for (const nodeId of popInIds) {
          popInAnims.set(nodeId, performance.now());
        }

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
            .on("tick", ticked)
            .on("end", () => {
              if (zoomLodMode === "nodes" && simulation) {
                positionCommunityHulls(simulation.nodes());
              }
            });
          simulation.stop();
          for (let i = 0; i < INITIAL_LAYOUT_SYNC_TICKS; i++) simulation.tick();
          ticked();
          if (zoomLodMode !== "clusters") {
            simulation.restart();
          }
        } else {
          simulation.nodes(nodes);
          const linkForce = simulation.force("link") as ReturnType<
            typeof d3.forceLink<SimNode, SimLink>
          >;
          linkForce.links(links);
          simulation.force("x", d3.forceX<SimNode>(dims.w / 2).strength(0.08));
          simulation.force("y", d3.forceY<SimNode>(dims.h / 2).strength(0.08));
          simulation.force("collision", d3.forceCollide<SimNode>().radius(40));
          lastClusterRebuildKey = "";
          if (zoomLodMode === "clusters") {
            simulation.stop();
            simulation.alphaTarget(0);
            maybeRebuildClusterMarkers(currentZoomScale, nodes, true);
          } else if (pendingEnrichGraphUpdate) {
            seedPopInNodePositions(nodes, links, popInIds);
            pendingEnrichGraphUpdate = false;
            simulation.alpha(0.12).restart();
            restorePreservedGraphZoom();
          } else {
            simulation.alpha(0.35).restart();
          }
        }

        rebuildCommunityHulls(nodes);
        applyHighlight(selectedNode?.id ?? null);
        if (popInIds.size > 0) {
          pendingPopInNodeIds = new Set();
        }
        graphStats = m.graph_stats_nodes_edges({ nodes: nodes.length, edges: links.length });
        const svgEl = svg.node();
        if (svgEl) {
          const t = d3.zoomTransform(svgEl);
          currentZoomScale = t.k;
          currentZoomTransform = { k: t.k, x: t.x, y: t.y };
          applyZoomLod(currentZoomScale);
        }
        requestGraphDraw();
      }

      function resizeGraph() {
        const dims = resizeGraphViewport();
        requestGraphDraw();
        if (!dims || !simulation || zoomLodMode === "clusters") return;
        simulation.force("x", d3.forceX<SimNode>(dims.w / 2).strength(0.08));
        simulation.force("y", d3.forceY<SimNode>(dims.h / 2).strength(0.08));
        simulation.alpha(0.08).restart();
      }

      scheduleGraphUpdate = updateGraph;
      scheduleGraphResize = resizeGraph;
      scheduleGraphRelayout = () => {
        if (!simulation || zoomLodMode === "clusters") return;
        simulation.alpha(1).restart();
      };
      schedulePreserveGraphZoom = preserveGraphZoom;
      scheduleMarkEnrichGraphUpdate = () => {
        pendingEnrichGraphUpdate = true;
      };
      scheduleApplyHighlight = (id) => applyHighlight(id);
      scheduleRestorePreEntityZoom = scheduleRestorePreEntityZoomInner;
      scheduleUpdateCommunityHulls = () => {
        rebuildCommunityHulls(simulation?.nodes() ?? []);
      };

      let lastGraphResizeHeight: number | null = null;

      gClusterMarkers.style("display", "none");
      updateGraph();

      const ro = new ResizeObserver(() => {
        scheduleGraphResize?.();
        const h = rootEl?.clientHeight ?? 0;
        if (
          selectedNode &&
          !nodeDrawerOpen &&
          lastGraphResizeHeight !== null &&
          h !== lastGraphResizeHeight
        ) {
          maybeRecenterSelectedNode();
        }
        lastGraphResizeHeight = h;
      });
      ro.observe(rootEl);

      teardown = () => {
        cancelled = true;
        if (zoomLabelEndTimer !== undefined) clearTimeout(zoomLabelEndTimer);
        drawScheduler.dispose();
        enrichPollCancel();
        unsubCaptureQueue();
        for (const cancel of fastEnrichPollCancelByThoughtId.values()) cancel();
        fastEnrichPollCancelByThoughtId.clear();
        window.visualViewport?.removeEventListener("resize", onVisualViewportResize);
        document.documentElement.style.overflow = origHtmlOverflow;
        document.body.style.overflow = origBodyOverflow;
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
        svg.on("pointermove.graph-tooltip", null);
        svg.on("pointerleave.graph-tooltip", null);
        canvas.remove();
        graphTooltip.remove();
        if (rootEl) rootEl.style.position = "";
        svg.remove();
      };
    })();

    return () => teardown?.();
  });
</script>

<div class="-mb-28 h-svh overflow-hidden overscroll-none">
  <Card.Root class="p-0 relative flex h-full flex-col overflow-hidden bg-transparent shadow-none">
    <Tabs.Root value={activeTab} class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
              aria-label={m.graph_aria_visualization()}
            ></div>
            <div
              class="pointer-events-none absolute top-14 right-4 left-3 z-50 flex items-start justify-end gap-3 md:top-16"
              aria-label={m.graph_aria_legend_filters()}
            >
              <div
                class="pointer-events-auto flex shrink-0 flex-col items-end gap-1 overscroll-contain"
                onwheel={(e) => e.stopPropagation()}
              >
                <GraphFiltersToolbar
                  bind:search
                  bind:edgeKind
                  bind:communityLevel
                  {availableCommunityLevels}
                  {legendSections}
                  bind:visibleEntityTypes
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
              bind:visibleAuthorLayers
              onSelectItem={handleEmbeddingSelect}
              selectedItemId={selectedNode?.id ?? null}
            />
          {/if}
        </Tabs.Content>
      </Card.Content>
    </Tabs.Root>
  </Card.Root>

  <MemorySurfaceDrawer bind:open={nodeDrawerOpen} onOpenChange={onNodeDrawerOpenChange}>
      {#if selectedCommunity}
        <Drawer.Description class="sr-only">{m.graph_drawer_community_sr()}</Drawer.Description>
        <div
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-10"
          data-vaul-no-drag
        >
          <div class="flex items-start justify-between gap-3">
            <Drawer.Header class="min-w-0 flex-1 space-y-1 p-0 text-left">
              <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {m.graph_drawer_community()}
              </p>
              <Drawer.Title class="text-foreground text-sm font-semibold">
                {selectedCommunity.name || "—"}
              </Drawer.Title>
              <dl
                class="text-muted-foreground grid gap-x-4 gap-y-1 pt-1 font-mono text-[11px] sm:grid-cols-2"
              >
                <div class="contents">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_level()}</dt>
                  <dd class="text-foreground truncate">{selectedCommunity.levelLabel}</dd>
                </div>
                <div class="contents">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_scope()}</dt>
                  <dd class="text-foreground truncate">{selectedCommunity.levelIntent}</dd>
                </div>
                <div class="contents sm:col-span-2">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_members()}</dt>
                  <dd class="text-foreground truncate">
                    {m.graph_community_member_count({
                      count: selectedCommunity.memberEntityIds.length,
                    })}
                  </dd>
                </div>
              </dl>
            </Drawer.Header>
            <Drawer.Close
              class="text-destructive hover:text-destructive/80 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none"
              aria-label={m.graph_close()}
            >
              <X class="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </Drawer.Close>
          </div>
          <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
            <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
              {m.graph_drawer_summary()}
            </p>
            {#if selectedCommunity.description}
              <p class="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {selectedCommunity.description}
              </p>
            {:else}
              <p class="text-muted-foreground text-sm">{m.graph_no_community_summary()}</p>
            {/if}
          </div>
          {#if selectedCommunityMembers.length > 0}
            <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
              <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                {m.graph_drawer_entities({ count: selectedCommunityMembers.length })}
              </p>
              <ul class="space-y-1.5 font-mono text-[11px]">
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
      {:else if selectedNode}
        <Drawer.Description class="sr-only">{m.graph_drawer_node_sr()}</Drawer.Description>
        <div
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-10"
          data-vaul-no-drag
        >
          <div class="flex items-start justify-between gap-3">
            <Drawer.Header class="min-w-0 flex-1 space-y-1 p-0 text-left">
              <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {m.graph_drawer_node()}
              </p>
              <Drawer.Title class="text-foreground truncate text-sm font-semibold">
                {selectedNode.label || "—"}
              </Drawer.Title>
              {#if selectedNode.kind === "Thought" && thoughtEditorStored?.author === "agent"}
                <div class="pt-0.5">
                  <MemoryAuthorBadge
                    author={thoughtEditorStored.author}
                    authorLabel={thoughtEditorStored.authorLabel}
                  />
                </div>
              {/if}
              <dl
                class="text-muted-foreground grid gap-x-4 gap-y-1 pt-1 font-mono text-[11px] sm:grid-cols-2"
              >
                <div class="contents">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_kind()}</dt>
                  <dd class="text-foreground truncate">{selectedNode.kind}</dd>
                </div>
                <div class="contents">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_ontology()}</dt>
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
                {#if selectedNode.projectStatus}
                  <div class="contents">
                    <dt class="text-muted-foreground/80">{m.graph_timeline_projects()}</dt>
                    <dd class="text-foreground truncate">
                      {selectedNode.projectStatus}
                      {#if selectedNode.projectSource === "manual"}
                        <span class="text-muted-foreground"> · manual</span>
                      {/if}
                    </dd>
                  </div>
                {/if}
                <div class="contents sm:col-span-2">
                  <dt class="text-muted-foreground/80">{m.graph_drawer_id()}</dt>
                  <dd class="text-foreground truncate">{selectedNode.id}</dd>
                </div>
              </dl>
            </Drawer.Header>
            <Drawer.Close
              class="text-destructive hover:text-destructive/80 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none"
              aria-label={m.graph_close()}
            >
              <X class="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </Drawer.Close>
          </div>
          {#if selectedEdges.length > 0}
            <div class="mt-3 border-t border-black/5 pt-3 pb-3 dark:border-white/10">
              <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                {m.graph_drawer_connections({ count: selectedEdges.length })}
              </p>
              <ul class="space-y-1.5 font-mono text-[11px]">
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
          {#if selectedNode.kind === "Entity"}
          <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
            <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
              {m.graph_timeline_projects()}
            </p>
            {#if graphProjectErr}
              <p class="text-destructive mb-2 text-xs">{graphProjectErr}</p>
            {/if}
            <div class="flex flex-wrap gap-2">
              {#if !selectedNode.projectStatus || selectedNode.projectStatus === "dismissed"}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={graphProjectBusy || !entityEditorDraft.trim()}
                  onclick={() => void declareEntityAsProject()}
                >
                  {m.graph_timeline_create_project()}
                </Button>
              {:else if selectedNode.projectStatus === "active" || selectedNode.projectStatus === "someday"}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={graphProjectBusy}
                  onclick={() => void dismissEntityProject()}
                >
                  {m.graph_timeline_delete_project()}
                </Button>
              {/if}
            </div>
          </div>
          <div class="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
            <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
              {m.graph_drawer_edit()}
            </p>
            {#if entityEditorLoading}
              <div class="text-muted-foreground flex items-center gap-2 text-xs">
                <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                {m.graph_loading()}
              </div>
            {:else}
              {#if entityEditorErr}
                <p class="text-destructive text-xs">{entityEditorErr}</p>
              {/if}
              <div class="space-y-2">
                <Label for="graph-entity-label" class="text-xs">{m.graph_label()}</Label>
                <Input
                  id="graph-entity-label"
                  bind:value={entityEditorDraft}
                  class="font-mono text-xs"
                  disabled={entityEditorBusy || entityEditorSyncBusy || entityEditorDeleteBusy}
                />
              </div>
              <div class="mt-3 space-y-2">
                <Label for="graph-entity-type" class="text-xs">{m.graph_ontology_kind_key()}</Label>
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
                  {m.graph_save()}
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
                  {m.graph_rearrange_in_graph()}
                </Button>
              </div>
              <p class="text-muted-foreground mt-2 text-[10px] leading-relaxed">
                {m.graph_rearrange_entity_hint()}
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
                  {m.graph_delete()}
                </Button>
              </div>
              {#if entityEditorStored && !entityEditorBusy && !entityEditorSyncBusy && !entityEditorDeleteBusy}
                <div class="text-muted-foreground mt-2 space-y-0.5 font-mono text-[10px]">
                  <p>
                    <span class="text-muted-foreground/80">{m.graph_canonical_key()}</span>
                    <span class="text-foreground"> · {entityEditorStored.canonicalKey}</span>
                  </p>
                </div>
              {/if}
              <div class="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
                <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                  {m.graph_supporting_captures()}
                </p>
                {#if entityCapturesLoading}
                  <div class="text-muted-foreground flex items-center gap-2 text-xs">
                    <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                    {m.graph_loading()}
                  </div>
                {:else if entityCapturesErr}
                  <p class="text-destructive text-xs">{entityCapturesErr}</p>
                {:else if entityCaptures.length === 0}
                  <p class="text-muted-foreground text-xs">{m.graph_no_linked_captures()}</p>
                {:else}
                  <ul class="space-y-2">
                    {#each entityCaptures as cap (cap.id)}
                      <li class="rounded-md border border-black/5 p-2 dark:border-white/10">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-foreground line-clamp-2 flex-1 text-xs">{cap.rawText}</p>
                          {#if cap.author === "agent"}
                            <MemoryAuthorBadge author={cap.author} authorLabel={cap.authorLabel} />
                          {/if}
                        </div>
                        <div class="mt-2 flex items-center justify-between gap-2">
                          <span class="text-muted-foreground font-mono text-[10px]">
                            {cap.category}
                            {#if thoughtLifecycleStatus(cap.metadata) === "completed"}
                              <span class="text-accent ml-1">{m.graph_capture_completed()}</span>
                            {/if}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant={editingThoughtId === cap.id ? "default" : "outline"}
                            class="h-7 shrink-0 text-xs"
                            onclick={() => beginThoughtEdit(cap.id)}
                          >
                            {editingThoughtId === cap.id ? m.graph_editing() : m.graph_edit()}
                          </Button>
                        </div>
                        <ThoughtLinkedNotes files={cap.attachedFiles ?? []} compact />
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </div>
          {/if}

          {#if editingThoughtId}
                <div class="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
                  <p class="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                    {m.graph_edit_capture()}
                  </p>
                  {#if thoughtEditorLoading}
                    <div class="text-muted-foreground flex items-center gap-2 text-xs">
                      <LoaderCircleIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />
                      {m.graph_loading()}
                    </div>
                  {:else}
                    {#if thoughtEditorErr}
                      <p class="text-destructive text-xs">{thoughtEditorErr}</p>
                    {/if}
                    {#if selectedNode?.kind === "Thought" && thoughtEditorStored}
                      <p class="text-foreground mb-3 whitespace-pre-wrap text-xs">
                        {thoughtEditorStored.normalizedText}
                      </p>
                    {/if}
                    <div class="space-y-2">
                      <Label for="graph-thought-body" class="text-xs">{m.graph_raw_text()}</Label>
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
                    <ThoughtLinkedNotes files={thoughtEditorStored?.attachedFiles ?? []} />
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
                        {m.graph_save()}
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
                        {m.graph_rearrange_in_graph()}
                      </Button>
                      {#if selectedNode?.kind === "Entity"}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={thoughtEditorBusy ||
                          thoughtEditorRelinkBusy ||
                          thoughtEditorDeleteBusy}
                        onclick={() => (editingThoughtId = null)}
                      >
                        {m.graph_cancel()}
                      </Button>
                      {/if}
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
                        {m.graph_delete_capture()}
                      </Button>
                    </div>
                  {/if}
                </div>
              {/if}
        </div>
      {/if}
  </MemorySurfaceDrawer>

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
        <AlertDialog.Cancel class="rounded-none" disabled={graphDeleteBusy}
          >{m.graph_dialog_cancel()}</AlertDialog.Cancel
        >
        <Button
          type="button"
          variant="destructive"
          class="rounded-none"
          disabled={graphDeleteBusy}
          onclick={() => void confirmGraphNodeDelete()}
        >
          {graphDeleteBusy ? m.graph_dialog_deleting() : m.graph_dialog_delete()}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</div>
