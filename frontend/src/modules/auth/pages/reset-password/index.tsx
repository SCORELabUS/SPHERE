import { FormEvent, useState } from 'react';
import { FiAlertCircle, FiCheckCircle, FiLoader, FiLock } from 'react-icons/fi';
import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth-layout';
import { resetPassword } from '../../api/usersApi';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'form' | 'success' | 'error'>(token ? 'form' : 'error');
  const [errors, setErrors] = useState<string[]>(
    token ? [] : ['This password reset link is invalid or has expired.']
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const validationErrors: string[] = [];
    if (password.length < 8) validationErrors.push('The password must have at least 8 characters');
    if (/\s/.test(password)) validationErrors.push('No spaces are allowed in the password');
    if (password !== confirmPassword) validationErrors.push('Passwords do not match');

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setErrors([]);
    try {
      await resetPassword(token, password);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrors([error instanceof Error ? error.message : 'Could not reset your password']);
    } finally {
      setSubmitting(false);
    }
  }

  const icon = status === 'success'
    ? <FiCheckCircle className="h-7 w-7 text-emerald-500" />
    : status === 'error'
      ? <FiAlertCircle className="h-7 w-7 text-red-500" />
      : <FiLock className="h-7 w-7 text-tp-primary" />;

  return (
    <AuthLayout>
      <div className="flex flex-col">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-tp-surface">
          {icon}
        </div>
        <h1 className="font-display text-3xl tracking-tight text-tp-ink sm:text-4xl">
          {status === 'success' ? 'Password reset' : 'Reset your password'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-tp-steel">
          {status === 'success'
            ? 'Your password has been reset. You can now sign in with your new password.'
            : 'Choose a new password for your account.'}
        </p>

        {errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/50">
            {errors.map((error, index) => (
              <p key={index} className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            ))}
          </div>
        )}

        {status === 'form' && (
          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-tp-ink">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="new-password"
                className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                placeholder="Enter your new password"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-tp-ink">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
                placeholder="Re-enter your new password"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !password || !confirmPassword}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-tp-primary px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <FiLoader className="h-4 w-4 animate-spin" /> : null}
              Reset password
            </button>
          </form>
        )}

        {status === 'success' ? (
          <Link
            to="/authentication"
            className="mt-7 flex h-11 cursor-pointer items-center justify-center rounded-lg bg-tp-primary px-5 text-sm font-medium text-tp-on-primary transition-opacity hover:opacity-90"
          >
            Continue to sign in
          </Link>
        ) : (
          <Link to="/forgot-password" className="mt-6 cursor-pointer text-center text-sm font-medium text-tp-primary hover:underline">
            Request a new reset link
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
