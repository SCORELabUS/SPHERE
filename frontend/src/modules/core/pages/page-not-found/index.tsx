import { Helmet } from 'react-helmet-async';
import { FiHome } from 'react-icons/fi';

import RouterLink from '../../components/router-link';
import Logo404 from '../../components/404-logo';

export default function NotFoundPage() {
  return (
    <>
      <Helmet>
        <title> 404 Page Not Found </title>
      </Helmet>

      <div className="mx-auto max-w-7xl px-4">
        <div className="mx-auto flex min-h-screen max-w-120 flex-col items-center justify-center py-12 text-center">
          <h1 className="mb-3 text-3xl font-semibold leading-tight text-sphere-grey-900">
            Sorry, page not found!
          </h1>

          <p className="text-sphere-grey-600">
            Sorry, we couldn’t find the page you’re looking for. Perhaps you’ve mistyped the URL? Be
            sure to check your spelling.
          </p>

          <div className="mx-auto mb-16 mt-10 h-65 sm:mb-20 sm:mt-20">
            <Logo404 />
          </div>

          <RouterLink
            href="/"
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-tp-primary px-5 py-3 text-sm font-semibold text-white transition-colors"
          >
            <FiHome className="h-4 w-4" />
            Return to Home
          </RouterLink>
        </div>
      </div>
    </>
  );
}
