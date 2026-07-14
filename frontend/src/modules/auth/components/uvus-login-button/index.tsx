import { motion } from 'framer-motion';
import { fadeUp } from '../auth-layout';

const SSO_INITIATE_URL = `${import.meta.env.VITE_API_URL}/users/auth/sso/us/initiate`;

/**
 * "Continue with UVUS" button (Universidad de Sevilla SSO). Plain anchor with a full
 * page navigation: the CAS flow relies on browser redirects, so no fetch here.
 * The "or" divider between SSO and the local form lives in the auth forms.
 */
export default function UvusLoginButton() {
  return (
    <motion.div variants={fadeUp}>
      <a
        href={SSO_INITIATE_URL}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-tp-input-border bg-tp-input-bg text-sm font-medium text-tp-ink transition-colors duration-200 hover:border-tp-primary"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Continue with UVUS
      </a>
    </motion.div>
  );
}
