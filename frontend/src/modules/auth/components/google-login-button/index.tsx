import { motion } from 'framer-motion';
import { fadeUp } from '../auth-layout';

const SSO_INITIATE_URL = `${import.meta.env.VITE_API_URL}/users/auth/sso/google/initiate`;

/**
 * "Continue with Google" button (OAuth2/OIDC). Plain anchor with a full page
 * navigation, like the UVUS button: the OAuth flow relies on browser redirects.
 * Rendered right below UvusLoginButton.
 */
export default function GoogleLoginButton() {
  return (
    <motion.div variants={fadeUp} className="mt-3">
      <a
        href={SSO_INITIATE_URL}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-tp-input-border bg-tp-input-bg text-sm font-medium text-tp-ink transition-colors duration-200 hover:border-tp-primary"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.28a7.22 7.22 0 0 1 0-4.56V6.61H1.27a12.01 12.01 0 0 0 0 10.78l4.01-3.11Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
          />
        </svg>
        Continue with Google
      </a>
    </motion.div>
  );
}
