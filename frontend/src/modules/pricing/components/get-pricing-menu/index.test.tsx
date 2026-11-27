import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GetPricingMenu from '.';

/** `buttonRight`: where the menu's button ends on screen. */
function render(onAnonymousLink?: () => void, buttonRight = 1248) {
  let view: ReactTestRenderer;
  act(() => {
    view = create(
      <GetPricingMenu
        pricingId="pricing"
        yamlLink="static/pricings/x.yml"
        onCopyYamlLink={vi.fn()}
        onDownloadCurrent={vi.fn()}
        onDownloadAll={vi.fn().mockResolvedValue(undefined)}
        onAnonymousLink={onAnonymousLink}
      />,
      { createNodeMock: element => (element.props.className === 'relative' ? { getBoundingClientRect: () => ({ right: buttonRight }), contains: () => true } : null) }
    );
  });
  act(() => view!.root.findByProps({ 'aria-haspopup': 'menu' }).props.onClick());
  return view!;
}

const items = (view: ReactTestRenderer) => view.root.findAll(node => node.type === 'button' && node.props.role === 'menuitem');
const label = (item: ReturnType<typeof items>[number]) =>
  item.findAll(node => node.type === 'span' && typeof node.props.className === 'string' && node.props.className.includes('font-medium'))[0].children.join('');

describe('GetPricingMenu', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers the anonymous link first, right after the permanent link, to who may edit the pricing (CA-9.1, CA-9.3)', () => {
    const onAnonymousLink = vi.fn();
    const view = render(onAnonymousLink);
    const [first] = items(view);
    expect(label(first)).toBe('Anonymous link');
    expect(first.props.type).toBe('button');
    expect(first.props.className).toContain('cursor-pointer');
    act(() => first.props.onClick());
    expect(onAnonymousLink).toHaveBeenCalledOnce();
    // The menu closes after choosing it.
    expect(items(view)).toHaveLength(0);
  });

  it('keeps the menu as it was for anyone else (CA-9.2)', () => {
    expect(items(render()).map(label)).toEqual(['Copy YAML link', 'Download current version', 'Download all versions (.zip)']);
  });

  it('never grows wider than a phone screen (CA-9.4)', () => {
    const menu = render(vi.fn()).root.findByProps({ role: 'menu' });
    expect(menu.props.className).toContain('max-w-[calc(100vw-2rem)]');
  });

  it('opens towards the side with room, so on a phone it stays on screen (CA-9.4)', () => {
    const classes = (buttonRight: number) => render(vi.fn(), buttonRight).root.findByProps({ role: 'menu' }).props.className.split(' ');
    // At 375 px the button ends at x=142: a right-aligned 288 px menu would start at x=-146.
    expect(classes(142)).toContain('left-0');
    expect(classes(142)).not.toContain('right-0');
    expect(classes(1248)).toContain('right-0');
    expect(classes(1248)).not.toContain('left-0');
  });
});
