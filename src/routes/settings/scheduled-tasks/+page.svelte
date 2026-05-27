<script lang="ts">
  import type { PageData } from "./$types";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";

  let { data }: { data: PageData } = $props();

  type TaskRow = PageData["tasks"][number];

  let tasks = $state<TaskRow[]>([...data.tasks]);
  let pageError = $state<string | null>(data.loadError ?? null);
  let busyTaskId = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function formatLastRun(task: TaskRow): string {
    if (!task.lastRunAt) return "Not run yet";
    const d = new Date(task.lastRunAt);
    if (Number.isNaN(d.getTime())) return "Not run yet";
    const status =
      task.lastRunStatus === "failed" || task.lastRunError
        ? " — had errors"
        : task.lastRunStatus === "running"
          ? " — in progress"
          : "";
    return `${timeFmt.format(d)}${status}`;
  }

  async function refreshTasks() {
    const res = await fetch("/api/scheduled-tasks");
    if (!res.ok) {
      throw new Error(`Could not refresh (${res.status})`);
    }
    const body = (await res.json()) as { tasks: TaskRow[]; error?: string };
    tasks = body.tasks;
    if (body.error) pageError = body.error;
  }

  async function togglePause(task: TaskRow) {
    if (busyTaskId || !task.configured) return;
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
    if (busyTaskId) return;
    busyTaskId = task.id;
    actionMessage = null;
    actionError = null;
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await refreshTasks();
      actionMessage = body.message ?? (body.ok ? "Heartbeat finished." : "Finished with errors.");
      if (!body.ok) {
        actionError =
          body.errors && body.errors.length > 0
            ? body.errors.join("; ")
            : (body.message ?? "Finished with errors.");
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busyTaskId = null;
    }
  }
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
              {#if task.lastRunError}
                <p class="text-destructive mt-2 text-[11px] leading-relaxed">{task.lastRunError}</p>
              {/if}
              {#if !task.configured}
                <p class="text-muted-foreground mt-2 text-[11px]">
                  Not set up on this server yet (requires database scheduler).
                </p>
              {:else if !task.active}
                <p class="text-amber-700 dark:text-amber-400 mt-2 text-[11px]">Paused</p>
              {/if}
            </div>
          </div>
          <div class="flex flex-wrap gap-2 border-t border-border/60 pt-3">
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
            {#if task.configured}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyTaskId !== null}
                onclick={() => void togglePause(task)}
              >
                {#if busyTaskId === task.id}
                  <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
                {:else if task.active}
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
