<script lang="ts">
  import type { ActionData, PageData } from './$types'
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { forgotPasswordSchema } from '$lib/validation/auth'

  const websiteOrigin = (import.meta.env.PUBLIC_WEBSITE_ORIGIN ?? '').replace(/\/$/, '')

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let email = $state('')
  let fieldErrors = $state<{ email?: string }>({})

  function validate() {
    const result = forgotPasswordSchema.safeParse({ email })
    if (result.success) {
      fieldErrors = {}
      return true
    }
    fieldErrors = { email: result.error.flatten().fieldErrors.email?.[0] }
    return false
  }
</script>

<div class="mx-auto max-w-md px-5 pt-10">
  <header class="text-center">
    {#if websiteOrigin}
      <a href={websiteOrigin} rel="external" class="inline-block" aria-label="Eigen home">
        <EigenWordmark heightClass="h-8" />
      </a>
    {:else}
      <a href={resolve('/')} class="inline-block" aria-label="Eigen home">
        <EigenWordmark heightClass="h-8" />
      </a>
    {/if}
    <p class="text-muted-foreground mt-2 text-xs">Reset password</p>
  </header>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
  >
    <Card.Content class="space-y-4 pt-6">
      {#if form?.checkEmail}
        <p class="text-foreground text-xs">{form.message}</p>
        <p class="text-muted-foreground text-center text-xs">
          <a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline"
            >Back to sign in</a
          >
        </p>
      {:else}
        {#if !data.mailConfigured}
          <p class="text-destructive text-xs">
            Password reset email is not configured on this server.
          </p>
        {/if}
        <p class="text-muted-foreground text-xs">
          Enter the email for your account. If it exists, we will send a reset link.
        </p>
        <form
          method="post"
          action="?/requestReset"
          use:enhance
          class="space-y-4"
          onsubmit={(e) => {
            if (!validate()) e.preventDefault()
          }}
        >
          <div class="space-y-1">
            <Label for="email">Email</Label>
            <input
              id="email"
              type="email"
              name="email"
              autocomplete="email"
              bind:value={email}
              class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {#if fieldErrors.email}
              <p id="email-error" class="text-destructive text-xs">{fieldErrors.email}</p>
            {/if}
          </div>
          <Button type="submit" class="w-full rounded-[4px]">Send reset link</Button>
          {#if form?.message}
            <p class="text-destructive text-xs">{form.message}</p>
          {/if}
        </form>
        <p class="text-muted-foreground text-center text-xs">
          <a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline"
            >Back to sign in</a
          >
        </p>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
