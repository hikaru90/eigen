<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { onMount } from 'svelte'
  import type { SubmitFunction } from '@sveltejs/kit'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { capture } from '$lib/analytics/posthog-client'
  import {
    isIosDevice,
    isPwaStandalone,
    listenForAppInstalled,
    listenForInstallPrompt,
    promptPwaInstall,
    type BeforeInstallPromptEvent,
  } from '$lib/pwa/install'
  import { getPushSupportState, postSubscribe, subscribeToPush } from '$lib/push/client'
  import { ONBOARDING_GROUNDING_PUSH_DELAY_MS } from '$lib/grounding/onboarding-welcome-constants'

  let {
    open,
    walletAvailableCredits = 0,
    minCaptureCredits = 50,
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

  let deferredInstall = $state<BeforeInstallPromptEvent | null>(null)
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

  function resetOnOpen() {
    step = 0
    installError = null
    pushError = null
    welcomePushScheduled = false
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

    const stopPrompt = listenForInstallPrompt((event) => {
      deferredInstall = event
    })
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
      stopPrompt()
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
        deferredInstall = null
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

  const completeOnboardingEnhance: SubmitFunction =
    () =>
    async ({ result, update }) => {
      await update({ reset: false })
      if (result.type === 'success') {
        capture('onboarding_completed', {
          credits_available: localWalletCredits,
          pwa_installed: installDone,
          push_enabled: pushDone,
        })
        await invalidateAll()
      }
    }

  const skipOnboardingEnhance: SubmitFunction =
    () =>
    async ({ result, update }) => {
      await update({ reset: false })
      if (result.type === 'success') {
        capture('onboarding_skipped', { step })
        await invalidateAll()
      }
    }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-title"
    aria-describedby="onboarding-desc"
  >
    <Card.Root
      class="ring-foreground/10 max-h-[90dvh] w-full max-w-md overflow-y-auto border border-black/10 bg-card shadow-lg ring-1 dark:border-white/20"
    >
      <Card.Header class="space-y-2">
        <Card.Title id="onboarding-title" class="text-base">{title}</Card.Title>
        <Card.Description id="onboarding-desc" class="text-muted-foreground text-xs">
          Step {step + 1} of {lastStep + 1}
        </Card.Description>
      </Card.Header>

      <Card.Content class="space-y-3 text-sm text-card-foreground">
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
              {#if creditsOk}
                <form
                  method="post"
                  action="?/completeOnboarding"
                  use:enhance={completeOnboardingEnhance}
                  class="w-full"
                >
                  <Button
                    type="submit"
                    variant="ghost"
                    class="h-8 w-full rounded-[4px] text-xs text-muted-foreground"
                    onclick={() => capture('onboarding_push_skipped', {})}
                  >
                    Continue without notifications
                  </Button>
                </form>
              {:else}
                <form
                  method="post"
                  action="?/skipOnboarding"
                  use:enhance={skipOnboardingEnhance}
                  class="w-full"
                >
                  <Button
                    type="submit"
                    variant="ghost"
                    class="h-8 w-full rounded-[4px] text-xs text-muted-foreground"
                    onclick={() => capture('onboarding_push_skipped', {})}
                  >
                    Continue without notifications
                  </Button>
                </form>
              {/if}
            </div>
          {/if}
        {/if}
      </Card.Content>

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
              <Button type="submit" class="rounded-[4px] text-xs">Start capturing →</Button>
            </form>
          {:else}
            <form method="post" action="?/skipOnboarding" use:enhance={skipOnboardingEnhance}>
              <Button type="submit" class="rounded-[4px] text-xs">Start capturing →</Button>
            </form>
          {/if}
        {/if}
      </Card.Footer>
    </Card.Root>
  </div>
{/if}
