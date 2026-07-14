import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { validateRegister } from '../../utils/validators/register-validators';
import { registerUser } from '../../api/usersApi';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { fadeUp } from '../auth-layout';
import GoogleLoginButton from '../google-login-button';

export type RegisterFormProps = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword?: string;
  phone: string;
  address?: string;
};

const inputClass =
  "h-11 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-4 text-sm text-tp-ink outline-none transition-all duration-200 placeholder:text-tp-muted focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/10 dark:focus:ring-tp-primary/20";

const RegisterForm: React.FC = () => {
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const router = useRouter();

  function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const formValues: RegisterFormProps = {
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      username: formData.get('username') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      confirmPassword: formData.get('confirmPassword') as string,
      phone: formData.get('phone') as string,
      address: formData.get('address') as string,
    };

    const validationErrors = validateRegister(formValues);

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors([]);

    registerUser(formValues, setErrors)
      .then(async response => {
        await login(response.token);
        router.push('/');
      })
      .catch(() => {})
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <motion.div variants={fadeUp} className="mb-6">
        <h1 className="font-display text-3xl tracking-tight text-tp-ink sm:text-4xl">
          Create your account
        </h1>
        <p className="mt-2 text-sm text-tp-steel">
          Get started with SPHERE in just a few steps
        </p>
      </motion.div>

      {/* SSO first, local registration below the divider (UVUS disabled for now) */}
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
      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        {/* Name row */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className="mb-1.5 block text-sm font-medium text-tp-ink">
              First name
            </label>
            <input
              id="firstName"
              required
              placeholder="John"
              type="text"
              name="firstName"
              autoComplete="given-name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="lastName" className="mb-1.5 block text-sm font-medium text-tp-ink">
              Last name
            </label>
            <input
              id="lastName"
              required
              placeholder="Doe"
              type="text"
              name="lastName"
              autoComplete="family-name"
              className={inputClass}
            />
          </div>
        </motion.div>

        {/* Username */}
        <motion.div variants={fadeUp}>
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Username
          </label>
          <input
            id="username"
            required
            placeholder="johndoe"
            type="text"
            name="username"
            autoComplete="username"
            className={inputClass}
          />
        </motion.div>

        {/* Email */}
        <motion.div variants={fadeUp}>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Email
          </label>
          <input
            id="email"
            required
            placeholder="john@example.com"
            type="email"
            name="email"
            autoComplete="email"
            className={inputClass}
          />
        </motion.div>

        {/* Password row */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="reg-password" className="mb-1.5 block text-sm font-medium text-tp-ink">
              Password
            </label>
            <input
              id="reg-password"
              required
              placeholder="Min. 6 characters"
              type="password"
              name="password"
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-tp-ink">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              required
              placeholder="Repeat password"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </motion.div>

        {/* Phone */}
        <motion.div variants={fadeUp}>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Phone <span className="text-tp-muted">(optional)</span>
          </label>
          <input
            id="phone"
            placeholder="+1 234 567 890"
            type="text"
            name="phone"
            autoComplete="tel"
            className={inputClass}
          />
        </motion.div>

        {/* Address */}
        <motion.div variants={fadeUp}>
          <label htmlFor="address" className="mb-1.5 block text-sm font-medium text-tp-ink">
            Address <span className="text-tp-muted">(optional)</span>
          </label>
          <input
            id="address"
            placeholder="Your address"
            type="text"
            name="address"
            autoComplete="street-address"
            className={inputClass}
          />
        </motion.div>

        {/* Submit */}
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
                Creating account...
              </span>
            ) : (
              "Create account"
            )}
          </motion.button>
        </motion.div>
      </form>

      {/* Footer */}
      <motion.p variants={fadeUp} className="mt-8 text-center text-sm text-tp-steel">
        Already have an account?{' '}
        <Link
          to="/authentication"
          className="cursor-pointer font-medium text-tp-primary transition-colors duration-200 hover:text-tp-primary-deep"
        >
          Sign in
        </Link>
      </motion.p>
    </div>
  );
};

export default RegisterForm;
