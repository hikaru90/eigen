<script lang="ts">
  import type { PageData } from "./$types";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import Square from "@lucide/svelte/icons/square";
  import Check from "@lucide/svelte/icons/check";
  import Circle from "@lucide/svelte/icons/circle";
  import X from "@lucide/svelte/icons/x";
  import { onDestroy, onMount } from "svelte";

  let { data }: { data: PageData } = $props();

  type TaskRow = PageData["tasks"][number];
  type StepState = "done" | "failed" | "running" | "pending";
  type JobResult = { job: string; ok: boolean; detail?: string };
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

  let tasks = $state<TaskRow[]>([...data.tasks]);
  let pageError = $state<string | null>(data.loadError ?? null);
  let busyTaskId = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let trackedRun = $state<TrackedRun | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let stoppingTaskId = $state<string | null>(null);

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

  function parseSummaryProgress(detail?: string): { summarized: number; total: number; pending: number } | null {
    if (!detail) return null;
    const counts = detail.match(/(\d+) of (\d+) summarized/);
    if (!counts) return null;
    const summarized = Number(counts[1]);
    const total = Number(counts[2]);
    if (!Number.isFinite(summarized) || !Number.isFinite(total) || total <= 0) return null;
    const pendingMatch = detail.match(/(\d+) pending/);
    const pending = pendingMatch ? Number(pendingMatch[1]) : Math.max(0, total - summarized);
    return { summarized, total, pending };
  }

  function isRunFullyComplete(run: {
    plannedJobs: string[];
    jobs: JobResult[];
    currentJob: string | null;
  }): boolean {
    if (run.currentJob) return false;
    if (run.jobs.length !== run.plannedJobs.length) return false;
    if (run.jobs.some((j) => !j.ok)) return false;
    const summaryJob = run.jobs.find((j) => j.job === "community_summaries");
    if (summaryJob) {
      const parsed = parseSummaryProgress(summaryJob.detail);
      if (parsed && parsed.pending > 0) return false;
    }
    return true;
  }

  function runStatusLabel(run: DisplayRun, task: TaskRow): string {
    if (run.live) {
      if (run.cancelRequested) return "Stopping after current step…";
      if (run.currentJob) return `Running ${jobLabel(run.currentJob)}…`;
      return "Starting…";
    }
    if (task.lastRunStatus === "cancelled" || run.cancelRequested) return "Stopped";
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
    const planned = run.plannedJobs.length;
    if (planned === 0) return 0;
    const completed = run.jobs.length;
    const inFlight = run.currentJob ? 0.5 : 0;
    let pct = ((completed + inFlight) / planned) * 100;

    const summariesJobIndex = run.plannedJobs.indexOf("community_summaries");
    if (summariesJobIndex >= 0) {
      if (run.currentJob === "community_summaries" && summaryStats && summaryStats.total > 0) {
        pct = ((summariesJobIndex + summaryStats.summarized / summaryStats.total) / planned) * 100;
      } else if (!run.currentJob && completed >= summariesJobIndex + 1) {
        const summaryJob = run.jobs.find((j) => j.job === "community_summaries");
        const parsed = parseSummaryProgress(summaryJob?.detail);
        if (parsed && parsed.total > 0) {
          pct = ((summariesJobIndex + parsed.summarized / parsed.total) / planned) * 100;
        }
      }
    }

    const rounded = Math.round(pct);
    if (!isRunFullyComplete(run)) return Math.min(99, rounded);
    return 100;
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
    if (completed?.detail) return completed.detail;
    if (jobId !== "community_summaries") return null;
    const stats = task.activeRun?.summaryStats;
    if (!stats || stats.total === 0) return null;
    const base = `${stats.summarized} of ${stats.total} summarized`;
    return stats.pending > 0 ? `${base}, ${stats.pending} pending` : base;
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
    return null;
  }

  function syncTrackedRun(task: TaskRow) {
    if (!trackedRun) return;

    if (task.activeRun?.runId === trackedRun.runId) {
      trackedRun.plannedJobs = task.activeRun.plannedJobs;
      trackedRun.currentJob = task.activeRun.currentJob;
      trackedRun.jobs = task.activeRun.jobs;
      trackedRun.cancelRequested = task.activeRun.cancelRequested;
      trackedRun.finishedAt = null;
      return;
    }

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
      (t) => t.activeRun !== null || t.lastRunStatus === "running"
    );
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
        plannedJobs?: string[];
      };
      if (res.status === 409) {
        actionMessage = "Heartbeat is already running.";
        startPolling();
        await refreshTasks();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      if (body.runId && body.plannedJobs?.length) {
        trackedRun = {
          runId: body.runId,
          plannedJobs: body.plannedJobs,
          currentJob: body.plannedJobs[0] ?? null,
          jobs: [],
          cancelRequested: false,
          finishedAt: null,
        };
      }
      actionMessage = body.message ?? "Heartbeat queued.";
      startPolling();
      busyTaskId = null;
      await refreshTasks();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      busyTaskId = null;
      trackedRun = null;
    }
  }

  async function stopRun(task: TaskRow) {
    const live = task.activeRun !== null || (trackedRun !== null && trackedRun.finishedAt === null);
    if (!live) return;
    stoppingTaskId = task.id;
    actionError = null;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      actionMessage = body.message ?? "Stop requested.";
      await refreshTasks();
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
  <title>Heartbeat · Eigen</title>
</svelte:head>

<main class="mx-auto max-w-lg px-5 pb-16 pt-24">
  <h1 class="text-lg font-semibold tracking-tight">Heartbeat</h1>
  <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
    A background rhythm that organizes and maintains your memories. You can run it early or pause
    the overnight heartbeat if needed.
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
                      <li class="flex items-start gap-2 text-[11px] leading-relaxed">
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
                          class={state === "running"
                            ? "text-foreground"
                            : state === "done"
                              ? "text-muted-foreground"
                              : state === "failed"
                                ? "text-destructive"
                                : "text-muted-foreground/60"}
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
            {#if (run?.live ?? false) || task.activeRun}
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
                disabled={busyTaskId !== null}
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
                disabled={busyTaskId !== null || (run?.live ?? false)}
                onclick={() => void togglePause(task)}
              >
                {#if task.active}
                  <Pause class="size-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <Play class="size-3.5 shrink-0" aria-hidden="true" />
                {/if}
                {task.active ? "Pause" : "Resume"}
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
