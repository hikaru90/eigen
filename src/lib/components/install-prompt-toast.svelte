<script lang="ts">
  import Smartphone from '@lucide/svelte/icons/smartphone'
  import X from '@lucide/svelte/icons/x'
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { capture } from '$lib/analytics/posthog-client'
  import { Button } from '$lib/components/ui/button'
  import {
    deferredInstallState,
    clearDeferredInstall,
    isInstalled,
  } from '$lib/pwa/deferred-install-store.svelte'
  import { isIosDevice, isPwaStandalone, promptPwaInstall } from '$lib/pwa/install'
  import {
    recordInstallPromptDismissal,
    recordInstallPromptPermanentDismissal,
    recordInstallPromptShown,
    shouldShowInstallPrompt,
  } from '$lib/pwa/install-prompt-state'

  let { userId }: { userId: string } = $props()

  let mounted = $state(false)
  let installBusy = $state(false)
  let installError = $state<string | null>(null)
  let ios = $state(false)

  onMount(() => {
    ios = isIosDevice()
    mounted = true
    // Stamp "shown" once at mount if the banner will render — explicit event,
    // not a reactive $effect cascade. The render itself stays a pure $derived.
    if (
      browser &&
      !isInstalled() &&
      !isPwaStandalone() &&
      shouldShowInstallPrompt(userId, { isStandalone: false })
    ) {
      recordInstallPromptShown(userId)
      capture('pwa_banner_shown', { platform: ios ? 'ios' : 'other' })
    }
  })

  /**
   * Visibility is pure derived view state from existing signals — no
   * `$effect` control flow. Recomputed on mount / store changes only.
   */
  const standalone = $derived(isInstalled() || (mounted && isPwaStandalone()))
  const hasNativePrompt = $derived(deferredInstallState.deferred !== null)
  const visible = $derived(
    mounted &&
      browser &&
      !standalone &&
      shouldShowInstallPrompt(userId, { isStandalone: false }),
  )
  // iOS has no beforeinstallprompt — it shows instructions instead. Everyone
  // else with a deferred event shows the native Install button.
  const showNativeInstall = $derived(!ios && hasNativePrompt)

  function dismiss(): void {
    recordInstallPromptDismissal(userId)
    capture('pwa_banner_dismissed', { platform: ios ? 'ios' : 'other' })
    installError = null
  }

  function permanentlyDismiss(): void {
    recordInstallPromptPermanentDismissal(userId)
    capture('pwa_banner_perm_dismissed', {})
  }

  async function onInstall(): Promise<void> {
    if (installBusy) return
    installBusy = true
    installError = null
    try {
      const event = deferredInstallState.deferred
      if (event) {
        const outcome = await promptPwaInstall(event)
        clearDeferredInstall()
        if (outcome === 'accepted') {
          recordInstallPromptPermanentDismissal(userId)
          capture('pwa_banner_installed', { via: 'beforeinstallprompt' })
        } else {
          recordInstallPromptDismissal(userId)
          capture('pwa_banner_dismissed', { via: 'native_dialog' })
        }
      } else if (isPwaStandalone()) {
        recordInstallPromptPermanentDismissal(userId)
        capture('pwa_banner_installed', { via: 'manual_confirm_standalone' })
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

  function onConfirmManualInstall(): void {
    recordInstallPromptPermanentDismissal(userId)
    capture('pwa_banner_installed', { via: 'manual_confirm' })
    installError = null
  }

</script>

{#if visible}
  <div
    class="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4"
    style="padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px));"
    role="region"
    aria-label="Install Eigen Mesh"
  >
    <div
      class="w-full max-w-md rounded-[4px] border border-black/10 bg-card p-3 shadow-lg dark:border-white/20"
    >
      <div class="flex items-start gap-2.5">
        <Smartphone class="mt-0.5 size-4 shrink-0 opacity-80" strokeWidth={1.75} />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium leading-relaxed text-foreground">
            Install Eigen Mesh on your device
          </p>
          <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {#if ios}
              Capture and reminders, one tap away. Add it to your Home Screen.
            {:else}
              Capture and reminders, one tap away. No app store, no update lag.
            {/if}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-[4px] p-1 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
          onclick={permanentlyDismiss}
        >
          <X class="size-3.5" strokeWidth={1.75} />
        </button>
      </div>



      {#if ios}
        <ol class="mt-2.5 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>Tap the <span class="font-medium text-foreground">Share</span> button in Safari</li>
          <li>Choose <span class="font-medium text-foreground">Add to Home Screen</span></li>
          <li>Open Eigen Mesh from your Home Screen</li>
        </ol>
        <div class="mt-2.5 flex items-center gap-2">
          <Button
            type="button"
            class="h-8 flex-1 rounded-[4px] text-xs"
            onclick={onConfirmManualInstall}
          >
            I've installed it
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="h-8 rounded-[4px] text-xs text-muted-foreground"
            onclick={dismiss}
          >
            Not now
          </Button>
        </div>
      {:else if showNativeInstall}
        <div class="mt-2.5 flex items-center gap-2">
          <Button
            type="button"
            class="h-8 flex-1 rounded-[4px] text-xs"
            disabled={installBusy}
            onclick={() => void onInstall()}
          >
            {installBusy ? 'Installing…' : 'Install now'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="h-8 rounded-[4px] text-xs text-muted-foreground"
            onclick={dismiss}
          >
            Not now
          </Button>
        </div>
      {:else}
        <p class="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Use your browser's <span class="font-medium text-foreground">Install app</span> /
          <span class="font-medium text-foreground">Add to dock</span> menu, then confirm below.
        </p>
        <div class="mt-2.5 flex items-center gap-2">
          <Button
            type="button"
            class="h-8 flex-1 rounded-[4px] text-xs"
            onclick={onConfirmManualInstall}
          >
            I've installed it
          </Button>
          <Button
            type="button"
            variant="ghost"
            class="h-8 rounded-[4px] text-xs text-muted-foreground"
            onclick={dismiss}
          >
            Not now
          </Button>
        </div>
      {/if}

      {#if installError}
        <p class="mt-2 text-destructive text-[11px] leading-relaxed">{installError}</p>
      {/if}
    </div>
  </div>
{/if}
