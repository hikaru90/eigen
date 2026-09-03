<script lang="ts">
  import type { SubmitFunction } from '@sveltejs/kit'
  import XIcon from '@lucide/svelte/icons/x'
  import { onMount } from 'svelte'
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { capture } from '$lib/analytics/posthog-client'
  import { resolveSubmitOutcome } from '$lib/components/onboarding-submit-outcome'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { ONBOARDING_GROUNDING_PUSH_DELAY_MS } from '$lib/grounding/onboarding-welcome-constants'
  import { getPushSupportState, postSubscribe, subscribeToPush } from '$lib/push/client'
  import {
    deferredInstallState,
    clearDeferredInstall,
  } from '$lib/pwa/deferred-install-store.svelte'
  import {
    isIosDevice,
    isPwaStandalone,
    listenForAppInstalled,
    promptPwaInstall,
  } from '$lib/pwa/install'

  let {
    open,
    walletAvailableCredits = 0,
    minCaptureCredits = 5,
    creditsGatePassed = false,
    startingFreeCredits = 100,
  }: {
    open: boolean
    walletAvailableCredits?: number
    minCaptureCredits?: number
    creditsGatePassed?: boolean
    startingFreeCredits?: number
  } = $props()

  /** 0 welcome · 1 capture · 2 install · 3 notifications */
  let step = $state(0)
  const lastStep = 3

  /** Deferred install event comes from the shared app-wide store (see layout). */
  const deferredInstall = $derived(deferredInstallState.deferred)
  let installDone = $state(false)
  let installBusy = $state(false)
  let installError = $state<string | null>(null)
  let installConfirmedAt = $state<number | null>(null)
  let ios = $state(false)

  let pushDone = $state(false)
  let pushBusy = $state(false)
  let pushError = $state<string | null>(null)
  let pushUnsupportedReason = $state<string | null>(null)
  let welcomePushScheduled = $state(false)

  /** Submit-failure feedback + in-flight guard for the skip/complete forms. */
  let submitError = $state<string | null>(null)
  let submitBusy = $state(false)

  const SUBMIT_ERROR_MESSAGE =
    'Could not save — check your connection and try again, or use Skip.'

  function resetOnOpen() {
    step = 0
    installError = null
    pushError = null
    welcomePushScheduled = false
    submitError = null
    submitBusy = false
    ios = isIosDevice()
    installDone = isPwaStandalone()
    if (installDone && installConfirmedAt === null) {
      installConfirmedAt = Date.now()
    }
    const support = getPushSupportState()
    if (!support.supported) {
      pushUnsupportedReason = support.reason
    } else if (support.permission === 'granted') {
      pushUnsupportedReason = null
      void (async () => {
        try {
          const json = await subscribeToPush()
          await postSubscribe(json)
          pushDone = true
          void maybeScheduleWelcomePush()
        } catch {
          // Permission granted but subscribe failed — show enable CTA.
          pushDone = false
        }
      })()
    } else {
      pushUnsupportedReason = null
      pushDone = false
    }
  }

  onMount(() => {
    if (!open) return

    resetOnOpen()

    // beforeinstallprompt is captured app-wide by the shared store (layout);
    // this overlay reads `deferredInstall` from it. We still listen for
    // appinstalled here to fire onboarding-specific analytics + push scheduling.
    const stopInstalled = listenForAppInstalled(() => {
      installDone = true
      installConfirmedAt = Date.now()
      installError = null
      capture('onboarding_pwa_installed', { via: 'appinstalled' })
      void maybeScheduleWelcomePush()
    })

    const standalonePoll = window.setInterval(() => {
      if (!installDone && isPwaStandalone()) {
        installDone = true
        if (installConfirmedAt === null) installConfirmedAt = Date.now()
        void maybeScheduleWelcomePush()
      }
    }, 1000)

    return () => {
      stopInstalled()
      window.clearInterval(standalonePoll)
    }
  })

  const localWalletCredits = $derived(walletAvailableCredits)
  const creditsOk = $derived(localWalletCredits >= minCaptureCredits || creditsGatePassed)

  const titles = [
    'Your memory, not theirs.',
    'Just drop it in.',
    'Install Eigen Mesh',
    'Stay in the loop',
  ] as const
  const title = $derived(titles[step] ?? titles[0])

  async function maybeScheduleWelcomePush(): Promise<void> {
    if (welcomePushScheduled) return
    if (!installDone || installConfirmedAt === null) return
    if (!pushDone) return

    const remaining = Math.max(
      0,
      installConfirmedAt + ONBOARDING_GROUNDING_PUSH_DELAY_MS - Date.now(),
    )
    welcomePushScheduled = true
    try {
      const res = await fetch('/api/grounding/onboarding-welcome-push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delayMs: remaining }),
      })
      if (!res.ok) {
        welcomePushScheduled = false
        const body = await res.json().catch(() => null)
        const msg =
          body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
            ? body.message
            : `Failed to schedule welcome notification (${res.status})`
        console.error('[onboarding] welcome push schedule failed', msg)
        return
      }
      capture('onboarding_welcome_push_scheduled', { delay_ms: remaining })
    } catch (e) {
      welcomePushScheduled = false
      console.error('[onboarding] welcome push schedule failed', e)
    }
  }

  async function onInstallClick(): Promise<void> {
    if (installBusy) return
    installBusy = true
    installError = null
    try {
      if (deferredInstall) {
        const outcome = await promptPwaInstall(deferredInstall)
        clearDeferredInstall()
        if (outcome === 'accepted') {
          installDone = true
          installConfirmedAt = Date.now()
          capture('onboarding_pwa_installed', { via: 'beforeinstallprompt' })
          void maybeScheduleWelcomePush()
        } else {
          installError = 'Install was dismissed — try again, or continue without installing.'
        }
      } else if (isPwaStandalone()) {
        installDone = true
        if (installConfirmedAt === null) installConfirmedAt = Date.now()
        void maybeScheduleWelcomePush()
      } else {
        installError = ios
          ? 'Use Share → Add to Home Screen, then return here.'
          : 'Use your browser menu to install Eigen Mesh, then return here.'
      }
    } catch (e) {
      installError = e instanceof Error ? e.message : String(e)
    } finally {
      installBusy = false
    }
  }

  function markInstalledManually(): void {
    installDone = true
    if (installConfirmedAt === null) installConfirmedAt = Date.now()
    installError = null
    capture('onboarding_pwa_installed', { via: 'manual_confirm' })
    void maybeScheduleWelcomePush()
  }

  async function onEnableNotifications(): Promise<void> {
    if (pushBusy) return
    pushBusy = true
    pushError = null
    try {
      const json = await subscribeToPush()
      await postSubscribe(json)
      pushDone = true
      capture('onboarding_push_enabled', {})
      void maybeScheduleWelcomePush()
    } catch (e) {
      pushError = e instanceof Error ? e.message : String(e)
    } finally {
      pushBusy = false
    }
  }

  function advanceFromInstall(): void {
    if (!installDone) return
    step = 3
  }

  /**
   * Skip semantics: persist `onboardingCompleted` without the credits gate,
   * then refresh page data so the overlay unmounts. Used by the X button,
   * Escape, and as the fallback when completeOnboarding hits the credits
   * gate (400). Errors surface via `submitError` — never a silent dead-end.
   */
  async function submitSkipViaFetch(): Promise<boolean> {
    const res = await fetch('?/skipOnboarding', { method: 'POST' })
    if (!res.ok) return false
    capture('onboarding_skipped', { step })
    await invalidateAll()
    return true
  }

  function startSkipSubmit(): void {
    submitError = null
    submitBusy = true
    void (async () => {
      try {
        const ok = await submitSkipViaFetch()
        if (!ok) submitError = SUBMIT_ERROR_MESSAGE
      } catch {
        submitError = SUBMIT_ERROR_MESSAGE
      } finally {
        submitBusy = false
      }
    })()
  }

  function dismissWithSkip(): void {
    if (submitBusy) return
    capture('onboarding_dismissed', { step })
    startSkipSubmit()
  }

  function onOverlayKeydown(event: KeyboardEvent): void {
    if (!open) return
    if (event.key !== 'Escape') return
    if (submitBusy) return
    event.preventDefault()
    dismissWithSkip()
  }

  const completeOnboardingEnhance: SubmitFunction =
    () =>
    async ({ result, update }) => {
      const outcome = resolveSubmitOutcome(result)
      submitBusy = true
      let fallbackStarted = false
      try {
        if (outcome.kind === 'success') {
          await update({ reset: false })
          submitError = null
          capture('onboarding_completed', {
            credits_available: localWalletCredits,
            pwa_installed: installDone,
            push_enabled: pushDone,
          })
          await invalidateAll()
          return
        }
        await update({ reset: false })
        if (outcome.kind === 'credits_gate') {
          // Credits gate (400) blocked completion. Fall back to the ungated
          // skip action so the user is never stranded by a dead modal.
          capture('onboarding_completed_fallback_skip', {
            credits_available: localWalletCredits,
          })
          fallbackStarted = true
          startSkipSubmit()
          return
        }
        submitError =
          outcome.kind === 'auth'
            ? 'Your session expired — reload the page and sign in again.'
            : SUBMIT_ERROR_MESSAGE
      } finally {
        if (!fallbackStarted) submitBusy = false
      }
    }

  const skipOnboardingEnhance: SubmitFunction =
    () =>
    async ({ result, update }) => {
      const outcome = resolveSubmitOutcome(result)
      submitBusy = true
      try {
        if (outcome.kind === 'success') {
          await update({ reset: false })
          submitError = null
          capture('onboarding_skipped', { step })
          await invalidateAll()
          return
        }
        await update({ reset: false })
        submitError =
          outcome.kind === 'auth'
            ? 'Your session expired — reload the page and sign in again.'
            : SUBMIT_ERROR_MESSAGE
      } finally {
        submitBusy = false
      }
    }
