export type NavChild = {
  label: string;
  to: string;
};

export type NavItem = {
  label: string;
  to?: string;
  children?: NavChild[];
};

export type ToolItem = {
  name: string;
  description: string;
  logo?: string;
  badge?: string;
  customLogo?: 'ipricing-editor' | 'pricing2yaml';
  primary: {
    label: string;
    href: string;
    kind: 'internal' | 'external';
  };
  links: Array<{
    label: string;
    href: string;
    kind: 'internal' | 'external';
  }>;
};

export type StoryChapter = {
  title: string;
  description: string;
};

export type Funder = {
  name: string;
  href: string;
  image: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Tools',
    children: [
      { label: 'Pricing2Yaml Editor', to: '/editor' },
      { label: 'HARVEY', to: '/harvey' },
    ],
  },
  {
    label: 'Explore',
    children: [
      { label: 'Pricings', to: '/pricings' },
      { label: 'Collections', to: '/collections' },
    ],
  },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Team', to: '/team' },
  { label: 'Research', to: '/research' },
  { label: 'Changelog', to: '/changelog'},
];

export const SPHERE_TOOLS: ToolItem[] = [
  {
    name: 'iPricing Editor',
    description: 'Real-time iPricing editor and renderer using Pricing2Yaml syntax, integrated into SPHERE.',
    customLogo: 'ipricing-editor',
    badge: 'Inside SPHERE',
    primary: {
      label: 'Try it out',
      href: '/editor',
      kind: 'internal',
    },
    links: [],
  },
  {
    name: 'AMINT',
    description:
      'Automatically transform any public pricing from the web into an iPricing for analysis and experimentation.',
    logo: '/assets/logos/amint.webp',
    badge: 'Inside SPHERE',
    primary: {
      label: 'Try in HARVEY',
      href: '/harvey',
      kind: 'internal',
    },
    links: [
      { label: 'Repository', href: '#', kind: 'external' },
    ],
  },
  {
    name: 'PRIME',
    description: 'API for iPricing analysis and validation to extract metrics from plans, features, and configurations.',
    logo: '/assets/logos/prime-short.webp',
    badge: 'Inside SPHERE',
    primary: {
      label: 'Try it out',
      href: '/pricings',
      kind: 'internal',
    },
    links: [
      {
        label: 'Repository',
        href: 'https://github.com/isa-group/Pricing-Intelligence-Interpretation-Process/tree/main/analysis_api',
        kind: 'external',
      },
    ],
  },
  {
    name: 'SPACE',
    description:
      'Self-adaptive software that keeps your SaaS aligned with pricing changes without requiring development',
    logo: '/assets/logos/space.webp',
    badge: 'External tool',
    primary: {
      label: 'Open repository',
      href: 'https://github.com/isa-group/space',
      kind: 'external',
    },
    links: [
      {
        label: 'Documentation',
        href: 'https://sphere-docs.vercel.app/docs/2.0.1/api/space/introduction',
        kind: 'external',
      },
    ],
  },
  {
    name: 'Pricing2Yaml',
    description: 'YAML-based language for structured, readable, and reusable iPricing representation.',
    customLogo: 'pricing2yaml',
    badge: 'iPricing Model',
    primary: {
      label: 'Read syntax',
      href: 'https://sphere-docs.vercel.app/docs/2.0.1/api/pricing-description-languages/Pricing2Yaml/the-pricing2yaml-syntax',
      kind: 'external',
    },
    links: [],
  },
  {
    name: 'HARVEY',
    description: 'AI-powered assistant for pricing strategy analysis and decision-making support.',
    logo: '/assets/logos/harvey.webp',
    badge: 'Inside Sphere',
    primary: {
      label: 'Try it out',
      href: '/harvey',
      kind: 'internal',
    },
    links: [
      {
        label: 'Repository',
        href: 'https://github.com/isa-group/Pricing-Intelligence-Interpretation-Process',
        kind: 'external',
      },
    ],
  },
];

export const PROOF_LOGOS = ['ISA Group', 'SCORE Lab', 'SPHERE Research', 'Pricing4TS', 'DevOps Studies', 'SaaS Benchmarks'];

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    title: 'Design',
    description:
      'your pricing strategy as a structured iPricing, and iterate on it with AI assistance until it’s ready for deployment.',
  },
  {
    title: 'Simulate',
    description:
      'adoption and revenue shifts under controlled assumptions, then compare candidate strategies side by side.',
  },
  {
    title: 'Ship',
    description:
      'new versions of your pricing without changing the code of your app. A perfect balance between flexibility and stability.',
  },
];

export const RESEARCH_HIGHLIGHTS = [
  'assets/landing/research/presenter1.webp',
  'assets/landing/research/presenter3.webp',
  'assets/landing/research/group.webp',
  'assets/landing/research/award.webp',
];

export const FUNDERS: Funder[] = [
  {
    name: 'SCORE Lab',
    href: 'https://score.us.es',
    image: 'assets/landing/score.png',
  },
  {
    name: 'Spanish Research Agency',
    href: 'https://www.aei.gob.es',
    image: 'assets/landing/government.png',
  },
  {
    name: 'Universidad de Sevilla',
    href: 'https://www.us.es',
    image: 'assets/landing/university.png',
  },
  {
    name: 'Junta de Andalucía',
    href: 'https://www.juntadeandalucia.es',
    image: 'assets/landing/junta.webp',
  },
];
