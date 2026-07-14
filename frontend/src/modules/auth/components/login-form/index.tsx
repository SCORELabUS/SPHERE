import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { validateLogin } from '../../utils/validators/login-validators';
import { loginUser } from '../../api/usersApi';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { Link } from 'react-router-dom';
import { fadeUp } from '../auth-layout';
import GoogleLoginButton from '../google-login-button';

export type LoginFormProps = {
  loginField: string;
  password: string;
}

const LoginForm: React.FC = () => {
  const [errors, setErrors] = React.useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const { login } = useAuth();
  const router = useRouter();

  function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const formValues: LoginFormProps = {
      loginField: formData.get('loginField') as string,
      password: formData.get('password') as string,
    }

    const validationErrors = validateLogin(formValues);

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors([]);

    loginUser(formValues)
      .then(async (response: any) => {
        await login(response.token);
        router.push('/');
      })
      .catch((error: Error) => {
        setErrors([error.message]);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <motion.div variants={fadeUp} className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-tp-ink sm:text-4xl">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-tp-steel">
          Sign in to your account to continue
        </p>
      </motion.div>

      {/* SSO first, local login below the divider (UVUS disabled for now) */}
      <GoogleLoginButton />

      <motion.div variants={fadeUp} className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-tp-input-border" />
        <span className="text-xs text-tp-muted">or</span>
        <div className="h-px flex-1 bg-tp-input-border" />
      </motion.div>

      {/* Error alert */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/50">
              {errors.map((error, index) => (
                <p key={index} className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <motion.div variants={fadeUp}>
          <label htmlFor="loginField" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Username or Email
          </label>
          <input
            id="loginField"
            placeholder="Enter your username or email"
            name="loginField"
            autoComplete="username"
            className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all duration-200 placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10 dark:focus:ring-tp-primary/20"
          />
        </motion.div>

        <motion.div variants={fadeUp}>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Password
          </label>
          <input
            id="password"
            placeholder="Enter your password"
            type="password"
            name="password"
            autoComplete="current-password"
            className="h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all duration-200 placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10 dark:focus:ring-tp-primary/20"
          />
        </motion.div>

        <motion.div variants={fadeUp} className="pt-2">
          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="h-11 w-full cursor-pointer rounded-lg bg-tp-primary text-sm font-medium text-white shadow-sm transition-colors duration-200 hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </motion.button>
        </motion.div>
      </form>

      {/* Footer */}
      <motion.p variants={fadeUp} className="mt-8 text-center text-sm text-tp-steel">
        Don&apos;t have an account?{' '}
        <Link
          to="/authentication?view=register"
          className="cursor-pointer font-medium text-tp-primary transition-colors duration-200 hover:text-tp-primary-deep"
        >
          Create one
        </Link>
      </motion.p>
    </div>
  );
};

export default LoginForm;
