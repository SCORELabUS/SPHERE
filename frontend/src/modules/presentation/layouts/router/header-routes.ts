export interface HeaderRoute {
  name: string;
  disabled: boolean;
  to?: string;
  children?: HeaderRoute[];
}

export const headerRoutes: HeaderRoute[] = [
  {
    name: 'Tools',
    disabled: false,
    children: [
      {
        name: 'Pricing2Yaml Editor',
        disabled: false,
        to: '/editor',
      },
      {
        name: 'HARVEY',
        disabled: false,
        to: '/harvey',
      },
    ],
  },
  {
    name: 'Organizations',
    disabled: false,
    to: '/me/orgs',
  },
  {
    name: 'Pricings',
    disabled: false,
    children: [
      {
        name: 'Pricings',
        disabled: false,
        to: '/pricings',
      },
      {
        name: 'Collections',
        disabled: false,
        to: '/collections',
      },
    ],
  },
  {
    name: 'Team',
    disabled: false,
    to: '/team',
  },
  {
    name: 'Research',
    disabled: false,
    to: '/research',
  },
  // {
  //   name: 'Contribute',
  //   disabled: false,
  //   to: '/contributions',
  // },
];
