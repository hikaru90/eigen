<script lang="ts">
  import type { ActionData } from './$types'
  import type { PageData } from './$types'
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import AuthSocialButtons from '$lib/components/auth-social-buttons.svelte'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { homeHref } from '$lib/navigation/home-href'
  import { signInSchema } from '$lib/validation/auth'

  const websiteOrigin = (import.meta.env.PUBLIC_WEBSITE_ORIGIN ?? '').replace(/\/$/, '')
  const homeLink = homeHref(websiteOrigin)

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let email = $state('')
  let password = $state('')
  let fieldErrors = $state<{ email?: string; password?: string }>({})

  function validate() {
    const result = signInSchema.safeParse({ email, password })
    if (result.success) {
      fieldErrors = {}
      return true
    }
    const flat = result.error.flatten().fieldErrors
    fieldErrors = {
      email: flat.email?.[0],
      password: flat.password?.[0],
    }
    return false
  }

  const showResend = $derived(
    Boolean(
      data.mailConfigured &&
        ((form && 'emailUnverified' in form && form.emailUnverified) || form?.verificationSent),
    ),
  )
  const resendEmail = $derived(form?.email ?? email)
</script>

<div class="mx-auto max-w-md px-5 pt-10">
  <header class="text-center">
    <a href={homeLink} class="inline-block" aria-label="Eigen home">
      <EigenWordmark heightClass="h-8" />
    </a>
    <p class="text-muted-foreground mt-2 text-xs">Sign in</p>
  </header>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
  >
    <Card.Content class="space-y-4 pt-6">
      {#if data.socialProviders.length > 0}
        <AuthSocialButtons providers={data.socialProviders} />
        {#if data.oauthError}
          <p class="text-destructive text-xs">{data.oauthError}</p>
        {/if}
        <div class="relative py-1">
          <div class="border-t border-black/10" aria-hidden="true"></div>
          <p
            class="text-muted-foreground absolute inset-x-0 top-1/2 -translate-y-1/2 bg-card px-2 text-center text-[10px] mx-auto w-fit"
          >
            or
          </p>
        </div>
      {/if}
      <form
        method="post"
        action="?/signInEmail"
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
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <Label for="password">Password</Label>
            <a
              href={resolve('/forgot-password')}
              class="text-muted-foreground text-[10px] underline-offset-2 hover:underline"
              >Forgot password?</a
            >
          </div>
          <input
            id="password"
            type="password"
            name="password"
            autocomplete="current-password"
            bind:value={password}
            class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          />
          {#if fieldErrors.password}
            <p id="password-error" class="text-destructive text-xs">{fieldErrors.password}</p>
          {/if}
        </div>
        <Button type="submit" class="w-full rounded-[4px]">Sign in</Button>
        {#if form?.verificationSent}
          <p class="text-foreground text-xs">{form.message}</p>
        {:else if form?.message}
          <p class="text-destructive text-xs">{form.message}</p>
        {/if}
      </form>

      {#if showResend && resendEmail}
        <form method="post" action="?/resendVerification" use:enhance class="space-y-2">
          <input type="hidden" name="email" value={resendEmail} />
          <Button type="submit" variant="outline" class="w-full rounded-[4px]"
            >Resend verification email</Button
          >
        </form>
      {/if}

      <p class="text-muted-foreground text-center text-xs">
        Don't have an account?
        <a href={resolve('/signup')} class="text-foreground underline-offset-2 hover:underline">Sign up</a>
      </p>
    </Card.Content>
  </Card.Root>
</div>
