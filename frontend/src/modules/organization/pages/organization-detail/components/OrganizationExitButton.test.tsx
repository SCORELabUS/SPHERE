import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationExitButton from './OrganizationExitButton';

const mocks = vi.hoisted(() => ({
  deleteOrganization: vi.fn(),
  removeMember: vi.fn(),
  confirm: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('../../../api/organizationsApi', () => ({ useOrganizationsApi: () => mocks }));
vi.mock('../../../../core/utils/custom-confirm', () => ({ default: mocks.confirm }));
vi.mock('../../../../core/utils/custom-alert', () => ({ default: mocks.alert }));
vi.mock('../../../../core/components/iconify', () => ({ default: () => null }));

const owner = {
  id: 'membership',
  role: 'OWNER' as const,
  joinedAt: '',
  user: { id: 'owner', username: 'owner', email: 'owner@example.com', avatar: null },
};
const defaults = { orgId: 'org', isPersonal: false, members: [owner], currentUserId: 'owner' };

describe('OrganizationExitButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.confirm.mockResolvedValue(undefined);
  });

  function render(overrides = {}) {
    const onExited = vi.fn();
    let view: ReactTestRenderer;
    act(() => {
      view = create(<OrganizationExitButton {...defaults} onExited={onExited} {...overrides} />);
    });
    return { view: view!, onExited };
  }

  it.each([false, true])(
    'offers deletion to the sole owner (compact=%s) and warns before deleting',
    async compact => {
      const { view, onExited } = render({ compact });
      const button = view.root.findByType('button');
      expect(button.props['aria-label']).toBe('Delete organization');
      expect(button.props.className).toContain('cursor-pointer');
      await act(async () => {
        await button.props.onClick();
      });
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.stringContaining(
          'Deleting an organization will delete all resources associated with it'
        ),
        { danger: true, confirmLabel: 'Delete organization' }
      );
      expect(mocks.deleteOrganization).toHaveBeenCalledWith('org');
      expect(mocks.removeMember).not.toHaveBeenCalled();
      expect(onExited).toHaveBeenCalledOnce();
    }
  );

  it('does nothing when confirmation is cancelled', async () => {
    mocks.confirm.mockRejectedValue(undefined);
    const { view, onExited } = render();
    await act(async () => {
      await view.root.findByType('button').props.onClick();
    });
    expect(mocks.deleteOrganization).not.toHaveBeenCalled();
    expect(mocks.removeMember).not.toHaveBeenCalled();
    expect(onExited).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(view.root.findByType('button').props.disabled).toBe(false);
  });

  it.each([
    {
      members: [
        owner,
        { ...owner, id: 'other-membership', role: 'MEMBER', user: { ...owner.user, id: 'other' } },
      ],
    },
    { members: [{ ...owner, role: 'ADMIN' }] },
    { members: [{ ...owner, role: 'MEMBER' }] },
    { currentUserId: 'other' },
  ])('preserves leaving when the viewer is not the sole owner: %o', async overrides => {
    const { view } = render(overrides);
    expect(view.root.findByType('button').props['aria-label']).toBe('Leave organization');
    await act(async () => {
      await view.root.findByType('button').props.onClick();
    });
    expect(mocks.deleteOrganization).not.toHaveBeenCalled();
    expect(mocks.removeMember).toHaveBeenCalledWith('org', overrides.currentUserId ?? 'owner');
  });

  it.each([{ isPersonal: true }, { currentUserId: undefined }])(
    'hides the action for %o',
    overrides => {
      expect(render(overrides).view.toJSON()).toBeNull();
    }
  );

  it('shows deletion errors and stays on the organization', async () => {
    mocks.deleteOrganization.mockRejectedValue(new Error('Permission denied'));
    const { view, onExited } = render();
    await act(async () => {
      await view.root.findByType('button').props.onClick();
    });
    expect(mocks.alert).toHaveBeenCalledWith('Permission denied', 'error');
    expect(onExited).not.toHaveBeenCalled();
    expect(view.root.findByType('button').props.disabled).toBe(false);
  });

  it('disables the action while waiting for confirmation', async () => {
    let cancel!: () => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise((_, reject) => {
          cancel = reject;
        })
    );
    const { view } = render();
    let pending!: Promise<void>;
    act(() => {
      pending = view.root.findByType('button').props.onClick();
    });
    expect(view.root.findByType('button').props.disabled).toBe(true);
    await act(async () => {
      await view.root.findByType('button').props.onClick();
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await act(async () => {
      cancel();
      await pending;
    });
  });
});
