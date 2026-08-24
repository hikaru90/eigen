import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '$lib/server/auth'
import { getSafeErrorMessage } from '$lib/server/auth-form-errors'
import { resetPasswordSchema } from '$lib/validation/auth'

export const load: PageServerLoad = (event) => {
  if (event.locals.user) {
    throw redirect(302, '/capture')
  }
  const token = event.url.searchParams.get('token')?.trim() || null
  const error = event.url.searchParams.get('error')?.trim() || null
  return { token, error }
}

export const actions: Actions = {
  resetPassword: async (event) => {
    const formData = await event.request.formData()
    const password = formData.get('password')?.toString() ?? ''
    const token = formData.get('token')?.toString() ?? ''

    const validation = resetPasswordSchema.safeParse({ password, token })
    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors
      const message =
        fieldErrors.password?.[0] || fieldErrors.token?.[0] || 'Could not reset password'
      return fail(400, { message })
    }

    try {
      await auth.api.resetPassword({
        body: {
          newPassword: validation.data.password,
          token: validation.data.token,
        },
      })
    } catch (error) {
      const safeMessage = getSafeErrorMessage(error, 'Could not reset password')
      return fail(400, { message: safeMessage })
    }

    return {
      success: true,
      message: 'Your password has been reset. You can sign in with the new password.',
    }
  },
}
