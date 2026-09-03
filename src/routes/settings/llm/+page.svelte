<script lang="ts">
  import type { ActionData, PageData } from './$types'
  import Check from '@lucide/svelte/icons/check'
  import { enhance } from '$app/forms'
  import { afterNavigate } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import * as Tabs from '$lib/components/ui/tabs'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  const initialTab = $derived(
    data.byokUiEnabled &&
      (page.url.searchParams.get('tab') === 'byok' ||
        page.url.searchParams.get('tab') === 'credits')
      ? (page.url.searchParams.get('tab') as 'byok' | 'credits')
      : data.initialTab,
  )

  let activeTab = $state<'credits' | 'byok'>(
    data.byokUiEnabled
      ? page.url.searchParams.get('tab') === 'byok' ||
        page.url.searchParams.get('tab') === 'credits'
        ? (page.url.searchParams.get('tab') as 'byok' | 'credits')
        : data.initialTab
      : 'credits',
  )
  let billingMode = $state<'platform_credits' | 'byok'>(form?.billingMode ?? data.billingMode)
  let selectedProvider = $state<'eurouter' | 'openrouter'>(data.activeProvider ?? 'eurouter')
  let walletAvailableCredits = $state(data.wallet.availableCredits)
  let legacyByokMigration = $state(data.legacyByokMigration)

  afterNavigate(() => {
    activeTab = data.byokUiEnabled ? initialTab : 'credits'
    legacyByokMigration = data.legacyByokMigration
  })

  const providers = [
    { id: 'openrouter' as const, label: 'OpenRouter' },
    { id: 'eurouter' as const, label: 'EUrouter' },
  ]
</script>

