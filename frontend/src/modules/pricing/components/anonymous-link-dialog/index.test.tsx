import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnonymousLinkDialog, { ANONYMITY_NOTICE } from '.';
import type { VersionData } from '../../types/card';

const api = vi.hoisted(() => ({
  listAnonymousLinks: vi.fn(),
  createAnonymousLink: vi.fn(),
  revokeAnonymousLink: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../../api/anonymousLinksApi', () => ({
  useAnonymousLinksApi: () => api,
  anonymousLinkUrl: (token: string) => `http://localhost/a/${token}`,
}));
vi.mock('../../../core/utils/custom-confirm', () => ({ default: api.confirm }));

const version = (id: string, isPrivate: boolean): VersionData => ({
  id, version: `v${id}`, createdAt: '2026-01-01T00:00:00Z', yaml: '', private: isPrivate, collection: null, analytics: null, forkedFrom: null,
});
const link = (id: string, active = true) => ({ id, token: `token-${id}`.padEnd(32, 'x'), versionId: '1', version: 'v1', createdAt: '2026-02-03T00:00:00Z', active });

async function render(props: Partial<Parameters<typeof AnonymousLinkDialog>[0]> = {}) {
  const handlers = {
    onMakeUnlisted: vi.fn().mockResolvedValue('"etag.2"'),
    onMakeVersionVisible: vi.fn().mockResolvedValue('"etag.3"'),
    onClose: vi.fn(),
  };
  const focus = vi.fn();
  const focusLink = vi.fn();
  const focusDialog = vi.fn();
  let view: ReactTestRenderer;
  await act(async () => {
    view = create(
      <AnonymousLinkDialog
        pricingId="pricing"
        versions={[version('1', false)]}
        selected={version('1', false)}
        unlisted={false}
        {...handlers}
        {...props}
      />,
      {
        createNodeMock: element => {
          if (element.props.role === 'alertdialog') return { focus };
          if (element.props.role === 'dialog') return { focus: focusDialog };
          if (element.props['aria-label'] === 'Anonymous pricing link') return { focus: focusLink };
          return {};
        },
      }
    );
  });
  return { view: view!, focus, focusLink, focusDialog, ...handlers, ...props };
}

type Node = ReactTestRenderer['root'];
/** The text a node renders. */
const textOf = (node: Node): string => node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');
const buttons = (view: ReactTestRenderer) => view.root.findAll(node => node.type === 'button');
const button = (view: ReactTestRenderer, label: string) =>
  buttons(view).find(node => textOf(node) === label) ?? buttons(view).find(node => textOf(node).includes(label))!;
const text = (view: ReactTestRenderer) => textOf(view.root);
/** Escape pressed wherever the focus is. */
const pressEscape = async () => {
  await act(async () => {
    for (const handler of keyHandlers) handler({ key: 'Escape', defaultPrevented: false } as KeyboardEvent);
  });
};
let keyHandlers: Array<(event: KeyboardEvent) => void> = [];
const click = async (node: ReturnType<typeof button>) => {
  await act(async () => {
    await node.props.onClick({ stopPropagation: () => {} });
  });
};

