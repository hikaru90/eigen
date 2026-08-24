import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { auth } from '$lib/server/auth'
import { getSafeErrorMessage } from '$lib/server/auth-form-errors'
import { isUseSendMailConfigured } from '$lib/server/email/usesend'
import { forgotPasswordSchema } from '$lib/validation/auth'

export const load: PageServerLoad = (event) => {
  if (event.locals.user) {
    throw redirect(302, '/capture')
  }
  return {
    mailConfigured: isUseSendMailConfigured(env),
  }
}

export const actions: Actions = {
  requestReset: async (event) => {
    const formData = await event.request.formData()
    const email = formData.get('email')?.toString() ?? ''

    const validation = forgotPasswordSchema.safeParse({ email })
    if (!validation.success) {
      const message = validation.error.flatten().fieldErrors.email?.[0] || 'Invalid email address'
      return fail(400, { message })
    }

    if (!isUseSendMailConfigured(env)) {
      return fail(503, {
        message: 'Password reset email is not configured on this server.',
      })
    }

    try {
      await auth.api.requestPasswordReset({
        body: {
          email: validation.data.email,
          redirectTo: '/reset-password',
        },
      })
    } catch (error) {
      const safeMessage = getSafeErrorMessage(error, 'Could not send reset email')
      return fail(400, { message: safeMessage })
    }

    return {
      checkEmail: true,
      message: 'If this email exists in our system, check your email for a reset link.',
    }
  },
}
