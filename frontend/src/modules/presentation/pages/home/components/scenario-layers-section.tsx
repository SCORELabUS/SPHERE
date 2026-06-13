import RevealBlock from './reveal-block';

export default function ScenarioLayersSection() {
  return (
    <section className="py-20 md:py-28 lg:py-32">
      <RevealBlock className="mb-8">
        <span className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#475467]">
          Business Booster
        </span>
      </RevealBlock>

      <div className="relative grid grid-cols-1 gap-6 md:grid-cols-12">
        <RevealBlock className="md:col-span-7" delay={120}>
          <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-10">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">Empower Governance</p>
              <h3 className="mt-4 max-w-[36rem] text-3xl font-medium leading-tight text-[#111827] md:text-5xl">
                Trust the evidence, not the promise
              </h3>
              <p className="mt-6 max-w-[36rem] text-sm leading-relaxed text-[#475467] md:text-base">
                With the tecnology of SPHERE, small and medium businesses can now access the same level of pricing customization and governance as large enterprises, enabling them to compete more effectively in the market and drive growth.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {['Manage Contracts', 'Simplify Pricing Integration', 'Ease Customer Support', 'AI-driven Pricing Expert'].map(item => (
                  <span
                    key={item}
                    className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-[#475467]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </article>
          </div>
        </RevealBlock>

        <RevealBlock className="md:col-span-5" delay={190}>
          <div className="flex flex-col gap-6 md:-ml-10 md:pt-10">
            <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5 md:rotate-[2.2deg]">
              <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-7">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">Revenue Growth</p>
                <p className="mt-4 text-4xl font-medium leading-none text-[#111827]">98.7%</p>
                <p className="mt-3 text-sm leading-relaxed text-[#475467]">of services integrating our tool suite report revenue growth.</p>
              </article>
            </div>

            <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5 md:rotate-[-1.6deg]">
              <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-7">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">Configuration Space</p>
                <p className="mt-4 text-4xl font-medium leading-none text-[#111827]">From tens to thousands</p>
                <p className="mt-3 text-sm leading-relaxed text-[#475467]">of configurations that tailor to any market segment.</p>
              </article>
            </div>
          </div>
        </RevealBlock>
      </div>
    </section>
  );
}
