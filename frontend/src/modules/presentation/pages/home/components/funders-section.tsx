import type { Funder } from '../data';
import RevealBlock from './reveal-block';

export default function FundersSection({ funders }: { funders: Funder[] }) {
  return (
    <section id="funders-section" className="py-20 md:py-28 lg:py-32">
      <RevealBlock className="mb-8">
        <span className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#475467]">
          Funders
        </span>
      </RevealBlock>

      <RevealBlock delay={90}>
        <div className="rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
          <article className="rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-10">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">Founded by public entities</p>
            <h3 className="mt-4 max-w-3xl text-3xl font-medium leading-tight text-[#111827] md:text-5xl">
              Public institutions and grants powering SPHERE from day one.
            </h3>
            <p className="mt-6 max-w-3xl text-sm leading-relaxed text-[#475467] md:text-base">
              SPHERE is a collaborative effort backed by public entities, dedicated to advancing research and innovation in SaaS pricing. Our mission is to democratize access to cutting-edge technology, empowering researchers worldwide.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#475467] md:text-base">
              Discover the public entities, projects, and grants that have made SPHERE possible.
            </p>

            <div className="mt-10 grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
              {funders.map(partner => (
                <a
                  key={partner.name}
                  href={partner.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group h-full cursor-pointer rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1"
                >
                  <div className="flex h-full flex-col rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)]">
                    <div className="flex h-24 items-center justify-center rounded-2xl border border-black/10 bg-[#fcfcfb] p-4">
                      <img src={partner.image} alt={partner.name} className="h-full w-full object-contain" />
                    </div>
                    <p className="mt-4 text-center text-sm font-medium text-[#475467] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:text-[#111827]">
                      {partner.name}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </article>
        </div>
      </RevealBlock>
    </section>
  );
}
