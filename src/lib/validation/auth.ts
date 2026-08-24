import { z } from 'zod'

export const TERMS_ACCEPTANCE_ERROR =
  'You must accept the Terms of Service (AGB) to create an account'

/** Form checkbox: checked posts `"on"`; unchecked is omitted. */
const acceptTermsSchema = z.preprocess(
  (value) => value === 'on' || value === true || value === 'true',
  z.literal(true, { error: TERMS_ACCEPTANCE_ERROR }),
)

export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const signUpSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  acceptTerms: acceptTermsSchema,
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  token: z.string().min(1, 'Reset token is required'),
})

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export type SignInData = z.infer<typeof signInSchema>
export type SignUpData = z.infer<typeof signUpSchema>
export type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordData = z.infer<typeof resetPasswordSchema>
export type ResendVerificationData = z.infer<typeof resendVerificationSchema>