describe('AnonymousLinkDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listAnonymousLinks.mockResolvedValue({ links: [], limit: 20 });
    api.createAnonymousLink.mockResolvedValue(link('new'));
    api.revokeAnonymousLink.mockResolvedValue(undefined);
    api.confirm.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    keyHandlers = [];
    vi.stubGlobal('document', {
      addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => { if (type === 'keydown') keyHandlers.push(handler); },
      removeEventListener: (_type: string, handler: (event: KeyboardEvent) => void) => { keyHandlers = keyHandlers.filter(item => item !== handler); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the version the link will show (CA-9.5)', async () => {
    const { view } = await render();
    expect(textOf(view.root.findByProps({ id: 'anonymous-link-title' }))).toBe('Anonymous link · version v1');
  });

  it('creates a link for all visible versions when selected', async () => {
    const { view } = await render({ unlisted: true, versions: [version('1', false), version('2', true)] });
    const all = view.root.findAllByType('input').find(node => node.props.type === 'radio' && !node.props.checked)!;
    await act(async () => all.props.onChange());
    expect(text(view)).toContain('Private versions stay hidden');
    await click(button(view, 'Create link'));
    expect(api.createAnonymousLink).toHaveBeenCalledWith('1', true);
  });

  it('keeps its width explicit, since the theme turns max-w-lg into 20px (L-006)', async () => {
    const { view } = await render();
    const classes = view.root.findByProps({ role: 'dialog' }).props.className.split(' ');
    expect(classes).toContain('max-w-[32rem]');
    expect(classes).not.toContain('max-w-lg');
  });

  it('warns first when the pricing is listed, with the focus on the warning (CA-10.1, CA-10.2)', async () => {
    const { view, focus } = await render();
    const alert = view.root.findByProps({ role: 'alertdialog' });
    expect(focus).toHaveBeenCalled();
    const content = textOf(alert);
    expect(content).toContain("SPHERE's search");
    expect(content).toContain("organization's page");
    expect(content).toContain('anonymity');
    const labels = alert.findAll(node => node.type === 'button').map(textOf);
    expect(labels).toEqual(['Make unlisted and create link', 'Create link anyway', 'Cancel']);
    expect(api.createAnonymousLink).not.toHaveBeenCalled();
  });

  it('closes without creating anything on Cancel or Escape (CA-10.3)', async () => {
    const { view, onClose } = await render();
    await click(button(view, 'Cancel'));
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(api.createAnonymousLink).not.toHaveBeenCalled();
  });

  it('creates the link and leaves the pricing listed with "Create link anyway" (CA-10.4)', async () => {
    const { view, onMakeUnlisted } = await render();
    await click(button(view, 'Create link anyway'));
    expect(api.createAnonymousLink).toHaveBeenCalledWith('1');
    expect(onMakeUnlisted).not.toHaveBeenCalled();
  });

  it('unlists the pricing before creating the link (CA-10.5)', async () => {
    const order: string[] = [];
    const { view } = await render({
      onMakeUnlisted: vi.fn(async () => { order.push('unlist'); return '"e"'; }),
    });
    api.createAnonymousLink.mockImplementation(async () => { order.push('create'); return link('new'); });
    await click(button(view, 'Make unlisted and create link'));
    expect(order).toEqual(['unlist', 'create']);
  });

  it('shows the error and creates nothing when unlisting fails (CA-10.6)', async () => {
    const { view } = await render({ onMakeUnlisted: vi.fn().mockRejectedValue({ status: 412, message: 'This pricing changed since you loaded it.' }) });
    await click(button(view, 'Make unlisted and create link'));
    expect(view.root.findByProps({ role: 'alert' }).props.children).toContain('changed');
    expect(api.createAnonymousLink).not.toHaveBeenCalled();
  });

  it('asks nothing when the pricing is already unlisted (CA-10.7)', async () => {
    const { view } = await render({ unlisted: true });
    expect(view.root.findAll(node => node.props.role === 'alertdialog')).toHaveLength(0);
    await click(button(view, 'Create link'));
    expect(api.createAnonymousLink).toHaveBeenCalledWith('1');
  });

  it('says SPHERE could not be reached when the network fails, not "Failed to fetch" (m4)', async () => {
    api.createAnonymousLink.mockRejectedValue(new TypeError('Failed to fetch'));
    const { view } = await render({ unlisted: true });
    await click(button(view, 'Create link'));
    expect(view.root.findByProps({ role: 'alert' }).props.children).toBe('SPHERE could not be reached. Check your connection and try again.');
  });

  it('never shares a private version as it is, and makes it visible step by step with each new ETag (CA-11.1, CA-11.2, T11)', async () => {
    const order: string[] = [];
    const onMakeUnlisted = vi.fn(async () => { order.push('unlist'); return '"etag.2"'; });
    const onMakeVersionVisible = vi.fn(async (_version: VersionData, etag: string | undefined) => { order.push(`show ${etag}`); return '"etag.3"'; });
    api.createAnonymousLink.mockImplementation(async () => { order.push('create'); return link('new'); });
    const selected = version('2', true);
    const { view } = await render({ selected, versions: [version('1', false), selected], onMakeUnlisted, onMakeVersionVisible });
    expect(text(view)).toContain('is private');
    expect(buttons(view).some(node => textOf(node) === 'Create link')).toBe(false);

    await click(button(view, 'Make this version unlisted and create link'));
    expect(order).toEqual(['unlist', 'show "etag.2"', 'create']);
    expect(onMakeVersionVisible.mock.calls[0][0]).toBe(selected);
  });

  it('does not touch a private version when the pricing has as many links as it may (I1)', async () => {
    api.listAnonymousLinks.mockResolvedValue({ links: [link('a')], limit: 1 });
    const selected = version('2', true);
    const { view } = await render({ selected, versions: [selected] });
    expect(button(view, 'Make this version unlisted and create link').props.disabled).toBe(true);
  });

  it('says what it already changed when the link cannot be created, and stops calling the version private (I1)', async () => {
    api.createAnonymousLink.mockRejectedValue({ status: 409, message: 'CONFLICT: This pricing has 20 anonymous links.' });
    const selected = version('2', true);
    const { view, onMakeUnlisted, onMakeVersionVisible } = await render({ selected, versions: [version('1', false), selected] });
    await click(button(view, 'Make this version unlisted and create link'));
    expect(onMakeUnlisted).toHaveBeenCalledOnce();
    expect(onMakeVersionVisible).toHaveBeenCalledOnce();
    expect(view.root.findByProps({ role: 'alert' }).props.children).toBe(
      'The pricing is now unlisted and version v2 is now visible to anyone with the link, but the link was not created: CONFLICT: This pricing has 20 anonymous links.'
    );
    expect(text(view)).not.toContain('is private');
    // It can try again, without changing anything else.
    expect(button(view, 'Create link').props.disabled).toBe(false);
  });

  it('says the pricing is now unlisted when only the link failed after unlisting it (I1)', async () => {
    api.createAnonymousLink.mockRejectedValue({ status: 503, message: '' });
    const { view } = await render();
    await click(button(view, 'Make unlisted and create link'));
    expect(view.root.findByProps({ role: 'alert' }).props.children).toBe(
      'The pricing is now unlisted, but the link was not created: something went wrong.'
    );
    expect(view.root.findAll(node => node.props.role === 'alertdialog')).toHaveLength(0);
  });

  it('takes the focus when it opens without a warning (M3)', async () => {
    const { focusDialog } = await render({ unlisted: true });
    expect(focusDialog).toHaveBeenCalled();
    const selected = version('2', true);
    expect((await render({ selected, versions: [selected] })).focusDialog).toHaveBeenCalled();
  });

  it('cancels a private version without changing anything (CA-11.2)', async () => {
    const selected = version('2', true);
    const { view, onMakeUnlisted, onMakeVersionVisible, onClose } = await render({ selected, versions: [selected] });
    await click(button(view, 'Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onMakeUnlisted).not.toHaveBeenCalled();
    expect(onMakeVersionVisible).not.toHaveBeenCalled();
  });

  it('shows the new link, copies it and says so to screen readers, with the anonymity notice (CA-12.1, CA-12.6)', async () => {
    const { view, focusLink } = await render({ unlisted: true });
    expect(text(view)).toContain(ANONYMITY_NOTICE.slice(0, 40));
    await click(button(view, 'Create link'));
    // The button that created it is gone, so the focus moves to the link.
    expect(focusLink).toHaveBeenCalled();
    const input = view.root.findByProps({ 'aria-label': 'Anonymous pricing link' });
    expect(input.props.value).toBe(`http://localhost/a/${link('new').token}`);
    const status = () => view.root.findByProps({ role: 'status' }).props.children;
    expect(status()).toBe('');
    await act(async () => {
      await view.root.findByProps({ 'aria-label': 'Copy anonymous link' }).props.onClick();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`http://localhost/a/${link('new').token}`);
    expect(status()).toBe('Anonymous link copied to clipboard');
  });

  it('lists the links with their version and date, suspended ones marked, and revokes one after confirming (CA-13.1, CA-13.2)', async () => {
    api.listAnonymousLinks.mockResolvedValue({ links: [link('a'), link('b', false)], limit: 20 });
    const { view } = await render({ unlisted: true });
    const rows = view.root.findAllByType('li');
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0])).toContain('Version v1');
    expect(textOf(rows[0])).toContain('Created Feb 3, 2026');
    expect(text(view)).toContain('Suspended while the version is private');
    const controls = view.root.findAll(node => node.type === 'button' && /^(Copy|Revoke) the link/.test(node.props['aria-label'] ?? ''));
    expect(controls).toHaveLength(4);
    for (const control of controls) expect(control.props.className).toContain('cursor-pointer');
    await act(async () => {
      rows[0].findByProps({ title: 'Revoke link' }).props.onClick();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(api.confirm).toHaveBeenCalled();
    expect(api.revokeAnonymousLink).toHaveBeenCalledWith('a');
    expect(view.root.findAllByType('li')).toHaveLength(1);
  });

  it('still closes with Escape once a link is created, but not while the revoke confirmation is open', async () => {
    api.listAnonymousLinks.mockResolvedValue({ links: [link('a')], limit: 20 });
    let answer: (value?: unknown) => void = () => {};
    api.confirm.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const { view, onClose } = await render({ unlisted: true });
    await click(button(view, 'Create link'));
    act(() => view.root.findAllByType('li')[1].findByProps({ title: 'Revoke link' }).props.onClick());
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      answer();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await pressEscape();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not show the links to whoever may not see them (CA-13.4)', async () => {
    api.listAnonymousLinks.mockRejectedValue({ status: 403 });
    const { view } = await render({ unlisted: true });
    expect(view.root.findAllByType('li')).toHaveLength(0);
    expect(text(view)).not.toContain('Links of this pricing');
  });

  it('stops offering a new link once the pricing has as many as it may (T20)', async () => {
    api.listAnonymousLinks.mockResolvedValue({ links: [link('a')], limit: 1 });
    const { view } = await render({ unlisted: true });
    expect(button(view, 'Create link').props.disabled).toBe(true);
  });
});