<div class="mx-auto max-w-2xl space-y-8 px-4 pb-8 pt-16">
  {#if legacyByokMigration}
    <section class="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3">
      <div>
        <h2 class="text-sm font-semibold">Bring your own key (legacy)</h2>
        <p class="text-muted-foreground mt-1 text-xs">
          Your account still has a saved EUrouter or OpenRouter API key
          {#if data.billingMode === 'byok'}
            and LLM calls are billed to that key
          {/if}
          . This deployment now uses Eigen platform credits for all LLM usage. Remove your stored key
          to switch to credits and stop requests from hitting your personal gateway rate limit.
        </p>
      </div>
      <form
        method="post"
        action="?/switchToPlatformCredits"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update()
            if (result.type === 'success') {
              billingMode = 'platform_credits'
              legacyByokMigration = false
            }
          }
        }}
      >
        <Button type="submit" variant="outline" size="sm" class="rounded-[4px]">
          Remove my API key and use Eigen credits
        </Button>
        {#if form?.legacyByokMessage}
          <p class="text-muted-foreground mt-2 text-xs">{form.legacyByokMessage}</p>
        {/if}
      </form>
    </section>
  {/if}

  {#if data.byokUiEnabled}
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold">Billing method</h2>
        <p class="text-muted-foreground mt-1 text-xs">
          Choose whether LLM calls use your Eigen wallet or your own gateway API keys. This applies
          to capture, chat, voice dictation, and embeddings.
        </p>
      </div>

      <form
        method="post"
        action="?/setBillingMode"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update()
            if (result.type === 'success' && result.data?.billingMode === 'byok') {
              billingMode = 'byok'
              activeTab = 'byok'
            } else if (
              result.type === 'success' &&
              result.data?.billingMode === 'platform_credits'
            ) {
              billingMode = 'platform_credits'
              activeTab = 'credits'
            }
          }
        }}
        class="rounded-xl bg-muted px-3.5 py-3"
      >
        <div class="space-y-2">
          <Label for="billing-mode">Method</Label>
          <select
            id="billing-mode"
            name="billingMode"
            class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
            bind:value={billingMode}
          >
            <option value="platform_credits">Eigen platform credits</option>
            <option value="byok" disabled={!data.byokConfigured}>Bring your own key (BYOK)</option>
          </select>
          {#if !data.byokConfigured}
            <p class="text-muted-foreground text-xs">
              To use BYOK, configure OpenRouter or EUrouter on the BYOK tab first.
            </p>
          {:else if billingMode === 'byok'}
            <p class="text-muted-foreground text-xs">
              Active provider: {data.activeProvider === 'eurouter' ? 'EUrouter' : 'OpenRouter'}.
              <a href={resolve('/settings/llm?tab=byok')} class="text-foreground underline"
                >Change</a
              >
            </p>
          {:else}
            <p class="text-muted-foreground text-xs">
              Capture, chat, voice dictation, and embeddings bill your Eigen wallet balance.
            </p>
          {/if}
          <Button type="submit" variant="outline" size="sm" class="rounded-[4px]"
            >Save billing method</Button
          >
          {#if form?.billingMessage}
            <p class="text-muted-foreground text-xs">{form.billingMessage}</p>
          {/if}
        </div>
      </form>
    </section>
  {:else}
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold">Billing</h2>
        <p class="text-muted-foreground mt-1 text-xs">
          Capture, chat, and embeddings use the operator LLM gateway (EUrouter or OpenRouter). Voice
          dictation always uses OpenRouter. All usage debits your Eigen wallet in credits.
        </p>
      </div>
    </section>
  {/if}

  {#if data.isAdmin}
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold">Model Configuration</h2>
        <p class="text-muted-foreground mt-1 text-xs">
          Override the default chat and embedding models. These settings apply to entity extraction,
          capture enrichment, and other LLM tasks.
          {#if data.byokUiEnabled}
            For full provider configuration (API keys, base URLs), use the BYOK tab.
          {:else}
            For full provider configuration, set environment variables or enable BYOK UI.
          {/if}
        </p>
      </div>

      <form
        method="post"
        action="?/saveModelConfig"
        use:enhance={() => {
          return async ({ update }) => {
            await update()
          }
        }}
        class="rounded-xl bg-muted px-3.5 py-3"
      >
        <input type="hidden" name="provider" value={selectedProvider} />
        <div class="space-y-3">
          <Label for="model-provider">Provider</Label>
          <select
            id="model-provider"
            bind:value={selectedProvider}
            class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
          >
            <option value="eurouter">EUrouter</option>
            <option value="openrouter">OpenRouter</option>
          </select>

          {#if selectedProvider === 'openrouter'}
            <div class="space-y-1">
              <Label for="modelChat">Chat model</Label>
              <input
                id="modelChat"
                type="text"
                name="modelChat"
                value={data.providers?.openrouter?.modelChat ?? ''}
                placeholder="e.g., openai/gpt-4o-mini, anthropic/claude-3-haiku"
                class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
              />
            </div>

            <div class="space-y-1">
              <Label for="modelEmbedding">Embedding model</Label>
              <input
                id="modelEmbedding"
                type="text"
                name="modelEmbedding"
                value={data.providers?.openrouter?.modelEmbedding ?? ''}
                placeholder="e.g., openai/text-embedding-3-small"
                class="border-input bg-background text-foreground h-9 w-full border px-2.5 text-xs"
              />
            </div>
          {:else}
            <div class="space-y-1">
              <Label for="ruleChat">Chat routing rule</Label>
              <input
                id="ruleChat"
                type="text"
                name="ruleChat"
                value={data.providers?.eurouter?.ruleChat ?? ''}
                placeholder="UUID routing rule for chat"
                class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
              />
            </div>

            <div class="space-y-1">
              <Label for="ruleEmbedding">Embedding routing rule</Label>
              <input
                id="ruleEmbedding"
                type="text"
                name="ruleEmbedding"
                value={data.providers?.eurouter?.ruleEmbedding ?? ''}
                placeholder="UUID routing rule for embeddings"
                class="border-input bg-background text-foreground h-9 w-full border px-2.5 font-mono text-xs"
              />
            </div>
          {/if}

          <Button type="submit" variant="outline" size="sm" class="rounded-[4px]"
            >Save model config</Button
          >
          {#if form?.modelMessage}
            <p class="text-muted-foreground text-xs">{form.modelMessage}</p>
          {/if}
        </div>
      </form>
    </section>
  {/if}

  <section class="space-y-4 mt-8">
    <div>
      <h2 class="text-sm font-semibold">Billing settings</h2>
      <p class="text-muted-foreground mt-1 text-xs">
        {#if data.byokUiEnabled}
          Top up Eigen credits on Credits, or manage OpenRouter and EUrouter keys on BYOK. PayPal
          charges USD (1,000 credits = $1).
        {:else}
          Top up Eigen credits via PayPal (1,000 credits = $1 USD).
        {/if}
      </p>
    </div>

    {#if data.byokUiEnabled}
      <Tabs.Root bind:value={activeTab} class="space-y-4">
        <Tabs.List class="w-full">
          <Tabs.Trigger value="credits" class="flex-1">Credits</Tabs.Trigger>
          <Tabs.Trigger value="byok" class="flex-1">BYOK</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="credits" class="space-y-3">
          {@render creditsPanel()}
        </Tabs.Content>

        <Tabs.Content value="byok" class="space-y-3">
          <div class="rounded-xl bg-muted px-3.5 py-3 text-sm">
            <p class="text-muted-foreground text-xs">
              Bring your own OpenRouter or EUrouter API keys. LLM calls use your keys and do not
              deduct Eigen credits.
            </p>
            <ul class="mt-3 divide-y divide-border/60">
              {#each providers as item (item.id)}
                {@const configured = data.providers[item.id].configured}
                {@const isActive = data.activeProvider === item.id && data.billingMode === 'byok'}
                <li>
                  <a
                    href={resolve(`/settings/llm/byok/${item.id}`)}
                    class="flex items-center justify-between gap-3 py-3 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span class="font-medium text-foreground">{item.label}</span>
                    <span class="flex items-center gap-1.5 text-muted-foreground">
                      {#if configured}
                        <Check
                          class="size-4 text-green-600 dark:text-green-400"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        {#if isActive}
                          <span class="text-foreground">Active</span>
                        {/if}
                      {:else}
                        <span>Not configured &gt;</span>
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
            {#if form?.llmMessage}
              <p class="text-muted-foreground mt-2 text-xs">{form.llmMessage}</p>
            {/if}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    {:else}
      <div class="space-y-3">
        {@render creditsPanel()}
      </div>
    {/if}
  </section>
</div>

{#snippet creditsPanel()}
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
{/snippet}
