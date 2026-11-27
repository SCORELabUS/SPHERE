import { Helmet } from 'react-helmet-async';

interface RobotsMetaProps {
  /** Ask search engines not to follow the links of the page either. */
  nofollow?: boolean;
  /** No Referer leaves the page (so a token in its URL stays on it). */
  noReferrer?: boolean;
}

/**
 * Keeps a page out of search engines. `index.html` says `index, follow`; this
 * adds a stricter `robots`, and engines apply the most restrictive one.
 */
export default function RobotsMeta({ nofollow = false, noReferrer = false }: RobotsMetaProps) {
  return (
    <Helmet>
      <meta name="robots" content={nofollow ? 'noindex, nofollow' : 'noindex'} />
      {noReferrer && <meta name="referrer" content="no-referrer" />}
    </Helmet>
  );
}
