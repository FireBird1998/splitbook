import { createElement, useState, type ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MoneyInputBase, MoneyTextField } from './MoneyInput';

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it('shows a new controlled amount while focused, rather than keeping an earlier suggestion (#773)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const field = (value: string) =>
    createElement(MoneyInputBase, { currency: 'INR', value, onValueChange: () => {} });
  await act(async () => {
    renderer = create(field('1842.5'));
  });
  const input = () => renderer.root.findByType('input');
  await act(async () => input().props.onFocus({}));
  expect(input().props.value).toBe('1,842.50');
  await act(async () => renderer.update(field('2302.5')));
  expect(input().props.value).toBe('2302.5');
  await act(async () => input().props.onBlur({}));
  expect(input().props.value).toBe('2,302.50');
});

const fields: Array<
  [
    string,
    ComponentType<{ value: string; currency: string; onValueChange: (value: string) => void }>,
  ]
> = [
  ['MoneyInputBase', MoneyInputBase],
  ['MoneyTextField', MoneyTextField],
];
for (const [name, Field] of fields) {
  it.each([
    ['EUR', '500', '500.00', '300'],
    ['EUR', '1842.5', '1,842.50', '2000'],
    ['JPY', '1200', '1,200', '800'],
  ])(
    `${name}: preserves Tab's selected %s amount so typing replaces it`,
    async (currency, initial, shown, replacement) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const changed = vi.fn();
      function Form() {
        const [value, setValue] = useState(initial);
        return createElement(Field, {
          currency,
          value,
          onValueChange: (next: string) => {
            changed(next);
            setValue(next);
          },
        });
      }
      await act(async () => {
        renderer = create(createElement(Form));
      });
      const input = () => renderer.root.findByType('input');
      expect(input().props.value).toBe(shown);
      // Tab selects the input's displayed text. Rewriting value during focus destroys that
      // native selection; the real-keyboard journey verifies the browser and POST body too.
      await act(async () =>
        input().props.onFocus({
          target: { value: shown, selectionStart: 0, selectionEnd: shown.length },
        }),
      );
      expect(input().props.value).toBe(shown);
      await act(async () => input().props.onChange({ target: { value: replacement } }));
      expect(input().props.value).toBe(replacement);
      expect(changed).toHaveBeenLastCalledWith(replacement);
    },
  );
  it(`${name}: does not move a clicked caret by rewriting the displayed amount`, async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => {
      renderer = create(
        createElement(Field, { currency: 'EUR', value: '1842.5', onValueChange: () => {} }),
      );
    });
    const input = () => renderer.root.findByType('input');
    await act(async () =>
      input().props.onFocus({ target: { value: '1,842.50', selectionStart: 3, selectionEnd: 3 } }),
    );
    expect(input().props.value).toBe('1,842.50');
  });
}
