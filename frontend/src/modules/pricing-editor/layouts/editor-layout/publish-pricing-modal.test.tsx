import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Stable across renders, as the real hooks are: the modal's effects depend on them.
const apis = vi.hoisted(() => ({
  pricings: {
    createPricing: () => Promise.resolve(),
    createPricingVersion: () => Promise.resolve(),
    getPermissionBasedUserPricings: () => Promise.resolve({ pricings: [], total: 0 }),
    getPricingBySlug: () => Promise.resolve(null),
  },
  organizations: { getMyOrganizations: () => Promise.resolve([]) },
  router: { push: () => {} },
  editor: { sourcePricing: null },
}));
vi.mock('../../../pricing/api/pricingsApi', () => ({ usePricingsApi: () => apis.pricings }));
vi.mock('../../../organization/api/organizationsApi', () => ({ useOrganizationsApi: () => apis.organizations }));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => apis.router }));
vi.mock('../../../core/components/org-avatar', () => ({ default: () => null }));
vi.mock('../../../core/utils/custom-confirm', () => ({ default: () => Promise.resolve() }));
vi.mock('../../hooks/useEditorValue', () => ({ useEditorValue: () => apis.editor }));

const { default: PublishPricingModal } = await import('./publish-pricing-modal');

type Node = ReactTestRenderer['root'];
const textOf = (node: Node): string => node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

describe('PublishPricingModal', () => {
  it('offers the three visibilities for a new pricing and starts on Public (CA-2.1, CA-2.3)', async () => {
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(<PublishPricingModal yaml={'saasName: Petclinic\nversion: "1.0"\n'} onClose={vi.fn()} />);
    });
    const picker = view!.root.findAll(node => node.type === 'fieldset').find(node => textOf(node.findByType('legend')) === 'Visibility')!;
    const choices = picker.findAllByType('button');
    const label = (choice: Node) => textOf(choice.findAllByType('span')[1]);
    expect(choices.map(label)).toEqual(['Public', 'Unlisted', 'Private']);
    expect(choices.filter(choice => choice.props['aria-pressed']).map(label)).toEqual(['Public']);
    for (const choice of choices) expect(choice.props.className).toContain('cursor-pointer');
  });
});
