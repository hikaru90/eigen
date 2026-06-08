<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import * as Card from "$lib/components/ui/card";
  import { Separator } from "$lib/components/ui/separator";
  import { chatSidebarOpen } from "$lib/stores/chat-sidebar";
  import { chatInputDraft } from "$lib/stores/page-input-drafts";
  import { get } from "svelte/store";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Square from "@lucide/svelte/icons/square";
  import VoiceInputButton from "$lib/components/voice-input-button.svelte";
  import ChatTimelineStep from "$lib/components/chat-timeline-step.svelte";
  import ChatErrorMessage from "$lib/components/chat-error-message.svelte";
  import ChatMarkdown from "$lib/components/chat-markdown.svelte";
  import { consumeChatNdjsonStream, type ChatProgressEvent } from "$lib/chat/consume-chat-ndjson";
  import { parseFinalAnswerText } from "$lib/chat/chat-stream-types";
  import {
    normalizeChatDisplay,
    sessionMessagesToChatEntries,
    type ChatDisplayEntry,
  } from "$lib/chat/normalize-messages";

  type ChatEntry = ChatDisplayEntry;

  let { data }: { data: PageData } = $props();

  const isGroundingMode = $derived(page.url.searchParams.get("mode") === "grounding");
  const isBriefingMode = $derived(page.url.searchParams.get("mode") === "briefing");
  const briefingPeriod = $derived(page.url.searchParams.get("period") ?? "morning");
  let groundingBootstrapped = $state(false);
  let briefingBootstrapped = $state(false);

  type SessionListItem = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  };

  let sessions = $state<SessionListItem[]>([]);
  let activeSessionId = $state<string | null>(null);
  let messages = $state<ChatEntry[]>([]);
  let displayMessages = $derived(normalizeChatDisplay(messages));
  let input = $state(get(chatInputDraft));
  let loading = $state(false);

  $effect(() => {
    chatInputDraft.set(input);
  });
  let loadingSession = $state(false);
  let abortController = $state<AbortController | null>(null);
  let streamEventsReceived = $state(false);
  let streamAbortReason = $state<"user" | "timeout" | null>(null);
  let agentStatus = $state<string | null>(null);
  let messagesEl: HTMLDivElement | undefined;
  let chatPanelEl: HTMLDivElement | undefined;

  function handleChatPanelWheel(e: WheelEvent) {
    const el = messagesEl;
    if (!el) return;

    const target = e.target;
    if (target instanceof HTMLElement) {
      const textarea = target.closest("textarea");
      if (textarea instanceof HTMLTextAreaElement && textarea.scrollHeight > textarea.clientHeight) {
        const { scrollTop, clientHeight, scrollHeight } = textarea;
        if (e.deltaY < 0 && scrollTop > 0) return;
        if (e.deltaY > 0 && scrollTop + clientHeight < scrollHeight) return;
      }
    }

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    if (target instanceof Node && el.contains(target)) {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= maxScroll - 1;
      if (e.deltaY > 0 && !atBottom) return;
      if (e.deltaY < 0 && !atTop) return;
    }

    const next = Math.max(0, Math.min(maxScroll, el.scrollTop + e.deltaY));
    if (next === el.scrollTop) return;
    el.scrollTop = next;
    e.preventDefault();
  }

  function appendTranscript(current: string, transcript: string): string {
    const next = transcript.trim();
    if (!next) return current;
    const base = current.trim();
    return base ? `${base} ${next}` : next;
  }

  const STORAGE_KEY = "chat-active-session-id";

  function scrollToBottom() {
    const el = messagesEl;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    });
  }

  $effect(() => {
    if (messages.length > 0 || loading) {
      scrollToBottom();
    }
  });

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  async function loadSessions() {
    try {
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) return;
      const json = await res.json();
      sessions = json.sessions ?? [];
    } catch {
      // ignore
    }
  }

  async function loadSessionMessages(sessionId: string) {
    loadingSession = true;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to load session");
      const json = await res.json();
      messages = sessionMessagesToChatEntries(json.messages ?? []);
    } catch {
      messages = [];
    } finally {
      loadingSession = false;
    }
  }

  async function selectSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      $chatSidebarOpen = false;
      return;
    }
    activeSessionId = sessionId;
    if (browser) localStorage.setItem(STORAGE_KEY, sessionId);
    await loadSessionMessages(sessionId);
    $chatSidebarOpen = false;
  }

  async function newSession() {
    activeSessionId = null;
    messages = [];
    if (browser) localStorage.removeItem(STORAGE_KEY);
    $chatSidebarOpen = false;
  }

  async function deleteSession(sessionId: string, e: MouseEvent) {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) return;
      sessions = sessions.filter((s) => s.id !== sessionId);
      if (sessionId === activeSessionId) {
        activeSessionId = null;
        messages = [];
        if (browser) localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }

  function pushStreamEvent(
    event: ChatProgressEvent,
    ctx: {
      lastAnswerQuestionPreview: { current: string | undefined };
      answerShownInTimeline: { current: boolean };
    },
  ) {
    streamEventsReceived = true;
    agentStatus = null;

    if (event.type === "thinking") {
      messages.push({ role: "assistant", variant: "thinking", content: event.content });
      return;
    }
    if (event.type === "agent_progress") {
      messages.push({
        role: "assistant",
        variant: "timeline",
        kind: "llm_progress",
        label: event.label,
      });
      return;
    }
    if (event.type === "tool_call") {
      messages.push({
        role: "assistant",
        variant: "timeline",
        kind: "tool_call",
        tool: event.tool,
        label: `Tool call · ${event.tool}`,
        arguments: event.arguments ?? {},
      });
      return;
    }
    if (event.type === "tool_executing") {
      messages.push({
        role: "assistant",
        variant: "timeline",
        kind: "tool_executing",
        tool: event.tool,
        label: `Executing tool · ${event.tool}`,
      });
      return;
    }
    if (event.type === "tool_progress") {
      messages.push({
        role: "assistant",
        variant: "timeline",
        kind: "tool_progress",
        tool: event.tool,
        label: event.label,
      });
      return;
    }
    if (event.type === "tool_result") {
      const preview = event.preview ?? "";
      if (event.tool === "answer_question") {
        ctx.lastAnswerQuestionPreview.current = preview;
        if (event.failed !== true) {
          const prose = parseFinalAnswerText("", preview).trim();
          if (prose) ctx.answerShownInTimeline.current = true;
        }
      }
      messages.push({
        role: "assistant",
        variant: "timeline",
        kind: "tool_result",
        tool: event.tool,
        label: `Tool result · ${event.tool}`,
        content: preview,
        failed: event.failed === true,
      });
    }
  }

  async function sendStreaming(
    text: string,
    options?: { bootstrap?: boolean },
  ) {
    loading = true;
    streamEventsReceived = false;
    streamAbortReason = null;
    agentStatus = null;

    const body: Record<string, unknown> = options?.bootstrap
      ? isBriefingMode
        ? { bootstrap: true, briefingPeriod }
        : { bootstrap: true, mode: "grounding" }
      : { message: text };
    if (isGroundingMode) body.mode = "grounding";
    if (isBriefingMode && options?.bootstrap) body.briefingPeriod = briefingPeriod;
    if (activeSessionId) body.sessionId = activeSessionId;

    const ac = new AbortController();
    abortController = ac;
    const timeoutId = setTimeout(() => {
      streamAbortReason = "timeout";
      ac.abort();
    }, 120_000);

    try {
      const res = await fetch("/api/chat", {
        signal: ac.signal,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/x-ndjson",
        },
        body: JSON.stringify(body),
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message ?? `HTTP ${res.status}`);
      }

      const streamCtx = {
        lastAnswerQuestionPreview: { current: undefined as string | undefined },
        answerShownInTimeline: { current: false },
      };
      const done = await consumeChatNdjsonStream(
        res,
        (event) => pushStreamEvent(event, streamCtx),
        ac.signal,
      );
      const responseText = parseFinalAnswerText(
        done.response ?? "",
        streamCtx.lastAnswerQuestionPreview.current,
      ).trim();
      if (!responseText) {
        throw new Error("The assistant returned an empty response.");
      }
      if (done.sessionId) activeSessionId = done.sessionId;
      if (done.sessionId && browser) localStorage.setItem(STORAGE_KEY, done.sessionId);
      if (!streamCtx.answerShownInTimeline.current) {
        messages.push({ role: "assistant", variant: "text", content: responseText });
      }
      if (done.groundingComplete) {
        const redirectTo =
          typeof done.redirectTo === "string" && done.redirectTo.trim()
            ? done.redirectTo.trim()
            : "/capture";
        await goto(redirectTo);
        return;
      }
      if (!isGroundingMode) loadSessions();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        if (streamAbortReason === "timeout") {
          messages.push({
            role: "assistant",
            variant: "text",
            content: "Error: Request timed out after 2 minutes.",
          });
        } else {
          messages.push({ role: "assistant", variant: "text", content: "Stopped." });
        }
      } else {
        messages.push({
          role: "assistant",
          variant: "text",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      loading = false;
      abortController = null;
      streamAbortReason = null;
      agentStatus = null;
    }
  }

  function resend(text: string) {
    if (loading) return;
    messages.push({ role: "user", content: text } satisfies ChatEntry);
    sendStreaming(text);
  }

  function messagesForDisplayPrefix(displayCount: number): ChatEntry[] {
    for (let rawLen = 0; rawLen <= messages.length; rawLen++) {
      if (normalizeChatDisplay(messages.slice(0, rawLen)).length === displayCount) {
        return messages.slice(0, rawLen);
      }
    }
    return messages;
  }

  function regenerate(displayIndex: number) {
    if (loading) return;
    const prefix = normalizeChatDisplay(messages).slice(0, displayIndex);
    let userIdx = prefix.length - 1;
    while (userIdx >= 0 && prefix[userIdx].role !== "user") {
      userIdx--;
    }
    if (userIdx < 0) return;
    const prior = prefix[userIdx];
    if (prior.role !== "user") return;
    const text = prior.content;
    messages = messagesForDisplayPrefix(displayIndex);
    sendStreaming(text);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = "";
    messages.push({ role: "user", content: text } satisfies ChatEntry);

    await sendStreaming(text);
  }

  function stop() {
    if (!abortController) return;
    streamAbortReason = "user";
    abortController.abort();
  }

  function stopGrounding() {
    stop();
    void goto("/capture");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  onMount(() => {
    const origHtmlOverflow = document.documentElement.style.overflow;
    const origBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.scrollTo({ top: 0, behavior: "instant" });

    void (async () => {
      if (isBriefingMode) {
        activeSessionId = null;
        messages = [];
        if (!briefingBootstrapped) {
          briefingBootstrapped = true;
          await sendStreaming("", { bootstrap: true });
        }
        return;
      }
      if (isGroundingMode) {
        activeSessionId = null;
        messages = [];
        if (!groundingBootstrapped) {
          groundingBootstrapped = true;
          await sendStreaming("", { bootstrap: true });
        }
        return;
      }
      await loadSessions();
      const storedId = browser ? localStorage.getItem(STORAGE_KEY) : null;
      const match = storedId ? sessions.find((s) => s.id === storedId) : null;
      if (match) {
        await selectSession(match.id);
      } else if (sessions.length > 0) {
        await selectSession(sessions[0].id);
      }
    })();

    const panel = chatPanelEl;
    panel?.addEventListener("wheel", handleChatPanelWheel, { passive: false });

    return () => {
      panel?.removeEventListener("wheel", handleChatPanelWheel);
      document.documentElement.style.overflow = origHtmlOverflow;
      document.body.style.overflow = origBodyOverflow;
    };
  });
</script>

{#if isBriefingMode}
  <div
    class="fixed inset-x-0 top-20 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
    role="region"
    aria-label="Timeline briefing"
  >
    <div class="mx-auto w-full max-w-2xl">
      <h1 class="text-sm font-medium text-foreground">
        {briefingPeriod === "evening"
          ? "Evening review"
          : briefingPeriod === "weekly"
            ? "Weekly review"
            : "Morning briefing"}
      </h1>
      <p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
        Your assistant summarizes agenda, priorities, and open loops from your timeline.
      </p>
    </div>
  </div>
{/if}

{#if isGroundingMode}
  <div
    class="fixed inset-x-0 top-20 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
    role="region"
    aria-label="Grounding conversation"
  >
    <div class="mx-auto flex w-full max-w-2xl items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-medium text-foreground">Getting to know you</h1>
        <p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          A short conversation so Eigen can understand who you are and classify your thoughts better.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="shrink-0 rounded-[4px] text-xs"
        onclick={stopGrounding}
      >
        Stop
      </Button>
    </div>
  </div>
{/if}

<!-- sidebar backdrop -->
{#if $chatSidebarOpen && !isGroundingMode}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-60 cursor-pointer bg-black/20"
    onclick={() => ($chatSidebarOpen = false)}
  ></div>
{/if}

<!-- sidebar panel -->
{#if !isGroundingMode}
<div
  class="fixed left-0 top-0 z-60 flex h-full w-64 flex-col bg-white dark:bg-card pt-safe border-r border-border transition-transform duration-200 {$chatSidebarOpen
    ? 'translate-x-0'
    : '-translate-x-full'}"
  role="dialog"
  aria-label="Chat sessions"
>
  <div class="px-5 pb-3">
    <button
      class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      onclick={() => ($chatSidebarOpen = false)}
      aria-label="Close sidebar"
    >
      <X class="size-5" strokeWidth={1.75} />
    </button>
  </div>

  <div class="px-5 pb-3">
    <Button variant="outline" size="sm" class="w-full rounded-[4px]" onclick={newSession}>
      <Plus strokeWidth={1.75} />
      New chat
    </Button>
  </div>

  <div class="mx-3 h-px bg-border"></div>

  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if sessions.length === 0}
      <p class="text-muted-foreground px-2 py-8 text-center text-xs">No conversations yet</p>
    {/if}
    {#each sessions as s (s.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="group flex w-full items-start gap-2 rounded px-2.5 py-2 text-left cursor-pointer transition-colors {s.id ===
        activeSessionId
          ? 'bg-muted'
          : 'hover:bg-muted/50'}"
        onclick={() => selectSession(s.id)}
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-foreground leading-snug">
            {s.title?.trim() || "Untitled"}
          </p>
          <p class="text-muted-foreground mt-0.5 text-[10px]">{formatDate(s.updatedAt)}</p>
        </div>
        <button
          class="invisible group-hover:visible text-muted-foreground hover:text-destructive shrink-0 rounded p-0.5 transition-colors"
          onclick={(e) => deleteSession(s.id, e)}
          aria-label="Delete session"
        >
          <Trash2 class="size-3" strokeWidth={1.5} />
        </button>
      </div>
    {/each}
  </div>
</div>
{/if}

<div
  bind:this={chatPanelEl}
  class="fixed inset-x-0 bottom-20 z-30 overflow-hidden {isGroundingMode || isBriefingMode
    ? 'top-[10.25rem]'
    : 'top-0'}"
>
  <div
    bind:this={messagesEl}
    class="absolute inset-0 overflow-y-auto overflow-x-clip"
    role="log"
    aria-label="Chat messages"
  >
    <div
      class="mx-auto flex min-h-full w-full min-w-0 max-w-2xl flex-col px-4 pb-52 {isGroundingMode
        ? 'pt-3'
        : 'pt-20'}"
    >
      <div class="flex flex-1 flex-col gap-1 px-1 py-3">
      {#if loadingSession}
        <div class="flex flex-1 items-center justify-center">
          <LoaderCircleIcon class="text-muted-foreground size-4 animate-spin" />
        </div>
      {:else if messages.length === 0 && !loading && !isGroundingMode}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p class="text-muted-foreground max-w-xs text-sm tracking-wide">
            Ask about your memories, manage thoughts, or save something new when you want to.
          </p>
        </div>
      {:else if messages.length === 0 && loading && isGroundingMode}
        <div class="flex flex-1 items-center justify-center">
          <LoaderCircleIcon class="text-muted-foreground size-4 animate-spin" />
        </div>
      {/if}

      {#each displayMessages as msg, i (i)}
        {#if msg.role === "user"}
          <!-- User message: right-aligned, Klein Blue bg, clean pill -->
          <div class="group flex min-w-0 w-full flex-row-reverse items-end gap-3 py-0.5">
            <div class="flex min-w-0 max-w-[72%] flex-col items-end gap-1 overflow-visible">
              <div
                class="relative min-w-0 overflow-visible rounded-none bg-foreground px-3.5 py-2 text-background"
              >
                <span
                  class="pointer-events-none absolute top-0 right-0 h-0 w-0 translate-x-full border-t-8 border-t-foreground border-r-6 border-r-transparent"
                  aria-hidden="true"
                ></span>
                <ChatMarkdown content={msg.content} tone="user" />
              </div>
              <button
                class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                onclick={() => resend(msg.content)}
                aria-label="Send again"
              >
                <Redo2 class="size-3" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        {:else if msg.variant === "thinking"}
          <div class="min-w-0 w-full py-0.5">
            <details class="group/think min-w-0 max-w-full">
              <summary
                class="cursor-pointer select-none list-none max-w-full rounded-md px-3 py-2 text-sm text-muted-foreground italic leading-normal flex flex-wrap items-center gap-1.5"
              >
                <span class="inline-block size-1 bg-accent shrink-0"></span>
                Thinking
                {#if msg.content}
                  <span class="text-xs not-italic opacity-50 group-open/think:hidden">(expand)</span
                  >
                {/if}
              </summary>
              {#if msg.content}
                <div class="mt-2 ml-3 min-w-0 border-l border-border pl-3 py-0.5">
                  <ChatMarkdown content={msg.content} tone="muted" />
                </div>
              {/if}
            </details>
          </div>
        {:else if msg.variant === "timeline"}
          <ChatTimelineStep
            kind={msg.kind}
            label={msg.label}
            tool={msg.tool}
            arguments={msg.arguments}
            content={msg.content}
            failed={msg.failed}
          />
        {:else if msg.variant === "text"}
          <div class="group flex min-w-0 w-full flex-row items-start gap-0 py-1">
            <div
              class="flex min-w-0 max-w-full flex-col items-start gap-1 rounded-md px-3.5 py-2 sm:max-w-[82%]"
            >
              {#if msg.content.startsWith("Error:")}
                <ChatErrorMessage
                  message={msg.content.replace(/^Error:\s*/, "")}
                  class="w-full"
                />
              {:else}
                <ChatMarkdown content={msg.content} />
                <button
                  class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                  onclick={() => regenerate(i)}
                  aria-label="Regenerate answer"
                >
                  <RefreshCw class="size-3" strokeWidth={1.5} />
                </button>
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      {#if loading && agentStatus}
        <div class="min-w-0 py-0.5">
          <p class="flex min-w-0 items-start gap-1.5 text-sm leading-normal text-muted-foreground">
            <LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin" />
            <span class="min-w-0 wrap-break-word">{agentStatus}</span>
          </p>
        </div>
      {:else if loading && !streamEventsReceived}
        <div class="min-w-0 py-1">
          <div
            class="flex min-w-0 items-start gap-1.5 text-sm leading-normal text-muted-foreground"
          >
            <LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin" />
            <span>Connecting…</span>
          </div>
        </div>
      {/if}
      </div>
    </div>
  </div>

  <!-- input area (pinned, outside scroll flow) -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10">
    <div class="pointer-events-auto mx-auto min-w-0 w-full max-w-2xl px-4 pb-2 pt-2 bg-background">
    <Card.Root
      class="bg-white dark:bg-card min-w-0 w-full overflow-visible border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-x-clip"
    >
      <Card.Content class="min-w-0 p-0 w-full">
        <Textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder={isGroundingMode
            ? "Share about yourself — work, values, what matters to you…"
            : "Ask a question about your memories..."}
          class="min-w-0 w-full break-all border-0 bg-transparent shadow-none focus-visible:ring-0 p-4 text-base md:text-base min-h-[72px] resize-none text-foreground placeholder:text-muted-foreground"
          disabled={loading || loadingSession}
        />
      </Card.Content>
      <Card.Footer class="bg-muted/50 p-4 flex flex-row items-center justify-end gap-2 w-full">
        <VoiceInputButton
          language={(page.data as { preferredLanguage?: string }).preferredLanguage ?? "en"}
          disabled={loading || loadingSession}
          ontranscript={(text) => {
            input = appendTranscript(input, text);
          }}
          onerror={(message) => {
            console.error("voice input failed", message);
          }}
        />
        <Button
          onclick={loading ? stop : send}
          disabled={!loading && (loadingSession || !input.trim())}
          class="bg-black text-white dark:bg-white dark:text-black rounded-none px-[22px] py-[12px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90 dark:hover:bg-white/90"
        >
          {#if loading}
            <Square class="size-4 shrink-0" strokeWidth={1.75} />
          {:else}
            <SendHorizontal class="size-4 shrink-0" strokeWidth={1.75} />
          {/if}
        </Button>
      </Card.Footer>
    </Card.Root>
    </div>
  </div>
</div>