</script>

<svelte:window onkeydown={onOverlayKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-title"
    aria-describedby="onboarding-desc"
  >
    <Card.Root
      class="ring-foreground/10 relative max-h-[90dvh] w-full max-w-md overflow-y-auto border border-black/10 bg-card shadow-lg ring-1 dark:border-white/20"
    >
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground absolute top-3 right-3 rounded p-1 transition-colors"
        aria-label="Close onboarding"
        disabled={submitBusy}
        onclick={() => {
          capture('onboarding_dismissed', { step })
          dismissWithSkip()
        }}
      >
        <XIcon class="size-4" />
      </button>
      <Card.Header class="space-y-2">
        <Card.Title id="onboarding-title" class="text-base">{title}</Card.Title>
        <Card.Description id="onboarding-desc" class="text-muted-foreground text-xs">
          Step {step + 1} of {lastStep + 1}
        </Card.Description>
      </Card.Header>

      <Card.Content class="relative space-y-3 text-sm text-card-foreground">
        {#if step === 0}
          <p class="text-xs leading-relaxed">
            Your memory shouldn't live inside one chat vendor or hyperscaler. Eigen Mesh is yours —
            portable across every AI tool you use, not locked to theirs.
          </p>
          <p class="text-xs leading-relaxed">
            You start with {startingFreeCredits.toLocaleString('en-US')} free credits to try it — no card
            needed.
          </p>
        {:else if step === 1}
          <p class="text-xs leading-relaxed">
            Eigen Mesh captures what's on your mind and keeps it organized and searchable. Nothing
            to file, nothing to tag.
          </p>
          <p class="text-xs leading-relaxed">
            Type it or say it. It files it away and remembers it for you — so next time you ask, it
            already knows what you knew.
          </p>
          {#if !creditsOk}
            <p class="text-xs text-muted-foreground leading-relaxed">
              Add credits on the next screen if capture is blocked — Settings → LLM also works.
            </p>
          {/if}
        {:else if step === 2}
          <p class="text-xs leading-relaxed">
            Install Eigen Mesh on your device so capture and reminders are one tap away.
          </p>
          {#if installDone}
            <p class="text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
              Installed. You're ready for the next step.
            </p>
          {:else}
            {#if ios}
              <ol class="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
                <li>Tap the Share button in Safari</li>
                <li>Choose <span class="font-medium">Add to Home Screen</span></li>
                <li>Open Eigen Mesh from your home screen, then confirm below</li>
              </ol>
            {:else if deferredInstall}
              <p class="text-xs text-muted-foreground leading-relaxed">
                Tap Install — your browser will ask you to confirm.
              </p>
            {:else}
              <p class="text-xs text-muted-foreground leading-relaxed">
                Tap Install to add Eigen Mesh to your device. If nothing appears, use your browser’s
                Install app / Add to dock menu, then confirm.
              </p>
            {/if}
            {#if installError}
              <p class="text-destructive text-xs">{installError}</p>
            {/if}
            <div class="flex flex-col gap-2 pt-1">
              {#if ios}
                <Button
                  type="button"
                  class="h-11 w-full rounded-[4px] text-sm font-medium"
                  onclick={markInstalledManually}
                >
                  I've installed it
                </Button>
              {:else}
                <Button
                  type="button"
                  class="h-11 w-full rounded-[4px] text-sm font-medium"
                  disabled={installBusy}
                  onclick={() => void onInstallClick()}
                >
                  {installBusy ? 'Installing…' : 'Install app'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  class="h-9 w-full rounded-[4px] text-xs"
                  onclick={markInstalledManually}
                >
                  I've already installed it
                </Button>
              {/if}
              <Button
                type="button"
                variant="ghost"
                class="h-8 w-full rounded-[4px] text-xs text-muted-foreground"
                onclick={() => {
                  capture('onboarding_pwa_skipped', {})
                  step = 3
                }}
              >
                Continue without installing
              </Button>
            </div>
          {/if}
        {:else}
          <p class="text-xs leading-relaxed">
            Enable notifications so Eigen Mesh can nudge you with a quick question after setup — and
            later for reminders and memory check-ins.
          </p>
          {#if pushDone}
            <p class="text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
              Notifications enabled for this device.
            </p>
          {:else if pushUnsupportedReason}
            <p class="text-xs text-muted-foreground leading-relaxed">
              Push isn't available here ({pushUnsupportedReason}). You can continue and enable later
              in Settings.
            </p>
          {:else}
            {#if pushError}
              <p class="text-destructive text-xs">{pushError}</p>
            {/if}
            <div class="flex flex-col gap-2 pt-1">
              <Button
                type="button"
                class="h-11 w-full rounded-[4px] text-sm font-medium"
                disabled={pushBusy}
                onclick={() => void onEnableNotifications()}
              >
                {pushBusy ? 'Enabling…' : 'Enable notifications'}
              </Button>
              <!-- Always skip semantics here: completeOnboarding is credits-gated and
                   can 400 for users below MIN_CAPTURE_PIPELINE_CREDITS. -->
              <form
                id="onboarding-skip-form"
                method="post"
                action="?/skipOnboarding"
                use:enhance={skipOnboardingEnhance}
                class="w-full"
              >
                <Button
                  type="submit"
                  variant="ghost"
                  class="h-8 w-full rounded-[4px] text-xs text-muted-foreground"
                  disabled={submitBusy}
                  onclick={() => capture('onboarding_push_skipped', {})}
                >
                  Continue without notifications
                </Button>
              </form>
            </div>
          {/if}
        {/if}
      </Card.Content>

      {#if submitError}
        <div
          class="text-destructive border-destructive/30 bg-destructive/10 mx-6 rounded border px-3 py-2 text-xs"
          role="alert"
        >
          {submitError}
        </div>
      {/if}

      <Card.Footer
        class="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-4 dark:border-white/15"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          {#if step > 0}
            <Button
              type="button"
              variant="outline"
              class="rounded-[4px] text-xs"
              onclick={() => (step -= 1)}
            >
              Back
            </Button>
          {/if}
          <form method="post" action="?/skipOnboarding" use:enhance={skipOnboardingEnhance}>
            <Button
              type="submit"
              variant="ghost"
              class="rounded-[4px] text-xs text-muted-foreground"
              disabled={submitBusy}
            >
              Skip for now
            </Button>
          </form>
        </div>

        {#if step < 2}
          <Button type="button" class="rounded-[4px] text-xs" onclick={() => (step += 1)}
            >Next</Button
          >
        {:else if step === 2}
          {#if installDone}
            <Button type="button" class="rounded-[4px] text-xs" onclick={advanceFromInstall}>
              Next
            </Button>
          {/if}
        {:else if pushDone || pushUnsupportedReason}
          {#if creditsOk}
            <form
              method="post"
              action="?/completeOnboarding"
              use:enhance={completeOnboardingEnhance}
            >
              <Button type="submit" class="rounded-[4px] text-xs" disabled={submitBusy}
                >Start capturing →</Button
              >
            </form>
          {:else}
            <form method="post" action="?/skipOnboarding" use:enhance={skipOnboardingEnhance}>
              <Button type="submit" class="rounded-[4px] text-xs" disabled={submitBusy}
                >Start capturing →</Button
              >
            </form>
          {/if}
        {/if}
      </Card.Footer>
    </Card.Root>
  </div>
{/if}
