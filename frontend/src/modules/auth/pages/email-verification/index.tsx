import { FormEvent, useEffect, useRef, useState } from 'react';
import { FiAlertCircle, FiCheckCircle, FiLoader, FiMail } from 'react-icons/fi';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth-layout';
import { resendEmailVerification, verifyEmail } from '../../api/usersApi';

type PageState = {
  loginField?: string;
  emailSent?: boolean;
};

export default function EmailVerificationPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const pageState = (location.state ?? {}) as PageState;
  const token = searchParams.get('token');
  const started = useRef(false);
  const [status, setStatus] = useState<'pending' | 'verifying' | 'verified' | 'error'>(
    token ? 'verifying' : 'pending'
  );
  const [message, setMessage] = useState(
    pageState.emailSent === false
      ? 'Your account was created, but the email could not be sent. Request another one below.'
      : 'We sent you a verification link. Open it to activate your account.'
  );
  const [loginField, setLoginField] = useState(pageState.loginField ?? '');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    verifyEmail(token)
      .then(result => {
        setStatus('verified');
        setMessage(result.message);
        window.history.replaceState({}, '', '/verify-email');
      })
      .catch((error: Error) => {
        setStatus('error');
        setMessage(error.message);
      });
  }, [token]);

  async function resend(event: FormEvent) {
    event.preventDefault();
    if (!loginField.trim()) return;

    setResending(true);
    try {
      const result = await resendEmailVerification(loginField);
      setStatus('pending');
      setMessage(result.message);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not request another email');
    } finally {
      setResending(false);
    }
  }

  const icon = status === 'verified'
    ? <FiCheckCircle className="h-7 w-7 text-emerald-500" />
    : status === 'error'
      ? <FiAlertCircle className="h-7 w-7 text-red-500" />
      : status === 'verifying'
        ? <FiLoader className="h-7 w-7 animate-spin text-tp-primary" />
        : <FiMail className="h-7 w-7 text-tp-primary" />;

  return (
    <AuthLayout>
      <div className="flex flex-col">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-tp-surface">
          {icon}
        </div>
        <h1 className="font-display text-3xl tracking-tight text-tp-ink sm:text-4xl">
          {status === 'verified' ? 'Email verified' : status === 'verifying' ? 'Verifying email' : 'Check your inbox'}
        </h1>
        <p className={`mt-3 text-sm leading-6 ${status === 'error' ? 'text-red-500' : 'text-tp-steel'}`} role={status === 'error' ? 'alert' : 'status'}>
          {message}
        </p>

        {status === 'verified' ? (
          <Link
            to="/authentication"
            className="mt-7 flex h-11 cursor-pointer items-center justify-center rounded-lg bg-tp-primary px-5 text-sm font-medium text-tp-on-primary transition-opacity hover:opacity-90"
          >
            Continue to sign in
          </Link>
        ) : status !== 'verifying' ? (
          <form onSubmit={resend} className="mt-7 space-y-3">
            <label htmlFor="verification-login" className="block text-sm font-medium text-tp-ink">
              Email address or username
            </label>
            <input
              id="verification-login"
              value={loginField}
              onChange={event => setLoginField(event.target.value)}
              autoComplete="email"
              className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10"
              placeholder="you@example.com"
            />
            <button
              type="submit"
              disabled={resending || !loginField.trim()}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resending ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiMail className="h-4 w-4" />}
              Send another verification email
            </button>
          </form>
        ) : null}

        {status !== 'verified' && (
          <Link to="/authentication" className="mt-6 cursor-pointer text-center text-sm font-medium text-tp-primary hover:underline">
            Back to sign in
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
