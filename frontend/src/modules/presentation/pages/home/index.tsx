import { useState, type CSSProperties, type MouseEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { useRouter } from '../../../core/hooks/useRouter';
import BackgroundOrbs from './components/background-orbs';
import FloatingMorphHeader from './components/floating-morph-header';
import FullFooterSection from './components/full-footer-section';
import HeroSection from './components/hero-section';
import HomeGlobalStyles from './components/home-global-styles';
import JourneyChaptersSection from './components/journey-chapters-section';
import OperationalCadenceSection from './components/operational-cadence-section';
import PlatformSurfaceSection from './components/platform-surface-section';
// import ProofMarqueeSection from './components/proof-marquee-section';
import { ResearchSection, ToolingStackSection } from './components/research-section';
import ScenarioLayersSection from './components/scenario-layers-section';
import FundersSection from './components/funders-section';
import {
  FUNDERS,
  NAV_ITEMS,
  // PROOF_LOGOS,
  RESEARCH_HIGHLIGHTS,
  SPHERE_TOOLS,
  STORY_CHAPTERS,
} from './data';
import CallToAction from './components/call-to-action';

export default function HomePage() {
  const router = useRouter();
  const [tiltByTool, setTiltByTool] = useState<Record<string, CSSProperties>>({});

  const handleNavigate = (to: string) => router.push(to);

  const handleToolMouseMove = (event: MouseEvent<HTMLElement>, name: string) => {
    if (window.innerWidth < 1024) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateX = (y / rect.height - 0.5) * -8;
    const rotateY = (x / rect.width - 0.5) * 10;

    setTiltByTool(prev => ({
      ...prev,
      [name]: {
        transform: `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)`,
      },
    }));
  };

  const handleToolMouseLeave = (name: string) => {
    setTiltByTool(prev => ({
      ...prev,
      [name]: {
        transform: 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)',
      },
    }));
  };

  return (
    <>
      <HomeGlobalStyles />
      <Helmet>
        <title>SPHERE | SaaS Pricing Platform for DevOps Teams</title>
        <meta
          name="description"
          content="SPHERE is a SaaS pricing and DevOps platform to model, evaluate, and optimize pricing strategies. Explore configuration spaces, analyze monetization, and ship pricing changes with confidence."
        />
        <meta
          name="keywords"
          content="pricing, SaaS pricing, DevOps, pricing optimization, monetization, pricing analytics, configuration space"
        />
      </Helmet>

      <div className="relative min-h-[100dvh] overflow-x-clip bg-[#f8f7f4] text-[#101828] [font-family:'Geist','Plus_Jakarta_Sans',sans-serif]">
        <div className="relative">
          <BackgroundOrbs />
          <FloatingMorphHeader navItems={NAV_ITEMS} onNavigate={handleNavigate} />

          <main className="relative z-[3] mx-auto flex w-full max-w-[1240px] flex-col px-4 pb-24 pt-28 md:px-8 md:pb-36 md:pt-40">
            <HeroSection
              onRegister={() => handleNavigate('/authentication?view=register')}
              onPricings={() => handleNavigate('/pricings')}
            />
            {/* <ProofMarqueeSection logos={PROOF_LOGOS} /> */}
            <PlatformSurfaceSection
              onResearch={() => handleNavigate('/research')}
              onEditor={() => handleNavigate('/pricings')}
            />
            <JourneyChaptersSection chapters={STORY_CHAPTERS} />
            <OperationalCadenceSection />
            <ScenarioLayersSection />
            <ToolingStackSection
              tools={SPHERE_TOOLS}
              onNavigate={handleNavigate}
              tiltByTool={tiltByTool}
              onToolMouseMove={handleToolMouseMove}
              onToolMouseLeave={handleToolMouseLeave}
            />
            <ResearchSection
              images={RESEARCH_HIGHLIGHTS}
              onResearch={() => handleNavigate('/research')}
              onTeam={() => handleNavigate('/team')}
            />
            <FundersSection funders={FUNDERS} />
            <CallToAction onNavigate={handleNavigate} />
          </main>
        </div>

        <FullFooterSection onNavigate={handleNavigate} />
      </div>
    </>
  );
}
