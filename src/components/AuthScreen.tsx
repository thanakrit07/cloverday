import { useState } from 'react'
import type { FormEvent } from 'react'
import { AuthLayout, authInputClass, authLinkButtonClass, authPrimaryButtonClass } from './AuthLayout'
import { supabase } from '../lib/supabase'

type Mode = 'sign-in' | 'sign-up' | 'forgot-password'

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setNotice(null)

    if (mode === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else if (mode === 'forgot-password') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (error) {
        setError(error.message)
      } else {
        setNotice('If that email has an account, a reset link has been sent.')
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        // Supabase signUp() never reveals whether an email is already registered
        // (anti-enumeration): a genuinely new signup gets a non-empty
        // `identities` array, an existing-and-confirmed email gets an empty
        // one with no error and no new email sent. Without this check the
        // user is told to "check your email" for a mail that never arrives.
        setError('This email already has an account — use "Sign in" instead.')
      } else {
        setNotice('Check your email to confirm your account, then sign in.')
      }
    }
    setSubmitting(false)
  }

  const subtitle =
    mode === 'sign-in'
      ? 'Sign in to continue.'
      : mode === 'sign-up'
        ? 'Create an account.'
        : "Enter your email and we'll send a reset link."

  return (
    <AuthLayout title="Cloversky" subtitle={subtitle} onSubmit={handleSubmit}>
      <label className="block space-y-1">
        <span className="text-sm text-foreground/80">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInputClass}
        />
      </label>

      {mode !== 'forgot-password' && (
        <label className="block space-y-1">
          <span className="text-sm text-foreground/80">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </label>
      )}

      {mode === 'sign-in' && (
        <button
          type="button"
          onClick={() => {
            setMode('forgot-password')
            setError(null)
            setNotice(null)
          }}
          className="block text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Forgot password?
        </button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-good">{notice}</p>}

      <button type="submit" disabled={submitting} className={authPrimaryButtonClass}>
        {submitting
          ? 'Please wait…'
          : mode === 'sign-in'
            ? 'Sign in'
            : mode === 'sign-up'
              ? 'Sign up'
              : 'Send reset link'}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
          setError(null)
          setNotice(null)
        }}
        className={authLinkButtonClass}
      >
        {mode === 'sign-in' && "Don't have an account? Sign up"}
        {mode === 'sign-up' && 'Already have an account? Sign in'}
        {mode === 'forgot-password' && 'Back to sign in'}
      </button>
    </AuthLayout>
  )
}
