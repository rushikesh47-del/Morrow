import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { api } from './api'
import './Auth.css'

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isRegistering = mode === 'register'

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api('/auth/session', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          register: isRegistering,
          ...(isRegistering ? { name } : {}),
        }),
      })
      await onAuthenticated(result.user)
    } catch (requestError) {
      setError(requestError?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(isRegistering ? 'login' : 'register')
    setError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Morrow">
        <a className="auth-brand" href="#home"><span className="auth-brand-mark"><span /></span>morrow<span>.</span></a>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">A CLEARER WAY TO KEEP IN TOUCH</span>
          <h1>Good work<br />starts with<br /><em>a conversation.</em></h1>
          <p>Your team, your thoughts, all in one thoughtful place.</p>
        </div>
        <div className="auth-story-bottom"><span className="auth-ornament">✳</span><span>Make room for the good stuff.</span><span className="auth-story-line" /></div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><span className="auth-brand-mark"><span /></span>morrow<span>.</span></div>
          <span className="auth-kicker">{isRegistering ? 'YOUR SPACE IS A FEW STEPS AWAY' : 'NICE TO HAVE YOU BACK'}</span>
          <h2>{isRegistering ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-subtitle">{isRegistering ? 'A calmer place to stay close to your team.' : 'Sign in to pick up where your team left off.'}</p>

          <form className="auth-form" onSubmit={submit}>
            {isRegistering && <label className="auth-field"><span>Your name</span><span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" name="name" placeholder="Jamie Morgan" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={60} required /></span></label>}
            <label className="auth-field"><span>Email address</span><span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" name="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></span></label>
            <label className="auth-field"><span>Password</span><span className="auth-input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={isRegistering ? 'new-password' : 'current-password'} name="password" placeholder={isRegistering ? 'At least 8 characters' : 'Enter your password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={isRegistering ? 8 : 1} maxLength={72} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : isRegistering ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></button>
          </form>

          <p className="auth-switch">{isRegistering ? 'Already have an account?' : 'New to Morrow?'} <button type="button" onClick={switchMode}>{isRegistering ? 'Sign in' : 'Create an account'}</button></p>
          <p className="auth-privacy">Your account and messages are stored securely in your workspace.</p>
        </div>
        <span className="auth-copyright">MORROW CHAT <span>·</span> MADE FOR THE EVERYDAY</span>
      </section>
    </main>
  )
}