import { GrWorkshop } from 'react-icons/gr';
import { IoNewspaperOutline } from "react-icons/io5";
import { FaPlayCircle } from 'react-icons/fa';
import type { TimelineItem } from '../components/timeline';

const timelineData: TimelineItem[] = [
  {
    variant: 'proceedings',
    title: 'Pricing Intelligence: Rethinking IS Engineering in Volatile SaaS Environments',
    subtitle:
      'Francisco Javier Cavero, Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['38th International Conference on Advanced Information Systems Engineering (CAISE)'],
    date: '2026-06-08',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1109/TSC.2025.3634801',
  },
  {
    variant: 'journal',
    title: 'Trends in Industry Support for Pricing-Driven DevOps in SaaS',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo, Francisco Javier Cavero and Antonio Ruiz-Cortés',
    text: ['IEEE Transactions on Services Computing'],
    date: '2026-01-01',
    icon: <IoNewspaperOutline stroke="white" />,
    href: 'https://doi.org/10.1109/TSC.2025.3634801',
  },
  {
    variant: 'proceedings',
    title: 'iSubscription: Bridging the Gap Between Contracts and Runtime Access Control in SaaS',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['23rd International Conference on Service-Oriented Computing (ICSOC)'],
    date: '2025-12-04',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://link.springer.com/book/9789819550142',
  },
  {
    variant: 'proceedings',
    title: 'A-MINT: An LLM Pipeline for Automated Modeling of iPricings from SaaS Pricing Pages',
    subtitle:
      'Francisco Javier Cavero, José Antonio Parejo, Juan C. Alonso and Antonio Ruiz-Cortés',
    text: ['23rd International Conference on Service-Oriented Computing (ICSOC)'],
    date: '2025-12-04',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://link.springer.com/book/9789819550142',
  },
  {
    variant: 'demo',
    title: 'From Pricing Models to Runtime Self-Adaptation: A Demonstration of SPACE',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['23rd International Conference on Service-Oriented Computing (ICSOC)'],
    date: '2025-12-04',
    icon: <FaPlayCircle fill="white" />,
    href: 'https://youtu.be/-GIpNp90qB8?si=W1kJm7waDmFwi_q6',
    awards: ["Best Demonstration Runner-up"],
  },
  {
    variant: 'proceedings',
    title: 'HORIZON: a Classification and Comparison Framework for Pricing-driven Feature Toggling',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['25th International Conference on Web Engineering (ICWE)'],
    date: '2025-06-15',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-3-031-97207-2_19',
  },
  {
    variant: 'proceedings',
    title: 'Automated Analysis of Pricings in SaaS-Based Information Systems',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo, Pablo Trinidad and Antonio Ruiz-Cortés',
    text: ['37th International Conference on Advanced Information Systems Engineering (CAISE)'],
    date: '2025-06-15',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-3-031-94571-7_13',
  },
  {
    variant: 'proceedings',
    title: 'Racing the Market: An Industry Support Analysis for Pricing-Driven DevOps in SaaS',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo, Francisco Javier Cavero and Antonio Ruiz-Cortés',
    text: ['22nd International Conference on Service-Oriented Computing (ICSOC)'],
    date: '2024-12-03',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-981-96-0808-9_19',
    awards: ["Best Student Paper Award", "Distinguished Paper Award"],
  },
  {
    variant: 'proceedings',
    title: 'Towards Effective SaaS Pricing Design: A Case Study of CCSIM',
    subtitle:
      'Alejandro García-Fernández, Sergio Laso, José Antonio Parejo, Javier Berrocal, Antonio Ruiz-Cortés and Juan Manuel Murillo',
    text: [
      '20th International Workshop on Engineering Service-Oriented Applications and Cloud Services (WESOACS)',
    ],
    date: '2024-12-03',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-981-96-7238-7_13',
  },
  {
    variant: 'proceedings',
    title: 'From Static to Intelligent: Evolving SaaS Pricing with LLMs',
    subtitle: 'Francisco Javier Cavero, Juan C. Alonso, Antonio Ruiz-Cortés',
    text: ['1st International Workshop on Service-Oriented Computing for AI Applications (SOC4AI)'],
    date: '2024-12-03',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-981-96-7423-7_12',
  },
  {
    variant: 'demo',
    title: 'Towards Pricing4SaaS: A Framework for Pricing-driven Feature Toggling in SaaS',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo, Pablo Trinidad and Antonio Ruiz-Cortés',
    text: ['24th International Conference on Web Engineering (ICWE)'],
    date: '2024-06-17',
    icon: <FaPlayCircle fill="white" />,
    href: 'https://doi.org/10.1007/978-3-031-62362-2_30',
  },
  {
    variant: 'demo',
    title: 'Towards a Suite of Software Libraries for Pricing-driven Feature Toggling',
    subtitle:
      'Alejandro García-Fernández, José Antonio Parejo, Pablo Trinidad and Antonio Ruiz-Cortés',
    text: ['Actas de las XIX Jornadas de Ciencia e Ingeniería de Servicios (JCIS)'],
    date: '2024-06-17',
    icon: <FaPlayCircle fill="white" />,
    href: 'https://biblioteca.sistedes.es/entities/artículo/16147fdc-2bae-477b-8b22-3d755358597a',
    awards: ["Best Demo Award"],
  },
  {
    variant: 'proceedings',
    title: 'Pricing-driven Development and Operation of SaaS: Challenges and Opportunities',
    subtitle: 'Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['Actas de las XIX Jornadas de Ciencia e Ingeniería de Servicios (JCIS)'],
    date: '2024-06-17',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://biblioteca.sistedes.es/entities/artículo/0d0e5e8e-59cd-4c34-b9a0-4de989221c87',
    awards: ["Best Long Paper Award"],
  },
  {
    variant: 'proceedings',
    title: 'Pricing4SaaS: Towards a Pricing Model to Drive the Operation of SaaS',
    subtitle: 'Alejandro García-Fernández, José Antonio Parejo and Antonio Ruiz-Cortés',
    text: ['36th International Conference on Advanced Information Systems Engineering (CAISE)'],
    date: '2024-06-03',
    icon: <GrWorkshop stroke="white" />,
    href: 'https://doi.org/10.1007/978-3-031-61000-4_6',
  },
];

export default timelineData;
