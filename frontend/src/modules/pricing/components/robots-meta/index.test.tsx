import type { ReactNode } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import RobotsMeta from '.';

// What Helmet would put in <head>, rendered in place so the test can read it.
vi.mock('react-helmet-async', () => ({ Helmet: ({ children }: { children: ReactNode }) => <>{children}</> }));

const metas = (element: JSX.Element) => {
  let view: ReactTestRenderer;
  act(() => {
    view = create(element);
  });
  return view!.root.findAllByType('meta').map(meta => ({ name: meta.props.name, content: meta.props.content }));
};

describe('RobotsMeta', () => {
  it('keeps an unlisted pricing out of search engines (CA-20.2)', () => {
    expect(metas(<RobotsMeta />)).toEqual([{ name: 'robots', content: 'noindex' }]);
  });

  it('keeps an anonymous page out of search engines and sends no Referer (CA-20.1)', () => {
    expect(metas(<RobotsMeta nofollow noReferrer />)).toEqual([
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ]);
  });
});
