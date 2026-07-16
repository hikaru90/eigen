<script lang="ts">
  import type { PageData } from "./$types";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Check from "@lucide/svelte/icons/check";
  import Circle from "@lucide/svelte/icons/circle";
  import X from "@lucide/svelte/icons/x";
  import { onDestroy, onMount } from "svelte";
  import {
    heartbeatProgressPctFromRun,
    isHeartbeatRunFullyComplete,
    resolveHeartbeatJobReport,
    type HeartbeatJobResult,
  } from "$lib/consolidation/heartbeat-progress";
  import { getHeartbeatJobPlan } from "$lib/consolidation/heartbeat-job-plan";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { resolve } from "$app/paths";

  let { data }: { data: PageData } = $props();

  type TaskRow = PageData["tasks"][number];
  type StepState = "done" | "failed" | "running" | "pending";
  type JobResult = HeartbeatJobResult;
  type DisplayRun = {
    runId: string;
    currentJob: string | null;
    plannedJobs: string[];
    jobs: JobResult[];
    progressPct: number;
    cancelRequested: boolean;
    live: boolean;
  };

  const POLL_MS = 250;

  type TrackedRun = {
    runId: string;
    plannedJobs: string[];
    currentJob: string | null;
    jobs: JobResult[];
    cancelRequested: boolean;
    finishedAt: number | null;
  };

  function toDisplayRun(run: TrackedRun): DisplayRun {
    return {
      runId: run.runId,
      currentJob: run.currentJob,
      plannedJobs: run.plannedJobs,
      jobs: run.jobs,
      progressPct: progressPctFromRun(run),
      cancelRequested: run.cancelRequested,
      live: run.finishedAt === null,
    };
  }

  let tasks = $state<TaskRow[]>([]);
  let pageError = $state<string | null>(null);

  $effect(() => {
    tasks = [...data.tasks];
    pageError = data.loadError ?? null;
  });
  let busyTaskId = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let trackedRun = $state<TrackedRun | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let stoppingTaskId = $state<string | null>(null);
  let expandedJobKey = $state<string | null>(null);
  let retryingJobKey = $state<string | null>(null);

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const isRunning = $derived(
    tasks.some((t) => t.activeRun !== null || t.lastRunStatus === "running") ||
      (trackedRun !== null && trackedRun.finishedAt === null)
  );

  function formatLastRun(task: TaskRow): string {
    if (task.activeRun || (trackedRun && trackedRun.finishedAt === null)) return "Running now…";
    if (!task.lastRunAt) return "Not run yet";
    const d = new Date(task.lastRunAt);
    if (Number.isNaN(d.getTime())) return "Not run yet";
    const status =
      task.lastRunStatus === "failed" || task.lastRunError
        ? " — had errors"
        : task.lastRunStatus === "cancelled"
          ? " — stopped"
          : "";
    return `${timeFmt.format(d)}${status}`;
  }

  function jobLabel(jobId: string): string {
    return jobId.replace(/_/g, " ");
  }

  function stepExpandKey(runId: string, jobId: string): string {
    return `${runId}:${jobId}`;
  }

  function toggleStepExpand(runId: string, jobId: string) {
    const key = stepExpandKey(runId, jobId);
    expandedJobKey = expandedJobKey === key ? null : key;
  }

  function isRunFullyComplete(run: {
    plannedJobs: string[];
    jobs: JobResult[];
    currentJob: string | null;
  }): boolean {
    return isHeartbeatRunFullyComplete(run);
  }

  function runStatusLabel(run: DisplayRun, task: TaskRow): string {
    if (run.live) {
      if (run.cancelRequested) return "Stopping after current step…";
      if (run.currentJob) return `Running ${jobLabel(run.currentJob)}…`;
      return "Starting…";
    }
    if (task.lastRunStatus === "cancelled" || run.cancelRequested) return "Stopped";
    if (task.lastRunStatus === "completed") return "Finished";
    if (task.lastRunStatus === "failed") return "Failed";
    if (!isRunFullyComplete(run)) return "Failed";
    return "Finished";
  }

  function progressPctFromRun(
    run: {
      plannedJobs: string[];
      jobs: JobResult[];
      currentJob: string | null;
    },
    summaryStats?: { summarized: number; total: number } | null
  ): number {
    return heartbeatProgressPctFromRun(run, summaryStats, { capIncompleteAt99: true });
  }

  function stepState(run: DisplayRun, jobId: string): StepState {
    const completed = run.jobs.find((j) => j.job === jobId);
    if (completed) return completed.ok ? "done" : "failed";
    if (run.currentJob === jobId) return "running";
    return "pending";
  }

  function stepDetail(
    jobId: string,
    run: DisplayRun,
    task: TaskRow
  ): string | null {
    const completed = run.jobs.find((j) => j.job === jobId);
    if (completed?.report?.summary) return completed.report.summary;
    if (completed?.detail) return completed.detail;
    if (jobId !== "community_summaries") return null;
    const stats = task.activeRun?.summaryStats;
    if (!stats || stats.total === 0) return null;
    const base = `${stats.summarized} of ${stats.total} L1 routing summaries`;
    return stats.pending > 0 ? `${base}, ${stats.pending} pending` : base;
  }

  function stepReport(jobId: string, run: DisplayRun, task: TaskRow) {
    const completed = run.jobs.find((j) => j.job === jobId) ?? null;
    const liveDetail =
      jobId === "community_summaries" && !completed
        ? stepDetail(jobId, run, task)
        : null;
    return resolveHeartbeatJobReport(jobId, completed, { liveDetail });
  }

  function displayRunFor(task: TaskRow): DisplayRun | null {
    if (task.activeRun) {
      const runState = {
        plannedJobs: task.activeRun.plannedJobs,
        jobs: task.activeRun.jobs,
        currentJob: task.activeRun.currentJob,
      };
      return {
        runId: task.activeRun.runId,
        currentJob: task.activeRun.currentJob,
        plannedJobs: task.activeRun.plannedJobs,
        jobs: task.activeRun.jobs,
        progressPct: progressPctFromRun(runState, task.activeRun.summaryStats),
        cancelRequested: task.activeRun.cancelRequested,
        live: true,
      };
    }
    if (trackedRun) return toDisplayRun(trackedRun);
    if (task.lastRunJobs && task.lastRunJobs.length > 0) {
      const plannedJobs = getHeartbeatJobPlan();
      const jobs = task.lastRunJobs;
      const runState = { plannedJobs, jobs, currentJob: null };
      return {
        runId: task.lastRunId ?? `last:${task.lastRunAt ?? "unknown"}`,
        currentJob: null,
        plannedJobs,
        jobs,
        progressPct: progressPctFromRun(runState),
        cancelRequested: task.lastRunStatus === "cancelled",
        live: false,
      };
    }
    return null;
  }

  async function retryFailedStep(task: TaskRow, run: DisplayRun, jobId: string) {
    if (run.live || retryingJobKey !== null || busyTaskId !== null) return;
    if (!task.lastRunId && !run.runId) return;
    const runId = task.lastRunId ?? run.runId;
    if (runId.startsWith("last:")) {
      actionError = "Cannot retry this step — run id is missing. Refresh and try again.";
      return;
    }
    const key = stepExpandKey(runId, jobId);
    retryingJobKey = key;
    actionMessage = null;
    actionError = null;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, jobId }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        job?: { ok?: boolean; detail?: string };
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await refreshTasks();
      actionMessage =
        body.message ??
        (body.job?.ok ? `Retried ${jobLabel(jobId)} successfully.` : `Retry of ${jobLabel(jobId)} failed again.`);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      retryingJobKey = null;
    }
  }

  function syncTrackedRun(task: TaskRow) {
    if (task.activeRun) {
      trackedRun = {
        runId: task.activeRun.runId,
        plannedJobs: task.activeRun.plannedJobs,
        currentJob: task.activeRun.currentJob,
        jobs: task.activeRun.jobs,
        cancelRequested: task.activeRun.cancelRequested,
        finishedAt: null,
      };
      busyTaskId = null;
      return;
    }

    if (!trackedRun) return;

    if (
      trackedRun.finishedAt === null &&
      !task.activeRun &&
      task.lastRunStatus &&
      task.lastRunStatus !== "running"
    ) {
      if (task.lastRunJobs?.length) {
        trackedRun.jobs = task.lastRunJobs;
      }
      trackedRun.currentJob = null;
      trackedRun.finishedAt = Date.now();
      busyTaskId = null;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => void refreshTasks(), POLL_MS);
  }

  async function refreshTasks() {
    const res = await fetch("/api/scheduled-tasks");
    if (!res.ok) {
      throw new Error(`Could not refresh (${res.status})`);
    }
    const body = (await res.json()) as { tasks: TaskRow[]; error?: string };
    tasks = body.tasks;
    if (body.error) pageError = body.error;
    const task = body.tasks[0];
    if (task) syncTrackedRun(task);

    const serverRunning = body.tasks.some(
      (t) => t.activeRun !== null || t.lastRunStatus === "running" || t.queueActive
    );

    if (!serverRunning && trackedRun !== null && trackedRun.finishedAt === null) {
      trackedRun = {
        ...trackedRun,
        currentJob: null,
        finishedAt: Date.now(),
      };
    }

    const trackedLive = trackedRun !== null && trackedRun.finishedAt === null;

    if (!serverRunning && !trackedLive) {
      if (task?.lastRunStatus === "cancelled") {
        actionMessage = "Heartbeat stopped.";
      } else if (task?.lastRunStatus === "completed") {
        actionMessage = "Heartbeat finished.";
      } else if (task?.lastRunStatus === "failed") {
        actionMessage = task.lastRunError ?? "Heartbeat did not complete.";
      }
      stopPolling();
      busyTaskId = null;
    }
  }

  async function togglePause(task: TaskRow) {
    if (busyTaskId || task.activeRun || !task.configured) return;
    busyTaskId = task.id;
    actionMessage = null;
    actionError = null;
    const paused = task.active;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await refreshTasks();
      actionMessage = paused
        ? "Overnight heartbeat is paused."
        : "Overnight heartbeat is scheduled again.";
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busyTaskId = null;
    }
  }

  async function runNow(task: TaskRow) {
    if (busyTaskId || task.activeRun || (trackedRun !== null && trackedRun.finishedAt === null))
      return;
    busyTaskId = task.id;
    actionMessage = null;
    actionError = null;
    trackedRun = null;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        status?: string;
        runId?: string;
        jobId?: string;
        plannedJobs?: string[];
      };
      if (res.status === 409) {
        actionMessage = "Heartbeat is already running — click Stop to cancel it, then Run now.";
        startPolling();
        await refreshTasks();
        busyTaskId = null;
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const plannedJobs = body.plannedJobs?.length
        ? body.plannedJobs
        : [];
      trackedRun = {
        runId: body.runId ?? body.jobId ?? "pending",
        plannedJobs,
        currentJob: plannedJobs[0] ?? null,
        jobs: [],
        cancelRequested: false,
        finishedAt: null,
      };
      actionMessage = body.message ?? "Heartbeat started.";
      startPolling();
      await refreshTasks();
      // Keep Stop visible until the server reports an active run or completion.
      if (tasks.some((t) => t.activeRun !== null)) {
        busyTaskId = null;
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      // Server may still have started — poll so Stop / progress can appear.
      startPolling();
      try {
        await refreshTasks();
      } catch {
        /* ignore refresh failure after network error */
      }
      if (!tasks.some((t) => t.activeRun !== null) && trackedRun === null) {
        busyTaskId = null;
      }
    }
  }

  async function stopRun(task: TaskRow) {
    const live =
      busyTaskId === task.id ||
      task.activeRun !== null ||
      task.queueActive ||
      (trackedRun !== null && trackedRun.finishedAt === null);
    if (!live && task.lastRunStatus !== "running") return;
    stoppingTaskId = task.id;
    actionError = null;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        softCancelled?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      actionMessage = body.message ?? "Heartbeat stopped.";
      if (trackedRun && trackedRun.finishedAt === null) {
        trackedRun = {
          ...trackedRun,
          cancelRequested: true,
          currentJob: null,
          finishedAt: body.softCancelled ? null : Date.now(),
        };
      }
      startPolling();
      await refreshTasks();
      if (!body.softCancelled) {
        busyTaskId = null;
        trackedRun = trackedRun
          ? { ...trackedRun, finishedAt: trackedRun.finishedAt ?? Date.now(), cancelRequested: true }
          : null;
        stopPolling();
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      stoppingTaskId = null;
    }
  }

  onMount(() => {
    if (isRunning) startPolling();
  });

  onDestroy(() => {
    stopPolling();
  });
