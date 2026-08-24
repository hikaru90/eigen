import type { Actions, PageServerLoad } from './$types'
import { error, fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { parseSignupPlanParam } from '$lib/auth/signup-plan'
import { auth } from '$lib/server/auth'
import { getSafeErrorMessage } from '$lib/server/auth-form-errors'
import { listEnabledSocialProviderIds } from '$lib/server/auth-social'
import { isUseSendMailConfigured } from '$lib/server/email/usesend'
import { resendVerificationSchema, signUpSchema } from '$lib/validation/auth'

export const load: PageServerLoad = (event) => {
  if (event.locals.user) {
    throw redirect(302, '/capture')
  }

  const rawPlan = event.url.searchParams.get('plan')
  if (rawPlan !== null && parseSignupPlanParam(rawPlan) === null) {
    throw error(400, 'Invalid plan parameter. Use managed or self-hosted.')
  }

  const plan = parseSignupPlanParam(rawPlan)

  return {
    socialProviders: listEnabledSocialProviderIds(env),
    plan,
    emailVerificationRequired: isUseSendMailConfigured(env),
  }
}

export const actions: Actions = {
  signUpEmail: async (event) => {
    const formData = await event.request.formData()
    const firstName = formData.get('firstName')?.toString()?.trim() ?? ''
    const lastName = formData.get('lastName')?.toString()?.trim() ?? ''
    const email = formData.get('email')?.toString() ?? ''
    const password = formData.get('password')?.toString() ?? ''
    const acceptTerms = formData.get('acceptTerms')

    const validation = signUpSchema.safeParse({
      firstName,
      lastName: lastName || undefined,
      email,
      password,
      acceptTerms,
    })
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors
      const message =
        fieldErrors.firstName?.[0] ||
        fieldErrors.email?.[0] ||
        fieldErrors.password?.[0] ||
        fieldErrors.acceptTerms?.[0] ||
        'Registration failed'
      return fail(400, { message })
    }

    const emailVerificationRequired = isUseSendMailConfigured(env)
    const data = validation.data

    // Declared as user.additionalFields (input: true) in auth.ts, so Better Auth persists them
    // from the signup body; its signUpEmail body type only models the core fields, hence a record.
    const additionalUserFields: Record<string, string> = { firstName: data.firstName }
    if (data.lastName) additionalUserFields.lastName = data.lastName

    try {
      await auth.api.signUpEmail({
        body: {
          // Better Auth requires a single display name; first/last are stored as additional fields.
          name: data.lastName ? `${data.firstName} ${data.lastName}` : data.firstName,
          email: data.email,
          password: data.password,
          ...additionalUserFields,
          callbackURL: '/capture',
        },
      })
    } catch (error) {
      const safeMessage = getSafeErrorMessage(error, 'Registration failed')
      return fail(400, { message: safeMessage })
    }

    if (emailVerificationRequired) {
      return {
        checkEmail: true,
        email: data.email,
        message: 'Check your email for a verification link before signing in.',
      }
    }

    throw redirect(302, '/capture')
  },

  resendVerification: async (event) => {
    const formData = await event.request.formData()
    const email = formData.get('email')?.toString() ?? ''

    const validation = resendVerificationSchema.safeParse({ email })
    if (!validation.success) {
      const message = validation.error.flatten().fieldErrors.email?.[0] || 'Invalid email address'
      return fail(400, { message, checkEmail: true, email })
    }

    if (!isUseSendMailConfigured(env)) {
      return fail(503, {
        message: 'Verification email is not configured on this server.',
        checkEmail: true,
        email: validation.data.email,
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
      return fail(400, {
        message: safeMessage,
        checkEmail: true,
        email: validation.data.email,
      })
    }

    return {
      checkEmail: true,
      email: validation.data.email,
      verificationSent: true,
      message: 'If this email needs verification, a new verification link is on its way.',
    }
  },
}
