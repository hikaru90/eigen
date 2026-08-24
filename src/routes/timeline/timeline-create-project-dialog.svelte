<script lang="ts">
  import type { CreateProjectResponse } from '../api/timeline/projects/+server'
  import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { m } from '$lib/paraglide/messages.js'
  import type { ProjectStatus } from '$lib/server/db/schema'

  type Props = {
    open: boolean
    onClose: () => void
    onCreated: (project: CreateProjectResponse) => void
  }

  let { open = $bindable(false), onClose, onCreated }: Props = $props()

  let label = $state('')
  let status = $state<ProjectStatus>('active')
  let busy = $state(false)
  let error = $state<string | null>(null)

  const statusOptions = [
    { id: 'active' as const, label: m.graph_timeline_project_status_active() },
    { id: 'someday' as const, label: m.graph_timeline_project_status_someday() },
  ]

  function resetForm() {
    label = ''
    status = 'active'
    error = null
  }

  async function submit() {
    const trimmedLabel = label.trim()
    if (!trimmedLabel || busy) return

    busy = true
    error = null
    try {
      const res = await fetch('/api/timeline/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: trimmedLabel,
          status,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      const body = (await res.json()) as CreateProjectResponse
      onCreated(body)
      open = false
      onClose()
      resetForm()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function onDialogOpenChange(next: boolean) {
    open = next
    if (next) {
      resetForm()
    } else {
      onClose()
    }
  }
</script>

<Dialog.Root {open} onOpenChange={onDialogOpenChange}>
  <Dialog.Content
    class="fixed inset-x-0 bottom-0 top-auto flex max-h-[min(85vh,32rem)] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-xl border p-0 shadow-lg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(90vh,36rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-0"
  >
    <div class="border-border shrink-0 border-b px-4 py-3">
      <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
        <FolderKanbanIcon class="text-muted-foreground size-4" aria-hidden="true" />
        {m.graph_timeline_create_project()}
      </Dialog.Title>
      <Dialog.Description class="text-muted-foreground mt-1 text-xs">
        {m.graph_timeline_create_project_description()}
      </Dialog.Description>
    </div>

    <form
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      onsubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div class="space-y-1.5">
        <Label for="create-project-label" class="text-xs"
          >{m.graph_timeline_create_project_name()}</Label
        >
        <Input
          id="create-project-label"
          bind:value={label}
          placeholder={m.graph_timeline_create_project_name_placeholder()}
          class="h-9 font-mono text-xs"
          disabled={busy}
          required
        />
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs">{m.graph_timeline_create_project_status()}</Label>
        <div
          class="border-border inline-flex w-full rounded-md border p-0.5"
          role="group"
          aria-label={m.graph_timeline_create_project_status()}
        >
          {#each statusOptions as option (option.id)}
            <button
              type="button"
              class="flex-1 rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors {status ===
              option.id
                ? 'bg-foreground text-background'
                : 'text-black hover:bg-muted/40 dark:text-foreground'}"
              aria-pressed={status === option.id}
              disabled={busy}
              onclick={() => (status = option.id)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>

      {#if error}
        <p class="text-destructive text-xs">{error}</p>
      {/if}

      <div class="mt-auto flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          class="h-9 flex-1 text-xs"
          disabled={busy}
          onclick={() => onDialogOpenChange(false)}
        >
          {m.graph_temporal_cancel()}
        </Button>
        <Button type="submit" class="h-9 flex-1 text-xs" disabled={busy || !label.trim()}>
          {#if busy}
            <LoaderCircleIcon class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          {:else}
            <PlusIcon class="mr-1.5 size-3.5" aria-hidden="true" />
          {/if}
          {m.graph_timeline_create_project_submit()}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
