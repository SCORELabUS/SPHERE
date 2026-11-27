import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import VisibilityOptions from '.';
import { PRICING_VISIBILITY_CHOICES, PRICING_VISIBILITY_DESCRIPTIONS } from '../../../core/utils/pricing-visibility';

function render(props: Partial<Parameters<typeof VisibilityOptions>[0]> = {}) {
  const onChange = vi.fn();
  let view: ReactTestRenderer;
  act(() => {
    view = create(<VisibilityOptions value="Public" onChange={onChange} {...props} />);
  });
  return { view: view!, onChange };
}

const radios = (view: ReactTestRenderer) => view.root.findAll(node => node.type === 'input' && node.props.type === 'radio');

describe('VisibilityOptions', () => {
  it('offers Public and Private by default, as collections need (CA-2.4)', () => {
    const { view } = render();
    expect(radios(view).map(radio => radio.props.value)).toEqual(['Public', 'Private']);
  });

  it('offers the pricing choices in order, with their help, and every choice is clickable (CA-1.1, CA-1.7)', () => {
    const { view, onChange } = render({ value: 'Unlisted', options: PRICING_VISIBILITY_CHOICES, descriptions: PRICING_VISIBILITY_DESCRIPTIONS });
    const inputs = radios(view);
    expect(inputs.map(radio => radio.props.value)).toEqual(['Public', 'Unlisted', 'Private']);
    expect(inputs.map(radio => radio.props.checked)).toEqual([false, true, false]);
    for (const input of inputs) expect(input.props.className).toContain('cursor-pointer');
    for (const label of view.root.findAllByType('label')) {
      expect(label.props.className).toContain('cursor-pointer');
      expect(label.props.className).not.toContain('text-slate-700');
    }
    expect(JSON.stringify(view.toJSON())).toContain('Anyone with the link');
    act(() => inputs[2].props.onChange({ target: { value: 'Private' } }));
    expect(onChange).toHaveBeenCalledWith('Private');
  });
});
