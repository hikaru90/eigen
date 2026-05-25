<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import { chatSidebarOpen } from '$lib/stores/chat-sidebar';
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Square from '@lucide/svelte/icons/square';
  import VoiceInputButton from '$lib/components/voice-input-button.svelte';
  import ChatToolStep from '$lib/components/chat-tool-step.svelte';
  import ChatMarkdown from '$lib/components/chat-markdown.svelte';
  import { consumeChatNdjsonStream, type ChatProgressEvent } from '$lib/chat/consume-chat-ndjson';
  import {
    coerceToolResultSource,
    formatToolArgumentsSummary,
    resolveToolResultView
  } from '$lib/chat/chat-stream-types';
  import {
    normalizeChatDisplay,
    toolStepToDisplayEntry,
    type ChatDisplayEntry
  } from '$lib/chat/normalize-messages';

  type ChatEntry = ChatDisplayEntry;

  type SessionListItem = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  };

  type SessionMessage = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
      metadata?: {
      variant?: string;
      tool?: string;
      arguments?: Record<string, unknown>;
      preview?: string;
      displaySummary?: string;
      failed?: boolean;
    } | null;
    createdAt: string;
  };

  let sessions = $state<SessionListItem[]>([]);
  let activeSessionId = $state<string | null>(null);
  let messages = $state<ChatEntry[]>([]);
  let displayMessages = $derived(normalizeChatDisplay(messages));
  let input = $state('');
  let loading = $state(false);
  let loadingSession = $state(false);
  let abortController = $state<AbortController | null>(null);
  let streamEventsReceived = $state(false);
  let streamAbortReason = $state<'user' | 'timeout' | null>(null);
  let agentStatus = $state<string | null>(null);
  let chatEl: HTMLDivElement | undefined;

  function appendTranscript(current: string, transcript: string): string {
    const next = transcript.trim();
    if (!next) return current;
    const base = current.trim();
    return base ? `${base} ${next}` : next;
  }

  const STORAGE_KEY = 'chat-active-session-id';

  function scrollToBottom() {
    const el = chatEl;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
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
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function loadSessions() {
    try {
      const res = await fetch('/api/chat/sessions');
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
      if (!res.ok) throw new Error('Failed to load session');
      const json = await res.json();
      const loaded = (json.messages ?? []).flatMap((m: SessionMessage): ChatEntry[] => {
        if (m.role === 'user') {
          return [{ role: 'user' as const, content: m.content }];
        }
        if (m.role === 'assistant' && m.metadata?.variant) {
          const v = m.metadata.variant;
          if (v === 'thinking') {
            return [{ role: 'assistant' as const, variant: 'thinking' as const, content: m.content }];
          }
          if (v === 'tool_step' && typeof m.metadata.tool === 'string') {
            const payload =
              coerceToolResultSource(m.content) ??
              coerceToolResultSource(m.metadata.displaySummary) ??
              coerceToolResultSource(m.metadata.preview) ??
              coerceToolResultSource(m.metadata.result) ??
              '';
            return [toolStepToDisplayEntry({
              tool: m.metadata.tool,
              arguments: (m.metadata.arguments as Record<string, unknown>) ?? {},
              displaySummary: coerceToolResultSource(m.metadata.displaySummary),
              content: payload,
              failed: m.metadata.failed === true
            })];
          }
          if (v === 'tool_call' && typeof m.metadata.tool === 'string') {
            const legacyResult =
              coerceToolResultSource(m.metadata.result) ??
              coerceToolResultSource(m.metadata.preview);
            const status =
              m.metadata.status === 'done' || m.metadata.status === 'error'
                ? m.metadata.status
                : legacyResult
                  ? 'done'
                  : undefined;
            return [{
              role: 'assistant' as const,
              variant: 'tool_call' as const,
              tool: m.metadata.tool,
              arguments: (m.metadata.arguments as Record<string, unknown>) ?? {},
              ...(status ? { status: status as 'done' | 'error' } : {}),
              ...(legacyResult ? { result: legacyResult } : {}),
              displaySummary: coerceToolResultSource(m.metadata.displaySummary)
            }];
          }
          if (v === 'tool_result') {
            const toolName = typeof m.metadata.tool === 'string' ? m.metadata.tool : 'retrieve_thoughts';
            const failed = m.metadata.failed === true;
            const payload =
              coerceToolResultSource(m.content) ??
              coerceToolResultSource(m.metadata.displaySummary) ??
              coerceToolResultSource(m.metadata.preview) ??
              coerceToolResultSource(m.metadata.result) ??
              '';
            return [{
              role: 'assistant' as const,
              variant: 'tool_result' as const,
              tool: toolName,
              content: payload,
              displaySummary: coerceToolResultSource(m.metadata.displaySummary),
              status: failed ? ('error' as const) : ('success' as const)
            }];
          }
        }
        return [{ role: 'assistant' as const, variant: 'text' as const, content: m.content }];
      });
      messages = loaded;
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
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
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

  function findLastToolCallIndex(tool: string): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i];
      if (entry.role === 'assistant' && entry.variant === 'tool_call' && entry.tool === tool) {
        return i;
      }
    }
    return -1;
  }

  function patchLastToolCall(
    tool: string,
    patch: Partial<Extract<ChatEntry, { variant: 'tool_call' }>>
  ): boolean {
    const i = findLastToolCallIndex(tool);
    if (i < 0) return false;
    const entry = messages[i];
    if (entry.role !== 'assistant' || entry.variant !== 'tool_call') return false;
    messages = [...messages.slice(0, i), { ...entry, ...patch }, ...messages.slice(i + 1)];
    return true;
  }

  function updateLastToolCallProgress(tool: string, label: string) {
    patchLastToolCall(tool, { progress: label, status: 'running' });
  }

  function finalizeLastToolCall(tool: string, content: string, failed: boolean) {
    patchLastToolCall(tool, {
      progress: undefined,
      status: failed ? 'error' : 'done',
      result: content
    });
  }

  function lastEntryShowsAnswerQuestionResult(): boolean {
    const last = messages.at(-1);
    return (
      last?.role === 'assistant' &&
      last.variant === 'tool_call' &&
      last.tool === 'answer_question' &&
      last.status === 'done'
    );
  }

  function pushStreamEvent(event: ChatProgressEvent) {
    streamEventsReceived = true;
    if (event.type === 'thinking') {
      messages.push({ role: 'assistant', variant: 'thinking', content: event.content });
      return;
    }
    if (event.type === 'agent_progress') {
      agentStatus = event.label;
      return;
    }
    if (event.type === 'tool_call') {
      agentStatus = null;
      messages.push({
        role: 'assistant',
        variant: 'tool_call',
        tool: event.tool,
        arguments: event.arguments ?? {},
        status: 'running'
      });
      return;
    }
    if (event.type === 'tool_progress') {
      updateLastToolCallProgress(event.tool, event.label);
      return;
    }
    if (event.type === 'tool_result') {
      const failed = event.failed === true;
      const preview = event.preview ?? '';
      if (!finalizeLastToolCall(event.tool, preview, failed)) {
        messages.push({
          role: 'assistant',
          variant: 'tool_result',
          tool: event.tool,
          content: preview,
          status: failed ? 'error' : 'success'
        });
      }
    }
  }

  async function sendStreaming(text: string) {
    loading = true;
    streamEventsReceived = false;
    streamAbortReason = null;
    agentStatus = null;

    const body: Record<string, unknown> = { message: text };
    if (activeSessionId) body.sessionId = activeSessionId;

    const ac = new AbortController();
    abortController = ac;
    const timeoutId = setTimeout(() => {
      streamAbortReason = 'timeout';
      ac.abort();
    }, 120_000);

    try {
      const res = await fetch('/api/chat', {
        signal: ac.signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson'
        },
        body: JSON.stringify(body)
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message ?? `HTTP ${res.status}`);
      }

      const done = await consumeChatNdjsonStream(res, pushStreamEvent, ac.signal);
      const responseText = (done.response ?? '').trim();
      if (!responseText) {
        throw new Error('The assistant returned an empty response.');
      }
      if (done.sessionId) activeSessionId = done.sessionId;
      if (done.sessionId && browser) localStorage.setItem(STORAGE_KEY, done.sessionId);
      if (!lastEntryShowsAnswerQuestionResult()) {
        messages.push({ role: 'assistant', variant: 'text', content: responseText });
      }
      loadSessions();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (streamAbortReason === 'timeout') {
          messages.push({
            role: 'assistant',
            variant: 'text',
            content: 'Error: Request timed out after 2 minutes.'
          });
        } else {
          messages.push({ role: 'assistant', variant: 'text', content: 'Stopped.' });
        }
      } else {
        messages.push({
          role: 'assistant',
          variant: 'text',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`
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
    messages.push({ role: 'user', content: text } satisfies ChatEntry);
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
    while (userIdx >= 0 && prefix[userIdx].role !== 'user') {
      userIdx--;
    }
    if (userIdx < 0) return;
    const prior = prefix[userIdx];
    if (prior.role !== 'user') return;
    const text = prior.content;
    messages = messagesForDisplayPrefix(displayIndex);
    sendStreaming(text);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = '';
    messages.push({ role: 'user', content: text } satisfies ChatEntry);

    await sendStreaming(text);
  }

  function stop() {
    if (!abortController) return;
    streamAbortReason = 'user';
    abortController.abort();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  onMount(() => {
    const origHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    window.scrollTo({ top: 0, behavior: 'instant' });

    void (async () => {
      await loadSessions();
      const storedId = browser ? localStorage.getItem(STORAGE_KEY) : null;
      const match = storedId ? sessions.find((s) => s.id === storedId) : null;
      if (match) {
        await selectSession(match.id);
      } else if (sessions.length > 0) {
        await selectSession(sessions[0].id);
      }
    })();

    return () => {
      document.documentElement.style.overflow = origHtmlOverflow;
    };
  });
</script>

<!-- sidebar backdrop -->
{#if $chatSidebarOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-60 bg-black/20"
    onclick={() => ($chatSidebarOpen = false)}
  ></div>
{/if}

<!-- sidebar panel -->
<div
  class="fixed left-0 top-0 z-60 flex h-full w-64 flex-col bg-white dark:bg-card pt-safe border-r border-border transition-transform duration-200 {$chatSidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
  role="dialog"
  aria-label="Chat sessions"
>
  <div class="flex items-center justify-between px-4 py-3">
    <span class="text-xs font-medium tracking-widest uppercase text-muted-foreground">History</span>
    <button
      class="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
      onclick={() => ($chatSidebarOpen = false)}
      aria-label="Close sidebar"
    >
      <X class="size-3.5" strokeWidth={1.5} />
    </button>
  </div>

  <div class="px-3 pb-3">
    <button
      class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors border border-border"
      onclick={newSession}
    >
      <Plus class="size-3" strokeWidth={1.75} />
      New chat
    </button>
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
        class="group flex w-full items-start gap-2 rounded px-2.5 py-2 text-left cursor-pointer transition-colors {s.id === activeSessionId ? 'bg-muted' : 'hover:bg-muted/50'}"
        onclick={() => selectSession(s.id)}
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-foreground leading-snug">{s.title?.trim() || 'Untitled'}</p>
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

<div class="fixed inset-x-0 top-20 bottom-28 z-0 mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-3 px-4 pt-2 pb-2 overflow-x-clip">
  <!-- messages area -->
  <div
    bind:this={chatEl}
    class="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-1 overflow-y-auto px-1 overflow-x-clip"
    role="log"
    aria-label="Chat messages"
  >
    {#if loadingSession}
      <div class="flex flex-1 items-center justify-center">
        <LoaderCircleIcon class="text-muted-foreground size-4 animate-spin" />
      </div>
    {:else if messages.length === 0 && !loading}
      <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p class="text-muted-foreground max-w-xs text-sm tracking-wide">
          Ask about your memories, manage thoughts, or save something new when you want to.
        </p>
      </div>
    {/if}

    {#each displayMessages as msg, i (i)}
      {#if msg.role === 'user'}
        <!-- User message: right-aligned, Klein Blue bg, clean pill -->
        <div class="group flex min-w-0 w-full flex-row-reverse items-end gap-3 py-0.5">
          <div class="flex min-w-0 max-w-[72%] flex-col items-end gap-1">
            <div class="min-w-0 rounded-[16px] rounded-br-none bg-foreground px-3.5 py-2 text-background">
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

      {:else if msg.variant === 'thinking'}
        <!-- Thinking: very reduced, borderless, italic inline label -->
        <div class="min-w-0 w-full py-0.5">
          <details class="group/think min-w-0 max-w-full">
            <summary class="cursor-pointer select-none list-none max-w-full text-xs text-muted-foreground italic leading-normal py-1 flex flex-wrap items-center gap-1.5">
              <span class="inline-block size-1 rounded-full bg-accent shrink-0"></span>
              Thinking
              {#if msg.content}
                <span class="text-[10px] not-italic opacity-50 group-open/think:hidden">(expand)</span>
              {/if}
            </summary>
            {#if msg.content}
              <div class="mt-1 ml-3.5 min-w-0 border-l border-border pl-3 py-0.5">
                <ChatMarkdown content={msg.content} tone="muted" />
              </div>
            {/if}
          </details>
        </div>

      {:else if msg.variant === 'tool_call'}
        {@const argSummary = formatToolArgumentsSummary(msg.tool, msg.arguments)}
        {@const runStatus = msg.status ?? 'running'}
        {@const stepStatus = runStatus === 'running' ? 'running' : runStatus === 'error' ? 'failed' : 'done'}
        {@const resultView =
          msg.result && runStatus !== 'running'
            ? resolveToolResultView(msg.tool, msg.result, msg.displaySummary)
            : null}
        <ChatToolStep
          tool={msg.tool}
          status={stepStatus}
          argSummary={argSummary}
          progress={msg.progress}
          resultView={resultView}
        />

      {:else if msg.variant === 'tool_result'}
        {@const resultStatus = msg.status === 'error' ? 'failed' : 'done'}
        {@const resultView = resolveToolResultView(msg.tool, msg.content, msg.displaySummary)}
        <ChatToolStep tool={msg.tool} status={resultStatus} {resultView} />

      {:else}
        <!-- Assistant text: no bubble, plain text with subtle left gutter -->
        <div class="group flex min-w-0 w-full flex-row items-start gap-0 py-1">
          <div class="flex min-w-0 max-w-full flex-col items-start gap-1 sm:max-w-[82%]">
            <ChatMarkdown content={msg.content} />
            <button
              class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
              onclick={() => regenerate(i)}
              aria-label="Regenerate answer"
            >
              <RefreshCw class="size-3" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      {/if}
    {/each}

    {#if loading && agentStatus}
      <div class="min-w-0 py-0.5">
        <p class="flex min-w-0 items-start gap-1.5 text-xs leading-normal text-muted-foreground">
          <LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <span class="min-w-0 wrap-break-word">{agentStatus}</span>
        </p>
      </div>
    {:else if loading && !streamEventsReceived}
      <div class="min-w-0 py-1">
        <div class="flex min-w-0 items-start gap-1.5 text-xs leading-normal text-muted-foreground">
          <LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <span>Connecting…</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- input area -->
  <div class="min-w-0 shrink-0 w-full">
    <Card.Root class="bg-white dark:bg-card min-w-0 w-full overflow-visible border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-[2px] gap-[6px] items-start overflow-x-clip">
      <Card.Content class="min-w-0 p-0 w-full">
        <Textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder="Ask a question about your memories..."
          class="min-w-0 w-full break-all border-0 bg-transparent shadow-none focus-visible:ring-0 p-4 text-sm min-h-[72px] resize-none text-foreground placeholder:text-muted-foreground"
          disabled={loading || loadingSession}
        />
      </Card.Content>
      <Card.Footer class="bg-muted/50 p-4 flex flex-row items-center justify-end gap-2 w-full">
        <VoiceInputButton
          disabled={loading || loadingSession}
          ontranscript={(text) => {
            input = appendTranscript(input, text);
          }}
          onerror={(message) => {
            console.error('voice input failed', message);
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
