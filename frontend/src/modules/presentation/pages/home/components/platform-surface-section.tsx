import RevealBlock from './reveal-block';

export default function PlatformSurfaceSection({
  onResearch,
  onEditor,
}: {
  onResearch: () => void;
  onEditor: () => void;
}) {
  return (
    <section id="platform-surface" className="py-20 md:py-28 lg:py-32">
      <RevealBlock className="mb-8">
        <span className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#475467]">
          Centralized Platform
        </span>
      </RevealBlock>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <RevealBlock className="md:col-span-8" delay={90}>
          <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="flex h-full flex-col justify-between rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-9">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">
                  Why SPHERE?
                </p>
                <h2 className="mt-4 text-3xl font-medium leading-tight text-[#111827] md:text-5xl">
                  One platform to design, analyze, and deliver pricings.
                </h2>
              </div>
              <p className="mt-8 max-w-[36rem] text-sm leading-relaxed text-[#475467] md:text-base">
                Author variants, compare constraints, and forecast margin dynamics before publish.
                Every branch remains reproducible for review and rollback.
              </p>
            </article>
          </div>
        </RevealBlock>

        <RevealBlock className="md:col-span-4" delay={160}>
          <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-8">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">
                Decision Latency
              </p>
              <p className="mt-5 text-5xl font-medium leading-none text-[#111827]">-75%</p>
              <p className="mt-4 text-sm leading-relaxed text-[#475467]">
                Faster pricing updates after introducing pricing-driven self-adaptation.
              </p>
            </article>
          </div>
        </RevealBlock>

        <RevealBlock className="md:col-span-4" delay={210}>
          <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-8">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">
                Research Engine
              </p>
              <p className="mt-4 text-sm leading-relaxed text-[#475467]">
                Pull benchmark data from published pricing studies and map shifts in packaging
                trends by segment.
              </p>
              <div className="mt-8 h-px w-full bg-black/10" />
              <button
                type="button"
                onClick={onResearch}
                className="mt-4 inline-flex cursor-pointer items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#1d2939] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:translate-x-1"
              >
                Open research ↗
              </button>
            </article>
          </div>
        </RevealBlock>

        <RevealBlock className="md:col-span-8" delay={260}>
          <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-9">
              <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                <div className="max-w-[36rem]">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">
                    Lead the market
                  </p>
                  <h3 className="mt-4 text-2xl font-medium leading-tight text-[#111827] md:text-4xl">
                    Understand competitors’ pricing strategies and respond with confidence.
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onEditor}
                  className={`group inline-flex w-36 cursor-pointer items-center justify-evenly gap-3 rounded-full border px-3 py-3 text-sm font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] 'border-black/10 bg-[#0f172a] text-white hover:bg-[#1e293b]`}
                >
                  <span className='text-left'>Pricings</span>
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-[1px] group-hover:translate-x-1 group-hover:scale-105 bg-white/15 text-white}`}
                  >
                    ↗
                  </span>
                </button>
              </div>
            </article>
          </div>
        </RevealBlock>
      </div>
    </section>
  );
}
