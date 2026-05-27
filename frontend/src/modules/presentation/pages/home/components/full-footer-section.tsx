export default function FullFooterSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <footer className="relative z-[5] w-full p-0 m-0">
      <div className="bg-[#111f36] px-6 py-10 md:px-10 md:py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/60">SPHERE</p>
            <h4 className="mt-3 [font-family:'Clash_Display','Geist',sans-serif] text-3xl leading-[0.95] text-white md:text-4xl">
              SaaS Pricing Holistic Evaluation and Regulation Environment
            </h4>
            <p className="mt-4 max-w-[28rem] text-sm leading-relaxed text-white/70">
              Unified pricing operations for product, growth, and engineering teams building
              resilient monetization systems.
            </p>
          </div>

          <div className="md:col-span-7 md:pl-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">Platform</p>
                <div className="mt-3 flex flex-col gap-2 text-sm text-white/75">
                  <button
                    type="button"
                    onClick={() => onNavigate('/pricings')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Pricings
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/collections')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Collections
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/editor')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Pricing2Yaml Editor
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">Research</p>
                <div className="mt-3 flex flex-col gap-2 text-sm text-white/75">
                  <button
                    type="button"
                    onClick={() => onNavigate('/research')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Publications
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/team')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Team
                  </button>
                  <a
                    href="https://score.us.es"
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    SCORE Lab
                  </a>
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">Tools</p>
                <div className="mt-3 flex flex-col gap-2 text-sm text-white/75">
                  <button
                    type="button"
                    onClick={() => onNavigate('/editor')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    iPricing Editor
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        'https://sphere-docs.vercel.app/docs/2.0.1/api/space/introduction',
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    SPACE
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/harvey')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    HARVEY
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/harvey')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    A-MINT
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(
                        'https://sphere-docs.vercel.app/docs/2.0.1/api/pricing-description-languages/Pricing2Yaml/the-pricing2yaml-syntax',
                        '_blank',
                        'noopener,noreferrer'
                      )}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    Pricing2Yaml
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/pricings')}
                    className="cursor-pointer text-left transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
                  >
                    PRIME
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/15 pt-6 text-xs text-white/60 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} SPHERE. Research infrastructure for SaaS pricing
            intelligence.
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://www.isa.us.es/3.0/"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/15 bg-white/10 px-3 py-1 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
            >
              ISA Group
            </a>
            <a
              href="https://www.us.es"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/15 bg-white/10 px-3 py-1 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white"
            >
              Universidad de Sevilla
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
