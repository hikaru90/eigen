<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { page } from '$app/state'
  import { shouldShowBetaModal } from '$lib/beta-agreement'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import * as Dialog from '$lib/components/ui/dialog'
  import { m } from '$lib/paraglide/messages.js'

  let { onAccepted }: { onAccepted?: () => void } = $props()

  const layoutData = $derived(page.data as { user?: { id: string } | null; betaAgreementAccepted?: boolean })
  const authPaths = new Set(['/login', '/signup', '/register'])

  function normalizePathname(pathname: string): string {
    let p = pathname
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
    return p || '/'
  }

  const show = $derived(
    shouldShowBetaModal({
      isLoggedIn: layoutData.user != null,
      accepted: layoutData.betaAgreementAccepted ?? true,
      isAuthPath: authPaths.has(normalizePathname(page.url.pathname)),
    }),
  )

  let agreed = $state(false)
  let accepting = $state(false)
  let locallyAccepted = $state(false)
  let acceptError = $state(false)

  const open = $derived(show && !locallyAccepted)

  async function accept() {
    if (accepting) return
    accepting = true
    acceptError = false
    try {
      const res = await fetch('/api/beta-agreement', { method: 'POST' })
      if (!res.ok) throw new Error(`accept failed: ${res.status}`)
      locallyAccepted = true
      onAccepted?.()
      await invalidateAll()
    } catch {
      acceptError = true
    } finally {
      accepting = false
    }
  }
</script>

<Dialog.Root {open} onOpenChange={() => { /* blocking: close only via accept() */ }}>
  <Dialog.Content
    data-testid="beta-agreement-modal"
    class="max-w-lg rounded-none border-2 border-black dark:border-border"
    onEscapeKeydown={(e) => e.preventDefault()}
    onInteractOutside={(e) => e.preventDefault()}
    onFocusOutside={(e) => e.preventDefault()}
  >
    <Dialog.Header>
      <p class="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {m.beta_agreement_eyebrow()}
      </p>
      <Dialog.Title class="text-xl">{m.beta_agreement_title()}</Dialog.Title>
      <Dialog.Description>{m.beta_agreement_subtitle()}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 text-sm">
      <a
        href="https://eigenmesh.xyz/terms"
        target="_blank"
        rel="noopener noreferrer"
        class="underline underline-offset-2"
      >
        {m.beta_agreement_review_link()}
      </a>

      <div class="space-y-2">
        <p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {m.beta_agreement_key_details()}
        </p>
        <ul class="list-disc space-y-2 pl-5">
          <li>{m.beta_agreement_detail_early_stage()}</li>
          <li>{m.beta_agreement_detail_data_storage()}</li>
          <li>{m.beta_agreement_detail_no_training()}</li>
        </ul>
      </div>

      {#if acceptError}
        <p class="text-destructive text-sm" data-testid="beta-agreement-error">
          Accept failed. Please try again.
        </p>
      {/if}
    </div>

    <Dialog.Footer class="flex flex-col gap-3 sm:justify-start">
      <label class="flex items-start gap-2 text-sm" data-testid="beta-agreement-checkbox-label">
        <Checkbox bind:checked={agreed} />
        <span>{m.beta_agreement_checkbox_label()}</span>
      </label>
      <Button type="button" class="rounded-none" disabled={!agreed || accepting} onclick={accept}>
        {m.beta_agreement_accept_button()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