</script>

<svelte:head>
  <title>Heartbeat · Eigen Mesh</title>
</svelte:head>

<main class="mx-auto max-w-lg px-5 pb-16 pt-24">
  <h1 class="text-lg font-semibold tracking-tight">Heartbeat</h1>
  <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
    A background rhythm that organizes and maintains your memories. Use Stop to cancel a run in
    progress (work already finished is kept). Pause schedule only affects the overnight timer —
    not a mid-run stop.
  </p>

  {#if pageError}
    <p class="text-destructive mt-4 text-sm">{pageError}</p>
  {/if}

  {#if actionMessage}
    <p class="text-muted-foreground mt-4 text-sm">{actionMessage}</p>
  {/if}
  {#if actionError}
    <p class="text-destructive mt-2 text-sm">{actionError}</p>
  {/if}

  <ul class="mt-6 flex flex-col gap-4">
    {#each tasks as task (task.id)}
      {@const run = displayRunFor(task)}
      <li>
        <Card.Root class="gap-3 p-4">
          <div class="flex items-start gap-3">
            <div
              class="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <HeartPulse class="size-4 opacity-80" strokeWidth={1.75} />
            </div>
            <div class="min-w-0 flex-1">
              <Card.Title class="text-sm">{task.title}</Card.Title>
              <Card.Description class="mt-1 text-xs leading-relaxed">
                {task.description}
              </Card.Description>
              <p class="text-muted-foreground mt-2 font-mono text-[11px]">{task.scheduleLabel}</p>
              <p class="text-muted-foreground mt-1 text-[11px]">
                Last run: {formatLastRun(task)}
              </p>

              {#if run}
                <div class="mt-3 space-y-2">
                  <div class="flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-muted-foreground">
                      {runStatusLabel(run, task)}
                    </span>
                    <span class="text-muted-foreground font-mono tabular-nums">
                      {run.progressPct}%
                    </span>
                  </div>
                  <div
                    class="bg-muted h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={run.progressPct}
                    aria-label="Heartbeat progress"
                  >
                    <div
                      class="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
                      style:width="{run.progressPct}%"
                    ></div>
                  </div>
                  <ul class="space-y-1.5 pt-1">
                    {#each run.plannedJobs as jobId (jobId)}
                      {@const state = stepState(run, jobId)}
                      {@const detail = stepDetail(jobId, run, task)}
                      {@const report = stepReport(jobId, run, task)}
                      {@const expandKey = stepExpandKey(run.runId, jobId)}
                      {@const expanded = expandedJobKey === expandKey}
                      {@const stepRetrying = retryingJobKey === expandKey}
                      <li class="text-[11px] leading-relaxed">
                        <button
                          type="button"
                          class="hover:bg-muted/50 -mx-1 flex w-[calc(100%+0.5rem)] items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors"
                          aria-expanded={expanded}
                          onclick={() => toggleStepExpand(run.runId, jobId)}
                        >
                          <ChevronRight
                            class="text-muted-foreground mt-0.5 size-3.5 shrink-0 transition-transform {expanded
                              ? 'rotate-90'
                              : ''}"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span class="mt-0.5 shrink-0" aria-hidden="true">
                            {#if state === "running"}
                              <LoaderCircle class="text-primary size-3.5 animate-spin" />
                            {:else if state === "done"}
                              <Check class="size-3.5 text-green-600 dark:text-green-400" />
                            {:else if state === "failed"}
                              <X class="text-destructive size-3.5" />
                            {:else}
                              <Circle class="text-muted-foreground/40 size-3.5" />
                            {/if}
                          </span>
                          <span
                            class="min-w-0 flex-1 {state === 'running'
                              ? 'text-foreground'
                              : state === 'done'
                                ? 'text-muted-foreground'
                                : state === 'failed'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground/60'}"
                          >
                            {jobLabel(jobId)}
                            {#if detail}
                              <span
                                class={state === "failed"
                                  ? "text-destructive"
                                  : "text-muted-foreground"}
                              >
                                — {detail}
                              </span>
                            {:else if state === "failed"}
                              <span class="text-destructive"> — failed</span>
                            {/if}
                          </span>
                        </button>
                        {#if expanded}
                          <div
                            class="border-border/50 bg-muted/30 mt-1 ml-5 space-y-2 rounded-md border px-2.5 py-2"
                          >
                            <p class="text-muted-foreground text-[11px] leading-relaxed">
                              {report.explanation}
                            </p>
                            <p
                              class="text-[11px] font-medium {report.verdict === 'attention'
                                ? 'text-amber-700 dark:text-amber-400'
                                : report.verdict === 'healthy'
                                  ? 'text-green-700 dark:text-green-400'
                                  : 'text-foreground'}"
                            >
                              {report.verdictLabel}
                            </p>
                            {#if report.samples && report.samples.length > 0}
                              <p class="text-foreground text-[10px] font-medium tracking-wide uppercase">
                                What changed
                              </p>
                              <ul class="space-y-1">
                                {#each report.samples as sample, i (sample.id ?? `${sample.label}-${i}`)}
                                  <li class="text-muted-foreground text-[11px] leading-snug">
                                    {#if sample.kind === "thought" && sample.id}
                                      <a
                                        href="{resolve('/memory')}?thought={encodeURIComponent(sample.id)}"
                                        class="text-foreground underline-offset-2 hover:underline"
                                      >
                                        {sample.label}
                                      </a>
                                    {:else}
                                      <span class="text-foreground">{sample.label}</span>
                                    {/if}
                                    {#if sample.note}
                                      <span class="text-muted-foreground"> — {sample.note}</span>
                                    {/if}
                                  </li>
                                {/each}
                              </ul>
                              {#if report.sampleNote}
                                <p class="text-muted-foreground/80 text-[10px]">
                                  {report.sampleNote}
                                </p>
                              {/if}
                            {:else if state === "done" || state === "failed"}
                              <p class="text-muted-foreground/80 text-[10px]">
                                No item change log for this step (often means nothing was
                                deleted/merged — expand still explains how to judge the counts).
                              </p>
                            {/if}
                            {#if state === "failed" && !run.live}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                class="mt-1 h-7 text-[11px]"
                                disabled={retryingJobKey !== null ||
                                  busyTaskId !== null ||
                                  task.queueActive}
                                onclick={(e) => {
                                  e.stopPropagation();
                                  void retryFailedStep(task, run, jobId);
                                }}
                              >
                                {#if stepRetrying}
                                  <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
                                {:else}
                                  <RotateCw class="size-3.5 shrink-0" aria-hidden="true" />
                                {/if}
                                Retry step
                              </Button>
                            {/if}
                          </div>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {:else if task.lastRunError}
                <p class="text-destructive mt-2 text-[11px] leading-relaxed">{task.lastRunError}</p>
              {/if}

              {#if !task.configured}
                <p class="text-muted-foreground mt-2 text-[11px]">
                  Not set up on this server yet (requires database scheduler).
                </p>
              {:else if !task.active && !run}
                <p class="text-amber-700 dark:text-amber-400 mt-2 text-[11px]">Paused</p>
              {/if}
            </div>
          </div>
          <div class="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            {#if (run?.live ?? false) || task.activeRun || busyTaskId === task.id || task.queueActive}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={run?.cancelRequested === true || stoppingTaskId === task.id}
                onclick={() => void stopRun(task)}
              >
                {#if stoppingTaskId === task.id}
                  <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
                {:else}
                  <Square class="size-3.5 shrink-0" aria-hidden="true" />
                {/if}
                Stop
              </Button>
            {:else}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyTaskId !== null || retryingJobKey !== null}
                onclick={() => void runNow(task)}
              >
                {#if busyTaskId === task.id}
                  <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
                {:else}
                  <Play class="size-3.5 shrink-0" aria-hidden="true" />
                {/if}
                Run now
              </Button>
            {/if}
            {#if task.configured}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyTaskId !== null || (run?.live ?? false) || task.activeRun !== null}
                onclick={() => void togglePause(task)}
              >
                {#if task.active}
                  <Pause class="size-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <Play class="size-3.5 shrink-0" aria-hidden="true" />
                {/if}
                {task.active ? "Pause schedule" : "Resume schedule"}
              </Button>
            {/if}
          </div>
        </Card.Root>
      </li>
    {:else}
      <li class="text-muted-foreground text-sm">No heartbeat is configured.</li>
    {/each}
  </ul>
</main>
