<script lang="ts">
  import type { EvalQaRecord } from '$lib/eval/qa-store'
  import { assignCaptureFixtureIds } from '$lib/eval/qa-id'
  import { excerpt } from '$lib/eval/display'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'

  type CaptureDraft = { fixtureId: string; rawText: string }

  function fixtureIdPool(): Set<string> {
    const used = new Set<string>()
    for (const item of items) {
      for (const cap of item.captures) {
        used.add(cap.fixtureId)
      }
    }
    return used
  }

  function resolveCapturesForPayload(): EvalQaRecord['captures'] {
    return assignCaptureFixtureIds(
      formCaptures
        .filter((c) => c.rawText.trim())
        .map((c) => ({ fixtureId: c.fixtureId.trim(), rawText: c.rawText.trim() })),
      fixtureIdPool(),
    )
  }

  let {
    initialItems = [],
    onRunQuestion,
  }: {
    initialItems?: EvalQaRecord[]
    onRunQuestion?: (qaId: string) => void | Promise<void>
  } = $props()

  let items = $state<EvalQaRecord[]>([...initialItems])
  let editingId = $state<string | null>(null)
  let formQuestion = $state('')
  let formAcceptance = $state('')
  let formCaptures = $state<CaptureDraft[]>([{ fixtureId: '', rawText: '' }])
  let formRetrievalQuery = $state('')
  let formRetrievalRelevant = $state('')
  let formTags = $state('')
  let formEditCaptureIndex = $state<number | ''>('')
  let formEditRawText = $state('')
  let formChecksJson = $state('{}')
  let saving = $state(false)
  let error = $state<string | null>(null)

  const isEditing = $derived(editingId !== null && editingId !== '')
  const INACTIVE_TAG = 'inactive'

  function isItemActive(item: EvalQaRecord): boolean {
    return !item.tags.includes(INACTIVE_TAG)
  }

  function formatRelevantLines(relevant: EvalQaRecord['retrievalRelevant']): string {
    return relevant.map((r) => `${r.id}:${r.grade}`).join('\n')
  }

  function parseRelevantLines(text: string): EvalQaRecord['retrievalRelevant'] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, gradeStr] = line.split(':')
        return { id: id?.trim() ?? '', grade: Number(gradeStr) as 0 | 1 | 2 | 3 }
      })
      .filter((r) => r.id.length > 0 && r.grade >= 0 && r.grade <= 3)
  }

  function resetForm() {
    editingId = null
    formQuestion = ''
    formAcceptance = ''
    formCaptures = [{ fixtureId: '', rawText: '' }]
    formRetrievalQuery = ''
    formRetrievalRelevant = ''
    formTags = ''
    formEditCaptureIndex = ''
    formEditRawText = ''
    formChecksJson = '{}'
    error = null
  }

  function formatChecksJson(checks: EvalQaRecord['checks']): string {
    return JSON.stringify(checks ?? {}, null, 2)
  }

  function parseChecksJson(text: string): EvalQaRecord['checks'] {
    const trimmed = text.trim()
    if (!trimmed || trimmed === '{}') return {}
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Checks must be a JSON object')
    }
    return parsed as EvalQaRecord['checks']
  }

  function startCreate() {
    resetForm()
    editingId = ''
  }

  function startEdit(item: EvalQaRecord) {
    editingId = item.id
    formQuestion = item.question
    formAcceptance = item.acceptance
    formCaptures =
      item.captures.length > 0
        ? item.captures.map((cap) => ({
            fixtureId: cap.fixtureId,
            rawText: cap.rawText ?? '',
          }))
        : [{ fixtureId: '', rawText: '' }]
    formRetrievalQuery = item.retrievalQuery ?? ''
    formRetrievalRelevant = formatRelevantLines(item.retrievalRelevant)
    formTags = item.tags.join(', ')
    if (item.edit) {
      const idx = item.captures.findIndex((c) => c.fixtureId === item.edit!.fixtureId)
      formEditCaptureIndex = idx >= 0 ? idx : ''
    } else {
      formEditCaptureIndex = ''
    }
    formEditRawText = item.edit?.newRawText ?? ''
    formChecksJson = formatChecksJson(item.checks)
    error = null
  }

  function addCaptureRow() {
    formCaptures = [...formCaptures, { fixtureId: '', rawText: '' }]
  }

  function removeCaptureRow(index: number) {
    formCaptures = formCaptures.filter((_, i) => i !== index)
    if (formCaptures.length === 0) {
      formCaptures = [{ fixtureId: '', rawText: '' }]
    }
  }

  function buildPayload() {
    const captures = resolveCapturesForPayload()
    const edit =
      formEditCaptureIndex !== '' && formEditRawText.trim()
        ? {
            fixtureId: captures[Number(formEditCaptureIndex)]!.fixtureId,
            newRawText: formEditRawText.trim(),
          }
        : null
    return {
      question: formQuestion,
      acceptance: formAcceptance,
      captures,
      retrievalQuery: formRetrievalQuery.trim() || null,
      retrievalRelevant: parseRelevantLines(formRetrievalRelevant),
      tags: formTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      edit,
      checks: parseChecksJson(formChecksJson),
    }
  }

  async function save() {
    saving = true
    error = null
    let payload: ReturnType<typeof buildPayload>
    try {
      payload = buildPayload()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      saving = false
      return
    }
    try {
      if (editingId === '') {
        const res = await fetch('/api/eval/qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Failed to create')
        items = [...items, body.item].sort((a, b) => a.id.localeCompare(b.id))
        resetForm()
      } else if (editingId) {
        const res = await fetch(`/api/eval/qa/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Failed to update')
        items = items
          .map((item) => (item.id === editingId ? body.item : item))
          .sort((a, b) => a.id.localeCompare(b.id))
        resetForm()
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function remove(item: EvalQaRecord) {
    if (!confirm(`Delete "${item.id}"?`)) return
    saving = true
    error = null
    try {
      const res = await fetch(`/api/eval/qa/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to delete')
      items = items.filter((row) => row.id !== item.id)
      if (editingId === item.id) resetForm()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function toggleActive(item: EvalQaRecord) {
    saving = true
    error = null
    try {
      const nextTags = isItemActive(item)
        ? [...item.tags.filter((tag) => tag !== INACTIVE_TAG), INACTIVE_TAG]
        : item.tags.filter((tag) => tag !== INACTIVE_TAG)
      const res = await fetch(`/api/eval/qa/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: nextTags,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to update')
      items = items
        .map((row) => (row.id === item.id ? body.item : row))
        .sort((a, b) => a.id.localeCompare(b.id))
      if (editingId === item.id) {
        const updated = body.item as EvalQaRecord
        startEdit(updated)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-muted-foreground max-w-xl text-sm">
      Each test ingests captures, runs deterministic structural checks, optionally retrieval/edit,
      then judges the answer. Use <strong>Run</strong> on a catalog row to execute one question at a time.
    </p>
    <Button variant="outline" disabled={saving || editingId === ''} onclick={startCreate}>
      New question
    </Button>
  </div>

  {#if editingId !== null}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">{isEditing ? 'Edit' : 'New'} Q&amp;A</Card.Title>
        <Card.Description>
          {#if isEditing}
            ID <code class="text-foreground">{editingId}</code> cannot be changed. Tags: comma-separated
            (e.g. recall, haystack).
          {:else}
            ID is generated from your question when you save. Tags: comma-separated (e.g. recall,
            haystack).
          {/if}
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground text-sm font-medium">Thoughts to ingest first</span>
            <Button type="button" variant="outline" size="sm" onclick={addCaptureRow}
              >Add thought</Button
            >
          </div>
          <p class="text-muted-foreground text-xs">
            Fixture IDs are generated from the thought text when you save (e.g.
            ec_marcus_walnut_allergy).
          </p>
          {#each formCaptures as cap, i}
            <div class="space-y-2 rounded-md border p-3">
              {#if isEditing && cap.fixtureId.trim()}
                <p class="text-muted-foreground text-xs">
                  Fixture <code class="text-foreground">{cap.fixtureId}</code>
                </p>
              {/if}
              <label class="grid gap-1 text-sm">
                <span class="text-muted-foreground">Thought text</span>
                <Textarea
                  bind:value={cap.rawText}
                  rows={2}
                  placeholder="Marcus is allergic to walnuts…"
                />
              </label>
              {#if formCaptures.length > 1}
                <Button type="button" variant="ghost" size="sm" onclick={() => removeCaptureRow(i)}>
                  Remove
                </Button>
              {/if}
            </div>
          {/each}
        </div>

        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Question</span>
          <Textarea bind:value={formQuestion} rows={2} placeholder="what should I avoid…" />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Acceptance criteria</span>
          <Textarea
            bind:value={formAcceptance}
            rows={3}
            placeholder="Must mention walnut allergy…"
          />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Tags (comma-separated)</span>
          <Input bind:value={formTags} placeholder="recall, haystack" />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Retrieval query (optional)</span>
          <Input bind:value={formRetrievalQuery} placeholder="Marcus walnut allergy" />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground"
            >Retrieval relevant (one per line: fixture_id:grade 0–3)</span
          >
          <Textarea bind:value={formRetrievalRelevant} rows={2} placeholder="ec_marcus_walnut:3" />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-muted-foreground">Structural checks (JSON)</span>
          <Textarea
            bind:value={formChecksJson}
            rows={8}
            class="font-mono text-xs"
            placeholder={'{\n  "graph": { "requireThoughtNodes": ["ec_011"] }\n}'}
          />
          <span class="text-muted-foreground text-xs">
            Keys: graph, relations, entities, ontology, extraction, embedding, retrieval, learning.
            Empty object uses defaults (graph, embedding, ontology, enrichment).
          </span>
        </label>
        <div class="grid gap-2 rounded-md border p-3">
          <p class="text-muted-foreground text-sm font-medium">Edit step (optional)</p>
          <label class="grid gap-1 text-sm">
            <span class="text-muted-foreground">Which thought to correct</span>
            <select
              class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              bind:value={formEditCaptureIndex}
            >
              <option value="">No edit step</option>
              {#each formCaptures as cap, i}
                {#if cap.rawText.trim()}
                  <option value={i}>
                    {#if cap.fixtureId.trim()}{cap.fixtureId} —
                    {/if}{excerpt(cap.rawText, 56)}
                  </option>
                {/if}
              {/each}
            </select>
          </label>
          <label class="grid gap-1 text-sm">
            <span class="text-muted-foreground">Corrected text</span>
            <Textarea
              bind:value={formEditRawText}
              rows={2}
              placeholder="Full revised thought body…"
            />
          </label>
        </div>
        {#if error}
          <p class="text-destructive text-sm">{error}</p>
        {/if}
        <div class="flex gap-2">
          <Button disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button variant="ghost" disabled={saving} onclick={resetForm}>Cancel</Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">
        Catalog ({items.length})
      </Card.Title>
    </Card.Header>
    <Card.Content class="space-y-3">
      {#if items.length === 0}
        <p class="text-muted-foreground text-sm">
          No questions yet. Create one to run from the Runs tab.
        </p>
      {:else}
        {#each items as item (item.id)}
          <article class="rounded-lg border p-4">
            <div class="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <code class="text-xs font-semibold">{item.id}</code>
                <span
                  class="rounded px-1.5 py-0.5 text-xs {isItemActive(item)
                    ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-600/10 text-amber-700 dark:text-amber-300'}"
                >
                  {isItemActive(item) ? 'Active' : 'Inactive'}
                </span>
                {#each item.tags as tag}
                  <span class="bg-muted rounded px-1.5 py-0.5 text-xs">{tag}</span>
                {/each}
              </div>
              <div class="flex gap-2">
                {#if onRunQuestion}
                  <Button
                    size="sm"
                    disabled={saving || !isItemActive(item)}
                    onclick={() => void onRunQuestion(item.id)}
                  >
                    Run
                  </Button>
                {/if}
                <label class="inline-flex items-center gap-2 text-xs font-medium">
                  <span class="text-muted-foreground"
                    >{isItemActive(item) ? 'Active' : 'Inactive'}</span
                  >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isItemActive(item)}
                    aria-label={`Toggle ${item.id} active state`}
                    class="relative inline-flex h-6 w-11 items-center rounded-full border transition-colors {isItemActive(
                      item,
                    )
                      ? 'bg-primary border-primary'
                      : 'bg-muted border-border'} {saving ? 'opacity-60' : ''}"
                    disabled={saving}
                    onclick={() => void toggleActive(item)}
                  >
                    <span
                      class="inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform {isItemActive(
                        item,
                      )
                        ? 'translate-x-5'
                        : 'translate-x-0'}"
                    ></span>
                  </button>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onclick={() => startEdit(item)}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  class="text-destructive"
                  onclick={() => remove(item)}
                >
                  Delete
                </Button>
              </div>
            </div>
            <p class="text-sm font-medium">Question</p>
            <p class="text-muted-foreground mt-0.5 text-sm whitespace-pre-wrap">{item.question}</p>
            <p class="mt-3 text-sm font-medium">Acceptance</p>
            <p class="text-muted-foreground mt-0.5 text-sm whitespace-pre-wrap">
              {item.acceptance}
            </p>
            {#if item.retrievalQuery}
              <p class="mt-3 text-sm font-medium">Retrieval</p>
              <p class="text-muted-foreground text-xs">{item.retrievalQuery}</p>
            {/if}
            {#if item.edit}
              <p class="mt-3 text-sm font-medium">Edit step</p>
              <p class="text-muted-foreground text-xs font-mono">{item.edit.fixtureId}</p>
            {/if}
            {#if item.captures.length > 0}
              <p class="mt-3 text-sm font-medium">Captures ({item.captures.length})</p>
              <ul class="text-muted-foreground mt-1 space-y-1 text-xs">
                {#each item.captures as cap}
                  <li><span class="font-mono">{cap.fixtureId}</span> — {cap.rawText}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      {/if}
    </Card.Content>
  </Card.Root>
</div>
