<script lang="ts">
  import type { PageData } from './$types'
  import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte'

  let { data }: { data: PageData } = $props()

  let walletAvailableCredits = $state((() => data.wallet.availableCredits)())
</script>

<div class="mx-auto max-w-2xl space-y-4 px-4 pb-[calc(var(--bottom-nav)+48px)] pt-[calc(var(--head)+32px)]">
  <section class="space-y-3">
    <div>
      <h2 class="text-sm font-medium">Credits</h2>
      <p class="text-muted-foreground mt-1 text-xs">
        Capture, chat, voice dictation, and embeddings all run on Eigen and debit your credits.
        Top up via PayPal (1,000 credits = $1 USD).
      </p>
    </div>
    <CreditsTopUpPanel
      surface="settings_llm"
      availableCredits={walletAvailableCredits}
      paypalConfigured={data.paypalConfigured}
      paypalClientId={data.paypalClientId}
      paypalSdkUrl={data.paypalSdkUrl}
      onBalanceUpdated={(credits) => {
        walletAvailableCredits = credits
      }}
    />
  </section>
</div>
