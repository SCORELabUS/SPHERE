import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import PricingVersionsTab from '.';
import VersionsVisibilityModal from '../versions-visibility-modal';
import type { VersionData } from '../../types/card';

vi.mock('../pricing-version-diff', () => ({ default: () => null }));

const version = (id: string, isPrivate: boolean): VersionData => ({
  id, version: `v${id}`, createdAt: '2026-01-01T00:00:00Z', yaml: '', private: isPrivate, collection: null, analytics: null, forkedFrom: null,
});

function renderTab(unlisted: boolean) {
  let view: ReactTestRenderer;
  act(() => {
    view = create(
      <PricingVersionsTab
        versions={[version('1', false), version('2', true)]}
        currentVersion={null}
        canDelete={false}
        onDownload={vi.fn()}
        onOpenInEditor={vi.fn()}
        onCopyLink={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        canChangeVisibility
        onToggleVisibility={vi.fn()}
        onViewOrigin={vi.fn()}
        unlisted={unlisted}
      />
    );
  });
  return view!;
}

const eyes = (view: ReactTestRenderer) =>
  view.root.findAll(node => node.type === 'button' && typeof node.props.title === 'string' && /click to make this version/.test(node.props.title));

describe('Version visibility of an unlisted pricing', () => {
  it('calls a version that is not private visible with the link, not public (CA-1.8)', () => {
    const [visible, hidden] = eyes(renderTab(true));
    expect(visible.props.title).toContain('Visible with the link');
    expect(visible.props.title).not.toContain('Public');
    expect(hidden.props.title).toContain('visible with the link');
    expect(hidden.props['aria-label']).toBe('Make version visible with the link');
  });

  it('keeps calling it public on a listed pricing', () => {
    const [visible] = eyes(renderTab(false));
    expect(visible.props.title).toBe('Public: click to make this version private');
  });

  it('says Unlisted in the list of versions of an unlisted pricing (CA-1.8)', () => {
    let view: ReactTestRenderer;
    act(() => {
      view = create(<VersionsVisibilityModal versions={[version('1', false), version('2', true)]} unlisted onClose={vi.fn()} />);
    });
    const content = JSON.stringify(view!.toJSON());
    expect(content).toContain('Unlisted');
    expect(content).not.toContain('"Public"');
  });
});
