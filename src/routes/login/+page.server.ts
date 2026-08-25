import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import { env } from '$lib/server/env/private-env'
import { auth } from '$lib/server/auth'
import { getSafeErrorMessage } from '$lib/server/auth-form-errors'
import { listEnabledSocialProviderIds } from '$lib/server/auth-social'
import { isUseSendMailConfigured } from '$lib/server/email/usesend'
import { resendVerificationSchema, signInSchema } from '$lib/validation/auth'

function isEmailNotVerifiedError(error: unknown): boolean {
  return getSafeErrorMessage(error, '') === 'Email not verified'
}

export const load: PageServerLoad = (event) => {
  if (event.locals.user) {
    throw redirect(302, '/capture')
  }
  const oauthError = event.url.searchParams.get('error')
  return {
    socialProviders: listEnabledSocialProviderIds(env),
    oauthError: oauthError?.trim() || null,
    mailConfigured: isUseSendMailConfigured(env),
  }
}

export const actions: Actions = {
  signInEmail: async (event) => {
    const formData = await event.request.formData()
    const email = formData.get('email')?.toString() ?? ''
    const password = formData.get('password')?.toString() ?? ''

    const validation = signInSchema.safeParse({ email, password })
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors
      const message = fieldErrors.email?.[0] || fieldErrors.password?.[0] || 'Invalid credentials'
      return fail(400, { message })
    }

    try {
      await auth.api.signInEmail({
        body: {
          email: validation.data.email,
          password: validation.data.password,
          rememberMe: true,
          callbackURL: '/capture',
        },
      })
    } catch (error) {
      if (isEmailNotVerifiedError(error)) {
        return fail(403, {
          message:
            'Email not verified. Check your inbox for a verification link (a new one was sent if mail is configured).',
          emailUnverified: true,
          email: validation.data.email,
        })
      }
      const safeMessage = getSafeErrorMessage(error, 'Sign in failed')
      return fail(401, { message: safeMessage })
    }

    throw redirect(302, '/capture')
  },

  resendVerification: async (event) => {
    const formData = await event.request.formData()
    const email = formData.get('email')?.toString() ?? ''

    const validation = resendVerificationSchema.safeParse({ email })
    if (!validation.success) {
      const message = validation.error.flatten().fieldErrors.email?.[0] || 'Invalid email address'
      return fail(400, { message })
    }

    if (!isUseSendMailConfigured(env)) {
      return fail(503, {
        message: 'Verification email is not configured on this server.',
      })
    }

    try {
      await auth.api.sendVerificationEmail({
        body: {
          email: validation.data.email,
          callbackURL: '/capture',
        },
      })
    } catch (error) {
      const safeMessage = getSafeErrorMessage(error, 'Could not send verification email')
      return fail(400, { message: safeMessage })
    }

    return {
      verificationSent: true,
      email: validation.data.email,
      message: 'If this email needs verification, a new verification link is on its way.',
    }
  },
}
