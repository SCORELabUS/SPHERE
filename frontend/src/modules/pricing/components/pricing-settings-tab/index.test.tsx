import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import PricingSettingsTab from '.';
import type { VersionData } from '../../types/card';

vi.mock('../../../core/components/iconify', () => ({ default: () => null }));

const version = (id: string, isPrivate: boolean): VersionData => ({
  id, version: id, createdAt: '2026-01-01', yaml: '', private: isPrivate, collection: null, analytics: null, forkedFrom: null,
});
const ALL = { GET: true, PUT: true, DELETE: true, CREATE: true };

function render(props: Partial<Parameters<typeof PricingSettingsTab>[0]> = {}) {
  let view: ReactTestRenderer;
  act(() => {
    view = create(
      <PricingSettingsTab
        entityPermissions={ALL}
        visibility="Public"
        pricingName="Acme"
        currentVersion={null}
        versions={[version('1', false)]}
        onVisibilityChange={vi.fn()}
        onShowVersionsVisibility={vi.fn()}
        onRename={vi.fn()}
        onDeleteCurrentVersion={vi.fn()}
        onDeletePricing={vi.fn()}
        {...props}
      />
    );
  });
  return view!;
}

const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON());
const checked = (view: ReactTestRenderer) =>
  view.root.findAll(node => node.type === 'input' && node.props.type === 'radio').filter(radio => radio.props.checked).map(radio => radio.props.value);

describe('PricingSettingsTab visibility', () => {
  it('offers Public, Unlisted and Private, and explains what Unlisted means (CA-1.1, CA-1.2)', () => {
    const view = render();
    const values = view.root.findAll(node => node.type === 'input' && node.props.type === 'radio').map(radio => radio.props.value);
    expect(values).toEqual(['Public', 'Unlisted', 'Private']);
    const content = text(view);
    for (const words of ['Anyone with the link', 'search', "organization's page", 'collections']) expect(content).toContain(words);
  });

  it('marks the stored state, and none for a mixed pricing, whose counts say whether it is listed (CA-1.3)', () => {
    expect(checked(render({ visibility: 'Public' }))).toEqual(['Public']);
    expect(checked(render({ visibility: 'Unlisted', unlisted: true }))).toEqual(['Unlisted']);
    expect(checked(render({ visibility: 'Private' }))).toEqual(['Private']);

    const mixed = render({ visibility: 'Mixed', unlisted: true, versions: [version('1', false), version('2', true), version('3', false)] });
    expect(checked(mixed)).toEqual([]);
    expect(text(mixed)).toContain('visible with the link');
    expect(text(mixed)).toContain('unlisted');
    const listedMixed = render({ visibility: 'Mixed', unlisted: false, versions: [version('1', false), version('2', true)] });
    expect(text(listedMixed)).toContain('listed');
    expect(text(listedMixed)).not.toContain('unlisted');
  });

  it('offers the permanent link to share an unlisted pricing, as it does not show in search (F6-2)', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://sphere.test' }, prompt: vi.fn() });
    const link = `https://sphere.test${import.meta.env.BASE_URL.replace(/\/$/, '')}/p/pricing-1`;
    const shared = (view: ReactTestRenderer) =>
      view.root.findAll(node => node.type === 'input' && node.props['aria-label'] === 'Permanent link to share').map(input => input.props.value);

    const unlisted = render({ visibility: 'Unlisted', unlisted: true, pricingId: 'pricing-1' });
    expect(shared(unlisted)).toEqual([link]);
    expect(text(unlisted)).toContain('Link to share');
    // Mixed: anyone with the link still sees its public versions.
    expect(shared(render({ visibility: 'Mixed', unlisted: true, pricingId: 'pricing-1', versions: [version('1', false), version('2', true)] }))).toEqual([link]);

    // Listed, every version private, or no id yet: nothing to share this way.
    expect(shared(render({ visibility: 'Public', unlisted: false, pricingId: 'pricing-1' }))).toEqual([]);
    expect(shared(render({ visibility: 'Private', unlisted: true, pricingId: 'pricing-1', versions: [version('1', true)] }))).toEqual([]);
    expect(shared(render({ visibility: 'Unlisted', unlisted: true }))).toEqual([]);
    expect(shared(render({ visibility: 'Unlisted', unlisted: true, pricingId: 'pricing-1', entityPermissions: { ...ALL, PUT: false } }))).toEqual([]);

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.useFakeTimers();
    try {
      const button = unlisted.root.find(node => node.type === 'button' && JSON.stringify(node.children).includes('Copy link'));
      await act(async () => { await button.props.onClick(); });
      expect(writeText).toHaveBeenCalledWith(link);
      expect(text(unlisted)).toContain('Permanent link copied');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('hides the visibility to whoever may not edit the pricing (CA-1.6)', () => {
    const view = render({ entityPermissions: { ...ALL, PUT: false } });
    expect(text(view)).not.toContain('Visibility');
    expect(view.root.findAll(node => node.type === 'input' && node.props.type === 'radio')).toHaveLength(0);
  });
});
