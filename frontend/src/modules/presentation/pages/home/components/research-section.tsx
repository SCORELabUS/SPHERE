import type { MouseEvent } from 'react';
import type { ToolItem } from '../data';
import IslandButton from './island-button';
import RevealBlock from './reveal-block';

export function ResearchSection({ images, onResearch, onTeam }: { images: string[]; onResearch: () => void; onTeam: () => void }) {
  return (
    <section id="research-section" className="py-20 md:py-28 lg:py-32">
      <RevealBlock className="mb-8">
        <span className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#475467]">
          Research
        </span>
      </RevealBlock>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <RevealBlock className="md:col-span-7" delay={80}>
          <div className="h-full rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
            <article className="flex h-full flex-col rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:p-10">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#667085]">Research-driven pricing innovation</p>
              <h3 className="mt-4 max-w-2xl text-3xl font-medium leading-tight text-[#111827] md:text-5xl">
                Built from peer-reviewed work and a world-class academic team.
              </h3>
              <p className="mt-6 max-w-2xl text-sm leading-relaxed text-[#475467] md:text-base">
                Our platform is the result of cutting-edge research and the dedication of a world-class team. The scientific publications behind our technology and the brilliant minds of our researchers have made it possible to create powerful and flexible solutions for DevOps teams and SaaS pricing management.
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#475467] md:text-base">
                We invite you to explore the foundation of our success and meet the people who make it all possible.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <IslandButton label="Read publications" onClick={onResearch} />
                <IslandButton label="Meet the team" onClick={onTeam} />
              </div>
            </article>
          </div>
        </RevealBlock>

        <RevealBlock className="md:col-span-5" delay={160}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-2">
            {images.map((imageSrc, index) => (
              <div
                key={imageSrc}
                className={`overflow-hidden rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5 ${index % 2 === 0 ? 'md:translate-y-3' : ''}`}
              >
                <div className="h-44 overflow-hidden rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] md:h-56">
                  <img
                    src={imageSrc}
                    alt="SPHERE research highlight"
                    className="h-full w-full object-cover transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-[1.03]"
                  />
                </div>
              </div>
            ))}
          </div>
        </RevealBlock>
      </div>
    </section>
  );
}

export function ToolingStackSection({
  tools,
  onNavigate,
  tiltByTool,
  onToolMouseMove,
  onToolMouseLeave,
}: {
  tools: ToolItem[];
  onNavigate: (to: string) => void;
  tiltByTool: Record<string, React.CSSProperties>;
  onToolMouseMove: (event: MouseEvent<HTMLElement>, name: string) => void;
  onToolMouseLeave: (name: string) => void;
}) {
  const openLink = (href: string, kind: 'internal' | 'external') => {
    if (kind === 'internal') {
      onNavigate(href);
      return;
    }

    if (href === '#') {
      return;
    }

    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <section id="tooling-stack" className="py-20 md:py-28 lg:py-32">
      <RevealBlock className="mb-8">
        <span className="inline-flex rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#475467]">
          Tooling Stack
        </span>
      </RevealBlock>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool, index) => (
          <RevealBlock key={tool.name} delay={index * 70 + 80}>
            <div className="h-full rounded-[2rem] border border-black/10 bg-black/[0.03] p-1.5 ring-1 ring-black/5">
              <article
                onMouseMove={event => onToolMouseMove(event, tool.name)}
                onMouseLeave={() => onToolMouseLeave(tool.name)}
                style={tiltByTool[tool.name] ?? { transform: 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)' }}
                className="group relative flex min-h-[370px] transform-gpu flex-col overflow-hidden rounded-[calc(2rem-0.375rem)] border border-black/10 bg-white p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
              >
                <div className="pointer-events-none absolute right-[-3rem] top-[-3rem] h-28 w-28 rounded-full bg-[#dbeafe] opacity-50 blur-2xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110" />
                <div className="relative z-[1] flex items-start justify-between gap-3">
                  <div className="relative inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-black/10 bg-[#f8fafc]">
                    {tool.customLogo === 'ipricing-editor' ? (
                      <span className="font-mono text-[24px] font-bold text-cyan-700">&lt;/&gt;</span>
                    ) : tool.customLogo === 'pricing2yaml' ? (
                      <span className="text-[22px] font-semibold text-[#6d28d9]">YAML</span>
                    ) : (
                      <img
                        src={tool.logo}
                        alt={`${tool.name} logo`}
                        className="h-full w-full object-contain p-2"
                        onError={event => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                  {tool.badge ? (
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-700">
                      {tool.badge}
                    </span>
                  ) : null}
                </div>

                <p className="mt-5 text-[11px] uppercase tracking-[0.2em] text-[#667085]">Tool {`0${index + 1}`}</p>
                <h3 className="mt-2 text-2xl font-medium leading-tight text-[#111827]">{tool.name}</h3>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-[#475467]">{tool.description}</p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {tool.links.map(link => (
                    <button
                      key={`${tool.name}-${link.label}`}
                      type="button"
                      onClick={() => openLink(link.href, link.kind)}
                      className="cursor-pointer rounded-full border border-black/10 bg-[#f8fafc] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#334155] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-cyan-300 hover:text-cyan-700"
                    >
                      {link.label}
                      {link.kind === 'external' ? ' ↗' : ''}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => openLink(tool.primary.href, tool.primary.kind)}
                  className="mt-5 inline-flex cursor-pointer items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#1d2939] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:translate-x-1"
                >
                  {tool.primary.label}
                  <span className={tool.primary.kind === 'internal' ? 'rotate-45' : ''}>↗</span>
                </button>
              </article>
            </div>
          </RevealBlock>
        ))}
      </div>
    </section>
  );
}
