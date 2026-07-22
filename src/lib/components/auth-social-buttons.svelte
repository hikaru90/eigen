<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { authClient } from '$lib/auth-client'
  import type { SocialProviderId } from '$lib/server/auth-social'

  let {
    providers,
    callbackURL = '/capture',
  }: {
    providers: SocialProviderId[]
    callbackURL?: string
  } = $props()

  let busy = $state<SocialProviderId | null>(null)
  let errorMessage = $state<string | null>(null)

  const labels: Record<SocialProviderId, string> = {
    google: 'Continue with Google',
    github: 'Continue with GitHub',
  }

  function providerButtonClass(provider: SocialProviderId): string {
    if (provider === 'google') {
      return 'w-full rounded-[4px] border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f8f9fa] hover:text-[#202124] dark:border-[#5f6368] dark:bg-transparent dark:text-foreground dark:hover:bg-muted'
    }
    return 'w-full rounded-[4px]'
  }

  async function signInWith(provider: SocialProviderId) {
    busy = provider
    errorMessage = null
    try {
      await authClient.signIn.social({ provider, callbackURL })
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Social sign-in failed'
      busy = null
    }
  }
</script>

{#if providers.length > 0}
  <div class="space-y-2">
    {#each providers as provider (provider)}
      <Button
        type="button"
        variant="outline"
        class={providerButtonClass(provider)}
        disabled={busy !== null}
        onclick={() => signInWith(provider)}
      >
        {#if provider === 'google'}
          <svg viewBox="0 0 24 24" aria-hidden="true" class="mr-2 h-4 w-4">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.4c-.2 1.2-.8 2.2-1.7 2.9l2.8 2.2c1.7-1.5 2.7-3.9 2.7-6.7 0-.7-.1-1.3-.2-1.9H12z"
            />
            <path
              fill="#34A853"
              d="M12 21c2.4 0 4.5-.8 6-2.1l-2.8-2.2c-.8.5-1.9.9-3.2.9-2.5 0-4.7-1.7-5.5-4l-2.9 2.2C5.1 18.8 8.3 21 12 21z"
            />
            <path
              fill="#4A90E2"
              d="M6.5 13.6c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6L3.6 8.2C2.9 9.5 2.5 10.7 2.5 12s.4 2.5 1.1 3.8l2.9-2.2z"
            />
            <path
              fill="#FBBC05"
              d="M12 6.4c1.4 0 2.6.5 3.6 1.4l2.6-2.6C16.5 3.6 14.4 3 12 3 8.3 3 5.1 5.2 3.6 8.2l2.9 2.2c.8-2.3 3-4 5.5-4z"
            />
          </svg>
        {/if}
        {busy === provider ? 'Redirecting…' : labels[provider]}
      </Button>
    {/each}
    {#if errorMessage}
      <p class="text-destructive text-xs">{errorMessage}</p>
    {/if}
  </div>
{/if}
