<script lang="ts">
  import type { ActionData, PageData } from './$types'
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { homeHref } from '$lib/navigation/home-href'
  import { resetPasswordSchema } from '$lib/validation/auth'

  const websiteOrigin = (import.meta.env.PUBLIC_WEBSITE_ORIGIN ?? '').replace(/\/$/, '')
  const homeLink = homeHref(websiteOrigin)

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let password = $state('')
  let fieldErrors = $state<{ password?: string }>({})

  const hasToken = $derived(Boolean(data.token) && !data.error)

  function validate() {
    const result = resetPasswordSchema.safeParse({
      password,
      token: data.token ?? '',
    })
    if (result.success) {
      fieldErrors = {}
      return true
    }
    fieldErrors = { password: result.error.flatten().fieldErrors.password?.[0] }
    return false
  }
</script>

<div class="mx-auto max-w-md px-5 pt-10">
  <header class="text-center">
    <a href={homeLink} class="inline-block" aria-label="Eigen home">
      <EigenWordmark heightClass="h-8" />
    </a>
    <p class="text-muted-foreground mt-2 text-xs">Choose a new password</p>
  </header>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
  >
    <Card.Content class="space-y-4 pt-6">
      {#if form?.success}
        <p class="text-foreground text-xs">{form.message}</p>
        <p class="text-muted-foreground text-center text-xs">
          <a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline"
            >Sign in</a
          >
        </p>
      {:else if !hasToken}
        <p class="text-destructive text-xs">
          This reset link is invalid or expired. Request a new one from the forgot password page.
        </p>
        <p class="text-muted-foreground text-center text-xs">
          <a
            href={resolve('/forgot-password')}
            class="text-foreground underline-offset-2 hover:underline">Forgot password</a
          >
        </p>
      {:else}
        <form
          method="post"
          action="?/resetPassword"
          use:enhance
          class="space-y-4"
          onsubmit={(e) => {
            if (!validate()) e.preventDefault()
          }}
        >
          <input type="hidden" name="token" value={data.token} />
          <div class="space-y-1">
            <Label for="password">New password</Label>
            <input
              id="password"
              type="password"
              name="password"
              autocomplete="new-password"
              bind:value={password}
              class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            <p class="text-muted-foreground text-[10px]">Minimum 8 characters</p>
            {#if fieldErrors.password}
              <p id="password-error" class="text-destructive text-xs">{fieldErrors.password}</p>
            {/if}
          </div>
          <Button type="submit" class="w-full rounded-[4px]">Reset password</Button>
          {#if form?.message}
            <p class="text-destructive text-xs">{form.message}</p>
          {/if}
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
