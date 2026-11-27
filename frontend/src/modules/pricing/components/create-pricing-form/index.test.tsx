import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock('../organization-selector', () => ({ default: () => null }));
vi.mock('../../../core/components/file-upload-input', () => ({ default: () => null }));
vi.mock('../../../core/components/slug-preview', () => ({ default: () => null }));
vi.mock('../../../core/components/block-alert', () => ({ default: () => null }));
vi.mock('../../api/pricingsApi', () => ({ usePricingsApi: () => ({ createPricing: vi.fn() }) }));
vi.mock('../../../core/hooks/useRouter', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../organization/api/organizationsApi', () => ({ useOrganizationsApi: () => ({ getOrgPermissions: vi.fn() }) }));
vi.mock('../../../auth/hooks/useAuth', () => ({ useAuth: () => ({ authUser: { user: { id: 'u', role: 'USER' } } }) }));

const { default: CreatePricingForm } = await import('.');

describe('CreatePricingForm', () => {
  it('offers the three visibilities and starts on Public (CA-2.1, CA-2.3)', () => {
    let view: ReactTestRenderer;
    act(() => {
      view = create(<CreatePricingForm />);
    });
    const radios = view!.root.findAll(node => node.type === 'input' && node.props.type === 'radio');
    expect(radios.map(radio => radio.props.value)).toEqual(['Public', 'Unlisted', 'Private']);
    expect(radios.filter(radio => radio.props.checked).map(radio => radio.props.value)).toEqual(['Public']);
  });
});
