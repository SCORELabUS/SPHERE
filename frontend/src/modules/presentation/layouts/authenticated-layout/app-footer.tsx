import { useRouter } from '../../../core/hooks/useRouter';

const FOOTER_COLUMNS = [
  {
    title: 'Platform',
    links: [
      { label: 'Pricings', to: '/pricings' },
      { label: 'Collections', to: '/collections' },
      { label: 'Pricing2Yaml Editor', to: '/editor' },
    ],
  },
  {
    title: 'Research',
    links: [
      { label: 'Publications', to: '/research' },
      { label: 'Team', to: '/team' },
      {
        label: 'SCORE Lab',
        to: 'https://score.us.es',
        external: true,
      },
    ],
  },
  {
    title: 'Tools',
    links: [
      { label: 'HARVEY', to: '/harvey' },
      { label: 'PRIME', to: '/pricings' },
      { label: 'iPricing Editor', to: '/editor' },
      {
        label: 'SPACE',
        to: 'https://sphere-docs.vercel.app/docs/2.0.1/api/space/introduction',
        external: true,
      },
      {
        label: 'Pricing2Yaml',
        to: 'https://sphere-docs.vercel.app/docs/2.0.1/api/pricing-description-languages/Pricing2Yaml/the-pricing2yaml-syntax',
        external: true,
      },
      { label: 'A-MINT', to: '/harvey' },
    ],
  },
];

const INSTITUTIONAL_LINKS = [
  { label: 'ISA Group', to: 'https://www.isa.us.es/3.0/' },
  { label: 'Universidad de Sevilla', to: 'https://www.us.es' },
];

export default function AppFooter() {
  const router = useRouter();

  const handleNavigate = (to: string, external?: boolean) => {
    if (external) {
      window.open(to, '_blank', 'noopener,noreferrer');
    } else {
      router.push(to);
    }
  };

  return (
    <footer className="bg-tp-footer-cream">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-10 md:px-10 md:py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          {/* Brand column */}
          <div className="md:col-span-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-tp-on-cream/60">
              SPHERE
            </p>
            <h4 className="mt-3 font-display text-3xl leading-[0.95] text-tp-on-cream md:text-4xl">
              SaaS Pricing Holistic Evaluation and Regulation Environment
            </h4>
            <p className="mt-4 max-w-[28rem] text-sm leading-relaxed text-tp-on-cream/70">
              Unified pricing operations for product, growth, and engineering teams building
              resilient monetization systems.
            </p>
          </div>

          {/* Link columns */}
          <div className="md:col-span-7 md:pl-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {FOOTER_COLUMNS.map(column => (
                <div key={column.title}>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-tp-on-cream/60">
                    {column.title}
                  </p>
                  <div className="mt-3 flex flex-col gap-2 text-sm text-tp-on-cream/75">
                    {column.links.map(link => (
                      <button
                        key={link.label}
                        type="button"
                        onClick={() => handleNavigate(link.to, link.external)}
                        className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-tp-on-cream"
                      >
                        {link.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col gap-3 border-t border-tp-on-cream/15 pt-6 text-xs text-tp-on-cream/60 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} SPHERE. Research infrastructure for SaaS pricing intelligence.</p>
          <div className="flex items-center gap-3">
            {INSTITUTIONAL_LINKS.map(link => (
              <button
                key={link.label}
                type="button"
                onClick={() => handleNavigate(link.to, true)}
                className="cursor-pointer rounded-full border border-tp-on-cream/15 bg-tp-on-cream/10 px-3 py-1 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-tp-on-cream"
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
