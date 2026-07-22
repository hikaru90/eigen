<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchTextFile, updateTextFile, type TextFileRecord } from '$lib/text-files/api'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { m } from '$lib/paraglide/messages.js'

  let {
    fileId,
    open = $bindable(false),
    onSaved,
  }: {
    fileId: string | null
    open?: boolean
    onSaved?: (record: TextFileRecord) => void | Promise<void>
  } = $props()

  let loading = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let saved = $state(false)
  let editTitle = $state('')
  let editBody = $state('')

  async function loadNote() {
    if (!fileId) return
    loading = true
    error = null
    saved = false
    try {
      const file = await fetchTextFile(fileId)
      editTitle = file.title
      editBody = file.body
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function saveNote() {
    if (!fileId || !editBody.trim()) return
    saving = true
    error = null
    saved = false
    try {
      const updated = await updateTextFile(fileId, {
        title: editTitle,
        body: editBody,
      })
      saved = true
      await onSaved?.(updated)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  function onOpenChange(next: boolean) {
    open = next
    if (next && fileId) {
      void loadNote()
    }
    if (!next) {
      error = null
      saved = false
    }
  }

  onMount(() => {
    if (open && fileId) void loadNote()
  })
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="max-w-lg rounded-none border-2 border-black dark:border-border">
    <Dialog.Header>
      <Dialog.Title>{m.notes_edit_title()}</Dialog.Title>
      <Dialog.Description>{m.notes_edit_description()}</Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <p class="text-sm text-muted-foreground">{m.notes_loading()}</p>
    {:else}
      <div class="space-y-3">
        <div class="space-y-1">
          <Label for="note-edit-title">{m.notes_title_label()}</Label>
          <Input
            id="note-edit-title"
            bind:value={editTitle}
            class="rounded-none"
            placeholder={m.notes_untitled()}
          />
        </div>
        <div class="space-y-1">
          <Label for="note-edit-body">{m.notes_body_label()}</Label>
          <Textarea
            id="note-edit-body"
            bind:value={editBody}
            class="min-h-48 rounded-none font-mono text-sm"
          />
        </div>
        {#if error}
          <p class="text-xs text-destructive">{error}</p>
        {/if}
        {#if saved}
          <p class="text-xs text-muted-foreground">{m.notes_saved()}</p>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      <Button
        type="button"
        class="rounded-none"
        disabled={loading || saving || !editBody.trim()}
        onclick={() => void saveNote()}
      >
        {#if saving}
          <LoaderCircleIcon class="mr-1 size-3.5 animate-spin" aria-hidden="true" />
        {/if}
        {m.notes_save()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
