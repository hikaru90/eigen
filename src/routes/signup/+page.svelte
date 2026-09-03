<script lang="ts">
  import type { ActionData } from './$types'
  import type { PageData } from './$types'
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { signupPlanSubtitle } from '$lib/auth/signup-plan'
  import AuthSocialButtons from '$lib/components/auth-social-buttons.svelte'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { websiteLegalUrl } from '$lib/legal/website-legal-urls'
  import { signUpSchema } from '$lib/validation/auth'

  const websiteOrigin = (import.meta.env.PUBLIC_WEBSITE_ORIGIN ?? '').replace(/\/$/, '')
  const termsHref = websiteLegalUrl('terms', websiteOrigin)
  const privacyHref = websiteLegalUrl('privacy', websiteOrigin)
  const imprintHref = websiteLegalUrl('imprint', websiteOrigin)

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let firstName = $state('')
  let lastName = $state('')
  let email = $state('')
  let password = $state('')
  let acceptTerms = $state(false)
  let fieldErrors = $state<{
    firstName?: string
    lastName?: string
    email?: string
    password?: string
    acceptTerms?: string
  }>({})

  function validate() {
    const result = signUpSchema.safeParse({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      email,
      password,
      acceptTerms: acceptTerms ? 'on' : undefined,
    })
    if (result.success) {
      fieldErrors = {}
      return true
    }
    const flat = result.error.flatten().fieldErrors
    fieldErrors = {
      firstName: flat.firstName?.[0],
      lastName: flat.lastName?.[0],
      email: flat.email?.[0],
      password: flat.password?.[0],
      acceptTerms: flat.acceptTerms?.[0],
    }
    return false
  }
</script>

<div class="mx-auto max-w-md px-5 pt-10">
  <p class="mb-4">
    {#if websiteOrigin}
      <a
        href={websiteOrigin}
        rel="external"
        class="text-muted-foreground text-xs underline-offset-2 hover:underline"
      >
        ← Back to home
      </a>
    {:else}
      <a
        href={resolve('/')}
        class="text-muted-foreground text-xs underline-offset-2 hover:underline"
      >
        ← Back to home
      </a>
    {/if}
  </p>
  <header class="text-center">
    {#if websiteOrigin}
      <a href={websiteOrigin} rel="external" class="inline-block">
        <EigenWordmark heightClass="h-8" />
      </a>
    {:else}
      <a href={resolve('/')} class="inline-block">
        <EigenWordmark heightClass="h-8" />
      </a>
    {/if}
    <p class="text-muted-foreground mt-2 text-xs">Create an account</p>
    {#if data.plan}
      <p class="text-muted-foreground mt-1 text-xs">{signupPlanSubtitle(data.plan)}</p>
    {/if}
  </header>

  <Card.Root
    class="ring-0 shadow-[4px_4px_0_0_rgb(17_17_17_/_0.08)] mt-8 border border-black/10 bg-card"
  >
    <Card.Content class="space-y-4 pt-6">
      {#if form?.checkEmail}
        <p class="text-foreground text-xs">
          {form.message ?? 'Check your email for a verification link before signing in.'}
        </p>
        {#if form.email && data.emailVerificationRequired}
          <form method="post" action="?/resendVerification" use:enhance class="space-y-2">
            <input type="hidden" name="email" value={form.email} />
            <Button type="submit" variant="outline" class="w-full rounded-[4px]"
              >Resend verification email</Button
            >
          </form>
        {/if}
        <p class="text-muted-foreground text-center text-xs">
          <a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline"
            >Sign in</a
          >
        </p>
      {:else}
        <form
          method="post"
          action="?/signUpEmail"
          use:enhance
          class="space-y-4"
          onsubmit={(e) => {
            if (!validate()) e.preventDefault()
          }}
        >
          <div class="space-y-1">
            <label class="flex items-start gap-2 text-xs leading-snug" for="accept-terms">
              <input
                id="accept-terms"
                type="checkbox"
                name="acceptTerms"
                value="on"
                bind:checked={acceptTerms}
                class="mt-0.5 size-3.5 shrink-0"
                aria-describedby={fieldErrors.acceptTerms ? 'accept-terms-error' : undefined}
              />
              <span>
                I accept the
                <a
                  href={termsHref}
                  class="text-foreground underline underline-offset-2"
                  target="_blank"
                  rel="noopener noreferrer external"
                >
                  Terms of Service (AGB)
                </a>
                and
                <a
                  href={privacyHref}
                  class="text-foreground underline underline-offset-2"
                  target="_blank"
                  rel="noopener noreferrer external"
                >
                  Privacy Policy
                </a>
                , including receiving emails related to my account and the Service.
                <span class="text-muted-foreground">
                  (
                  <a
                    href={imprintHref}
                    class="underline underline-offset-2"
                    target="_blank"
                    rel="noopener noreferrer external"
                  >
                    Imprint
                  </a>
                  )
                </span>
              </span>
            </label>
            {#if fieldErrors.acceptTerms}
              <p id="accept-terms-error" class="text-destructive text-xs">
                {fieldErrors.acceptTerms}
              </p>
            {/if}
          </div>

          {#if data.socialProviders.length > 0}
            <AuthSocialButtons providers={data.socialProviders} disabled={!acceptTerms} />
            {#if !acceptTerms}
              <p class="text-muted-foreground text-[10px]">
                Accept the Terms of Service (AGB) above before continuing with a social provider.
              </p>
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

          <div class="space-y-1">
            <Label for="firstName">First name</Label>
            <input
              id="firstName"
              type="text"
              name="firstName"
              autocomplete="given-name"
              bind:value={firstName}
              class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-describedby={fieldErrors.firstName ? 'first-name-error' : undefined}
            />
            {#if fieldErrors.firstName}
              <p id="first-name-error" class="text-destructive text-xs">{fieldErrors.firstName}</p>
            {/if}
          </div>
          <div class="space-y-1">
            <Label for="lastName"
              >Last name <span class="text-muted-foreground">(optional)</span></Label
            >
            <input
              id="lastName"
              type="text"
              name="lastName"
              autocomplete="family-name"
              bind:value={lastName}
              class="border-input bg-card text-foreground h-9 w-full border px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-describedby={fieldErrors.lastName ? 'last-name-error' : undefined}
            />
            {#if fieldErrors.lastName}
              <p id="last-name-error" class="text-destructive text-xs">{fieldErrors.lastName}</p>
            {/if}
          </div>
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
            <Label for="password">Password</Label>
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
          <Button type="submit" class="w-full rounded-[4px]">Create account</Button>
          {#if form?.message}
            <p class="text-destructive text-xs">{form.message}</p>
          {/if}
        </form>

        <p class="text-muted-foreground text-center text-xs">
          Already have an account?
          <a href={resolve('/login')} class="text-foreground underline-offset-2 hover:underline"
            >Sign in</a
          >
        </p>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
