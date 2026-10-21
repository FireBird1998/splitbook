import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MoneyInputBase } from './MoneyInput';

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
  expect(input().props.value).toBe('1842.5');
  await act(async () => renderer.update(field('2302.5')));
  expect(input().props.value).toBe('2302.5');
  await act(async () => input().props.onBlur({}));
  expect(input().props.value).toBe('2,302.50');
});
