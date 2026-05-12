<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import { chatSidebarOpen } from '$lib/stores/chat-sidebar';
  import Bot from '@lucide/svelte/icons/bot';
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
  import User from '@lucide/svelte/icons/user';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import Search from '@lucide/svelte/icons/search';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import type { ChatStreamEvent } from '$lib/chat/chat-stream-types';
  import { toolLabel } from '$lib/chat/chat-stream-types';

  type ChatEntry = {
    role: 'user' | 'assistant';
    content: string;
  };

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
    createdAt: string;
  };

  type ProgressStep = {
    id: string;
    label: string;
    icon: string;
    status: 'active' | 'done';
  };

  let sessions = $state<SessionListItem[]>([]);
  let activeSessionId = $state<string | null>(null);
  let messages = $state<ChatEntry[]>([]);
  let input = $state('');
  let loading = $state(false);
  let loadingSession = $state(false);
  let progressSteps = $state<ProgressStep[]>([]);
  let stepIdCounter = $state(0);

  let chatEl: HTMLDivElement | undefined;

  const STORAGE_KEY = 'chat-active-session-id';

  function toolIcon(tool: string): string {
    if (tool === 'retrieve_thoughts') return 'search';
    if (tool === 'answer_question') return 'sparkles';
    if (tool === 'edit_thought') return 'pencil';
    return 'bot';
  }

  function stepIcon(icon: string) {
    if (icon === 'search') return Search;
    if (icon === 'sparkles') return Sparkles;
    if (icon === 'pencil') return PencilLine;
    return Bot;
  }

  function scrollToBottom() {
    if (!chatEl) return;
    requestAnimationFrame(() => {
      chatEl!.scrollTop = chatEl!.scrollHeight;
    });
  }

  $effect(() => {
    if (messages.length > 0 || progressSteps.length > 0) {
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
      messages = (json.messages ?? []).map((m: SessionMessage) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));
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

  function addStep(label: string, icon: string) {
    const id = String(++stepIdCounter);
    progressSteps = [...progressSteps, { id, label, icon, status: 'active' }];
  }

  function markLastStepDone() {
    const steps = progressSteps;
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    if (last.status === 'done') return;
    progressSteps = steps.map((s, i) => (i === steps.length - 1 ? { ...s, status: 'done' } : s));
  }

  async function sendStreaming(text: string) {
    loading = true;
    progressSteps = [];
    stepIdCounter = 0;

    const body: Record<string, unknown> = { message: text };
    if (activeSessionId) body.sessionId = activeSessionId;

    const ac = new AbortController();
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
            markLastStepDone();
            addStep('Thinking...', 'bot');
          } else if (event.type === 'tool_call') {
            markLastStepDone();
            addStep(toolLabel(event.tool), toolIcon(event.tool));
          } else if (event.type === 'tool_result') {
            markLastStepDone();
          } else if (event.type === 'done') {
            if (event.sessionId) activeSessionId = event.sessionId;
            if (event.sessionId && browser) localStorage.setItem(STORAGE_KEY, event.sessionId);
            messages.push({ role: 'assistant', content: event.response });
            progressSteps = [];
            loadSessions();
          } else if (event.type === 'error') {
            messages.push({ role: 'assistant', content: `Error: ${event.error}` });
            progressSteps = [];
          }
        }
        if (done) break;
      }
    } catch (err) {
      messages.push({
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`
      });
      progressSteps = [];
    } finally {
      loading = false;
    }
  }

  function resend(text: string) {
    if (loading) return;
    messages.push({ role: 'user', content: text });
    sendStreaming(text);
  }

  function regenerate(index: number) {
    if (loading) return;
    let userIdx = index - 1;
    while (userIdx >= 0 && messages[userIdx].role !== 'user') {
      userIdx--;
    }
    if (userIdx < 0) return;
    const text = messages[userIdx].content;
    messages = messages.slice(0, index);
    sendStreaming(text);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = '';
    messages.push({ role: 'user', content: text });

    await sendStreaming(text);
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

<div class="relative mx-auto flex h-[calc(100dvh-8rem)] max-w-2xl flex-col px-4 pt-4">
  <!-- sidebar backdrop -->
  {#if $chatSidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-40 bg-black/30"
      onclick={() => ($chatSidebarOpen = false)}
    ></div>
  {/if}

  <!-- sidebar panel -->
  <div
    class="fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-background pt-safe shadow-lg transition-transform duration-200 {$chatSidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
    role="dialog"
    aria-label="Chat sessions"
  >
    <div class="flex items-center justify-between px-4 py-3">
      <h2 class="text-sm font-semibold">Chat History</h2>
      <button
        class="text-muted-foreground hover:text-foreground rounded-md p-1"
        onclick={() => ($chatSidebarOpen = false)}
        aria-label="Close sidebar"
      >
        <X class="size-4" strokeWidth={1.75} />
      </button>
    </div>

    <div class="px-3 pb-2">
      <Button size="sm" variant="outline" class="w-full justify-start gap-2 text-xs" onclick={newSession}>
        <Plus class="size-3.5" strokeWidth={1.75} />
        New chat
      </Button>
    </div>

    <Separator />

    <div class="flex-1 overflow-y-auto px-2 py-2">
      {#if sessions.length === 0}
        <p class="text-muted-foreground px-2 py-8 text-center text-xs">No conversations yet</p>
      {/if}
      {#each sessions as s (s.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="hover:bg-muted/50 group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left {s.id === activeSessionId ? 'bg-muted' : ''}"
          onclick={() => selectSession(s.id)}
        >
          <MessageSquareText class="mt-0.5 size-3.5 shrink-0 opacity-60" strokeWidth={1.5} />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{s.title || 'Untitled'}</p>
            <p class="text-muted-foreground mt-0.5 text-xs">{formatDate(s.updatedAt)}</p>
          </div>
          <button
            class="invisible group-hover:visible text-muted-foreground hover:text-destructive shrink-0 rounded p-0.5"
            onclick={(e) => deleteSession(s.id, e)}
            aria-label="Delete session"
          >
            <Trash2 class="size-3" strokeWidth={1.5} />
          </button>
        </div>
      {/each}
    </div>
  </div>

  <!-- messages area -->
  <div
    bind:this={chatEl}
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-4"
    role="log"
    aria-label="Chat messages"
  >
    {#if loadingSession}
      <div class="flex flex-1 items-center justify-center">
        <LoaderCircleIcon class="text-muted-foreground size-5 animate-spin" />
      </div>
    {:else if messages.length === 0 && progressSteps.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Bot class="text-muted-foreground size-8" strokeWidth={1.5} />
        <p class="text-muted-foreground max-w-xs text-sm">
          Ask me anything about your thoughts, or tell me to remember something new.
        </p>
      </div>
    {/if}

    {#each messages as msg, i (i)}
      <div class="flex gap-2 {msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start group">
        <div
          class="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full {msg.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'}"
        >
          {#if msg.role === 'user'}
            <User class="size-3.5" strokeWidth={2} />
          {:else}
            <Bot class="size-3.5" strokeWidth={2} />
          {/if}
        </div>
        {#if msg.role === 'user'}
          <div class="flex flex-col items-end gap-0.5">
            <div
              class="max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap bg-primary text-primary-foreground"
            >
              {msg.content}
            </div>
            <button
              class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 -mr-0.5"
              onclick={() => resend(msg.content)}
              aria-label="Send again"
            >
              <Redo2 class="size-3" strokeWidth={1.75} />
            </button>
          </div>
        {:else}
          <div class="flex flex-col items-start gap-0.5">
            <div
              class="max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap bg-muted text-foreground"
            >
              {msg.content}
            </div>
            <button
              class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 -ml-0.5"
              onclick={() => regenerate(i)}
              aria-label="Regenerate answer"
            >
              <RefreshCw class="size-3" strokeWidth={1.75} />
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if loading && progressSteps.length > 0}
      <div class="flex flex-row items-start gap-2">
        <div class="bg-muted text-muted-foreground mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
          <Bot class="size-3.5" strokeWidth={2} />
        </div>
        <div class="bg-muted text-muted-foreground min-w-0 rounded-xl px-3.5 py-2 text-sm">
          <div class="flex flex-col gap-1.5">
            {#each progressSteps as step (step.id)}
              <div class="flex items-center gap-2">
                {#if step.status === 'active'}
                  <LoaderCircleIcon class="size-3.5 shrink-0 animate-spin" />
                {:else}
                  <Check class="size-3.5 shrink-0 text-green-500" strokeWidth={2.5} />
                {/if}
                <span class="truncate {step.status === 'active' ? 'font-medium' : 'text-muted-foreground'}">
                  {step.label}
                </span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {:else if loading && progressSteps.length === 0}
      <div class="flex flex-row items-start gap-2">
        <div class="bg-muted text-muted-foreground mt-1 flex size-7 shrink-0 items-center justify-center rounded-full">
          <Bot class="size-3.5" strokeWidth={2} />
        </div>
        <div class="bg-muted text-muted-foreground rounded-xl px-3.5 py-2 text-sm">
          <LoaderCircleIcon class="size-4 animate-spin" />
        </div>
      </div>
    {/if}
  </div>

  <!-- input area -->
  <div class="flex items-center gap-2 pb-6 pt-3">
    <Input
      bind:value={input}
      onkeydown={handleKeydown}
      placeholder="Ask about your memories..."
      class="flex-1 text-sm"
      disabled={loading || loadingSession}
    />
    <Button onclick={send} disabled={loading || loadingSession || !input.trim()} size="icon" class="shrink-0">
      {#if loading}
        <LoaderCircleIcon class="size-4 animate-spin" />
      {:else}
        <SendHorizontal class="size-4" strokeWidth={1.75} />
      {/if}
    </Button>
  </div>
</div>
