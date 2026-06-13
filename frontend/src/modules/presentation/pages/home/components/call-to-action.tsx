import IslandButton from './island-button';
import RevealBlock from './reveal-block';

export default function CallToAction({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <RevealBlock className="rounded-[2rem] border border-white/15 bg-white/[0.06] p-1.5 ring-1 ring-white/10">
      <div className="rounded-[calc(2rem-0.375rem)] border border-white/15 bg-[#111f36] px-6 py-12 shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)] md:px-12 md:py-16">
        <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-white/75">
          Ready to deploy
        </span>
        <h2 className="mt-6 max-w-3xl [font-family:'PP_Editorial_New','Clash_Display',serif] text-4xl leading-[0.95] text-white md:text-7xl">
          Create a resilient pricing system your teams trust.
        </h2>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-white/70 md:text-base">
          Design once, evaluate continuously, and publish with confidence using structured workflows
          built for modern SaaS operators.
        </p>
        <div className="mt-10">
          <IslandButton label="Start now" onClick={() => onNavigate('/authentication?view=register')} />
        </div>
      </div>
    </RevealBlock>
  );
}
