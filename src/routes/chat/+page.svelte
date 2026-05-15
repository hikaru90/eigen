<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import { chatSidebarOpen } from '$lib/stores/chat-sidebar';
  import Bot from '@lucide/svelte/icons/bot';
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
  import User from '@lucide/svelte/icons/user';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import Search from '@lucide/svelte/icons/search';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Square from '@lucide/svelte/icons/square';
  import type { ChatStreamEvent } from '$lib/chat/chat-stream-types';
  import { toolLabel } from '$lib/chat/chat-stream-types';

  type ChatEntry =
    | { role: 'user'; content: string }
    | { role: 'assistant'; variant: 'text'; content: string }
    | { role: 'assistant'; variant: 'thinking'; content: string }
    | { role: 'assistant'; variant: 'tool_call'; tool: string; arguments: Record<string, unknown> }
    | { role: 'assistant'; variant: 'tool_result'; content: string };

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
    } | null;
    createdAt: string;
  };

  let sessions = $state<SessionListItem[]>([]);
  let activeSessionId = $state<string | null>(null);
  let messages = $state<ChatEntry[]>([]);
  let input = $state('');
  let loading = $state(false);
  let loadingSession = $state(false);
  let abortController = $state<AbortController | null>(null);
  let streamEventsReceived = $state(false);

  let chatEl: HTMLDivElement | undefined;

  const STORAGE_KEY = 'chat-active-session-id';

  function toolIcon(tool: string): string {
    if (tool === 'retrieve_thoughts') return 'search';
    if (tool === 'answer_question') return 'sparkles';
    if (tool === 'edit_thought') return 'pencil';
    return 'bot';
  }

  function toolArgumentsPreview(args: Record<string, unknown>, maxChars = 2400): string {
    try {
      const s = JSON.stringify(args, null, 2);
      return s.length > maxChars ? `${s.slice(0, maxChars)}\n…` : s;
    } catch {
      return '(arguments could not be serialized)';
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
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
      messages = (json.messages ?? []).flatMap((m: SessionMessage): ChatEntry[] => {
        if (m.role === 'user') {
          return [{ role: 'user' as const, content: m.content }];
        }
        if (m.role === 'assistant' && m.metadata?.variant) {
          const v = m.metadata.variant;
          if (v === 'thinking') {
            return [{ role: 'assistant' as const, variant: 'thinking' as const, content: m.content }];
          }
          if (v === 'tool_call' && typeof m.metadata.tool === 'string') {
            return [{
              role: 'assistant' as const,
              variant: 'tool_call' as const,
              tool: m.metadata.tool,
              arguments: (m.metadata.arguments as Record<string, unknown>) ?? {}
            }];
          }
          if (v === 'tool_result') {
            let displayText = '';
            try {
              const parsed = JSON.parse(m.content);
              const results = parsed.results;
              if (Array.isArray(results)) {
                displayText = results.map((r: { normalizedText?: string }, i: number) =>
                  `${i + 1}. ${r.normalizedText ?? '(no text)'}`
                ).join('\n');
              } else {
                displayText = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
              }
            } catch {
              displayText = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
            }
            return [{
              role: 'assistant' as const,
              variant: 'tool_result' as const,
              content: `Retrieved from memory:\n${displayText}`
            }];
          }
        }
        return [{ role: 'assistant' as const, variant: 'text' as const, content: m.content }];
      });
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

  async function sendStreaming(text: string) {
    loading = true;
    streamEventsReceived = false;

    const body: Record<string, unknown> = { message: text };
    if (activeSessionId) body.sessionId = activeSessionId;

    const ac = new AbortController();
    abortController = ac;
    const timeoutId = setTimeout(() => ac.abort(), 120_000);

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

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const trimmed = raw.trim();
          if (!trimmed) continue;
          const event = JSON.parse(trimmed) as ChatStreamEvent;

          if (event.type === 'thinking') {
            streamEventsReceived = true;
            messages.push({ role: 'assistant', variant: 'thinking', content: event.content });
          } else if (event.type === 'tool_call') {
            streamEventsReceived = true;
            messages.push({
              role: 'assistant',
              variant: 'tool_call',
              tool: event.tool,
              arguments: event.arguments ?? {}
            });
          } else if (event.type === 'tool_result') {
            streamEventsReceived = true;
            let displayText = '';
            try {
              const parsed = JSON.parse(event.preview);
              const results = parsed.results;
              if (Array.isArray(results)) {
                displayText = results.map((r: { normalizedText?: string }, i: number) =>
                  `${i + 1}. ${r.normalizedText ?? '(no text)'}`
                ).join('\n');
              } else {
                displayText = event.preview.length > 500 ? event.preview.slice(0, 500) + '...' : event.preview;
              }
            } catch {
              displayText = event.preview.length > 500 ? event.preview.slice(0, 500) + '...' : event.preview;
            }
            messages.push({
              role: 'assistant',
              variant: 'tool_result',
              content: `Retrieved from memory:\n${displayText}`
            });
          } else if (event.type === 'done') {
            streamEventsReceived = true;
            if (event.sessionId) activeSessionId = event.sessionId;
            if (event.sessionId && browser) localStorage.setItem(STORAGE_KEY, event.sessionId);
            messages.push({ role: 'assistant', variant: 'text', content: event.response });
            loadSessions();
          } else if (event.type === 'error') {
            streamEventsReceived = true;
            messages.push({ role: 'assistant', variant: 'text', content: `Error: ${event.error}` });
          }
        }
        if (done) break;
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        messages.push({
          role: 'assistant',
          variant: 'text',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    } finally {
      loading = false;
      abortController = null;
    }
  }

  function resend(text: string) {
    if (loading) return;
    messages.push({ role: 'user', content: text } satisfies ChatEntry);
    sendStreaming(text);
  }

  function regenerate(index: number) {
    if (loading) return;
    let userIdx = index - 1;
    while (userIdx >= 0 && messages[userIdx].role !== 'user') {
      userIdx--;
    }
    if (userIdx < 0) return;
    const prior = messages[userIdx];
    if (prior.role !== 'user') return;
    const text = prior.content;
    messages = messages.slice(0, index);
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
    abortController.abort();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  onMount(async () => {
    await loadSessions();
    const storedId = browser ? localStorage.getItem(STORAGE_KEY) : null;
    const match = storedId ? sessions.find((s) => s.id === storedId) : null;
    if (match) {
      await selectSession(match.id);
    } else if (sessions.length > 0) {
      await selectSession(sessions[0].id);
    }
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

<div class="relative mx-auto flex max-w-2xl flex-col px-4 pt-4 max-h-dvh">
  <!-- messages area -->
  <div
    bind:this={chatEl}
    class="flex h-dvh flex-auto flex-col gap-1 px-1 pb-52 overflow-hidden"
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
          Ask me anything about your thoughts, or tell me to remember something new.
        </p>
      </div>
    {/if}

    {#each messages as msg, i (i)}
      {#if msg.role === 'user'}
        <!-- User message: right-aligned, Klein Blue bg, clean pill -->
        <div class="group flex flex-row-reverse items-end gap-3 py-0.5">
          <div class="flex flex-col items-end gap-1 max-w-[72%]">
            <div class="rounded-[16px] rounded-br-none bg-foreground px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-background">
              {msg.content}
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
        <div class="py-0.5">
          <details class="group/think">
            <summary class="cursor-pointer select-none list-none text-xs text-muted-foreground italic leading-relaxed py-1 flex items-center gap-1.5 w-fit">
              <span class="inline-block size-1 rounded-full bg-accent shrink-0"></span>
              Thinking
              {#if msg.content}
                <span class="text-[10px] not-italic opacity-50 group-open/think:hidden">(expand)</span>
              {/if}
            </summary>
            {#if msg.content}
              <div class="mt-1 ml-3.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap border-l border-border pl-3 py-0.5">
                {msg.content}
              </div>
            {/if}
          </details>
        </div>

      {:else if msg.variant === 'tool_call'}
        <!-- Tool call: compact inline label, no heavy bubble -->
        <div class="py-0.5">
          <div class="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
            <span class="inline-block size-1 rounded-full bg-muted shrink-0"></span>
            {#if toolIcon(msg.tool) === 'search'}
              <Search class="size-3 shrink-0" strokeWidth={1.5} />
            {:else if toolIcon(msg.tool) === 'sparkles'}
              <Sparkles class="size-3 shrink-0" strokeWidth={1.5} />
            {:else if toolIcon(msg.tool) === 'pencil'}
              <PencilLine class="size-3 shrink-0" strokeWidth={1.5} />
            {:else}
              <Bot class="size-3 shrink-0" strokeWidth={1.5} />
            {/if}
            <span class="tracking-wide">{toolLabel(msg.tool)}</span>
          </div>
        </div>

      {:else if msg.variant === 'tool_result'}
        <!-- Tool result: borderless, muted, small — contextual, not primary -->
        <div class="group py-0.5">
          <div class="ml-3.5 border-l border-border pl-3 py-0.5 overflow-x-hidden">
            <p class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Memory</p>
            <p class="text-xs text-muted-foreground leading-relaxed whitespace-normal break-words">{msg.content.replace(/^Retrieved from memory:\n/, '')}</p>
          </div>
        </div>

      {:else}
        <!-- Assistant text: no bubble, plain text with subtle left gutter -->
        <div class="group flex flex-row items-start gap-0 py-1">
          <div class="flex flex-col items-start gap-1 max-w-[82%]">
            <div class="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {msg.content}
            </div>
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

    {#if loading && !streamEventsReceived}
      <div class="py-1">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircleIcon class="size-3.5 animate-spin" />
        </div>
      </div>
    {/if}
  </div>

  <!-- input area -->
  <div class="fixed bottom-24 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4">
    <Card.Root class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-[2px] gap-[6px] items-start overflow-visible">
      <Card.Content class="p-0 w-full">
        <Textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder="Ask about your memories..."
          class="border-0 bg-transparent shadow-none focus-visible:ring-0 p-4 text-sm min-h-[72px] resize-none text-foreground placeholder:text-muted-foreground"
          disabled={loading || loadingSession}
        />
      </Card.Content>
      <Card.Footer class="bg-muted/50 p-4 flex flex-row items-center justify-end w-full">
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
