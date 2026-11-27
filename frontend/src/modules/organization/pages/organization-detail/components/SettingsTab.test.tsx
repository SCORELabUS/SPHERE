import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import SettingsTab from './SettingsTab';
import type { Organization } from '../../../api/organizationsApi';

const mocks = vi.hoisted(() => ({ updateOrganization: vi.fn() }));
vi.mock('../../../api/organizationsApi', () => ({ useOrganizationsApi: () => mocks }));

describe('organization visibility settings', () => {
  it('saves the selected visibility and service publication together', async () => {
    const org = { id: 'org', visibility: 'public', servicesPublic: false } as Organization;
    const saved = { ...org, visibility: 'private', servicesPublic: true };
    const onSaved = vi.fn();
    mocks.updateOrganization.mockResolvedValue(saved);
    const view = create(<SettingsTab org={org} onSaved={onSaved} />);
    act(() => {
      view.root.findAllByType('input').find(input => input.props.value === 'private')!.props.onChange();
      view.root.findAllByType('input').find(input => input.props.name === 'servicesPublic')!.props.onChange({ target: { checked: true } });
    });
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(mocks.updateOrganization).toHaveBeenCalledWith('org', { visibility: 'private', servicesPublic: true });
    expect(onSaved).toHaveBeenCalledWith(saved);
    view.unmount();
  });
});
