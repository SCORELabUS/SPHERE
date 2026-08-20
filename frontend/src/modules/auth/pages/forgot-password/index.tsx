import { FormEvent, useState } from 'react';
import { FiLoader, FiMail } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import AuthLayout from '../../components/auth-layout';
import { forgotPassword } from '../../api/usersApi';

export default function ForgotPasswordPage() {
  const [loginField, setLoginField] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(
    'Enter your email address or username and we will send you a link to reset your password.'
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!loginField.trim()) return;

    setSubmitting(true);
    try {
      const result = await forgotPassword(loginField);
      setSent(true);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not request a password reset email');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-tp-surface">
          <FiMail className="h-7 w-7 text-tp-primary" />
        </div>
        <h1 className="font-display text-3xl tracking-tight text-tp-ink sm:text-4xl">
          {sent ? 'Check your inbox' : 'Forgot your password?'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-tp-steel" role="status">
          {message}
        </p>

        {!sent && (
          <form onSubmit={handleSubmit} className="mt-7 space-y-3">
            <label htmlFor="forgot-login" className="block text-sm font-medium text-tp-ink">
              Email address or username
            </label>
            <input
              id="forgot-login"
              value={loginField}
              onChange={event => setLoginField(event.target.value)}
              autoComplete="username"
              className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
              placeholder="you@example.com"
            />
            <button
              type="submit"
              disabled={submitting || !loginField.trim()}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-tp-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiMail className="h-4 w-4" />}
              Send reset link
            </button>
          </form>
        )}

        <Link to="/authentication" className="mt-6 cursor-pointer text-center text-sm font-medium text-tp-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
