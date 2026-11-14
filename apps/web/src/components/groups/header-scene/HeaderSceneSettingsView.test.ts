import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import HeaderSceneSettingsView from './HeaderSceneSettingsView';
const saved = { style: 'scene', scene: 'eco-city', time: 'day' } as const;
const render = (overrides: Partial<ComponentProps<typeof HeaderSceneSettingsView>> = {}) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(HeaderSceneSettingsView, {
        groupName: 'Goa Friends Trip',
        value: saved,
        saved,
        preferences: { motion: true, followPointer: true },
        preview: createElement('span', null, 'Scene preview'),
        onChange: () => {},
        onPreferences: () => {},
        onSave: () => {},
        onDiscard: () => {},
        ...overrides,
      }),
    ),
  );
it('keeps Save and Discard disabled for the saved choices and explains who sees what', () => {
  const html = render(),
    words = text(html);
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Save changes<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Discard<\/button>/);
  for (const copy of [
    'Who sees what',
    'Everyone in the Group',
    'Only you',
    'Anyone in the Group',
    'Activity shows who changed it',
    'reduced motion',
  ])
    expect(words).toContain(copy);
});
const selected = (html: string) =>
  [...html.matchAll(/<input\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('type="radio"') && /\schecked(?:=|\s|>)/.test(tag))
    .map((tag) => /\svalue="([^"]*)"/.exec(tag)?.[1]);
const disabledButton = (html: string, label: string) => {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    ([, , body]) => text(body) === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return /\sdisabled(?:=|\s|$)/.test(button[1]);
};
it('announces the saved scene, time and browser choices through radios and switches', () => {
  const html = render();
  expect(selected(html)).toEqual(['scene', 'eco-city', 'day']);
  expect([...html.matchAll(/<input\b[^>]*role="switch"[^>]*>/g)]).toHaveLength(2);
  expect(text(html)).toContain('Follow the pointer');
});
it('keeps remembered choices on Classic and disables its scene controls', () => {
  const classic = { style: 'classic', scene: 'mountain-village', time: 'night' } as const;
  const html = render({ value: classic, saved: classic });
  expect(selected(html)).toEqual(['classic', 'mountain-village', 'night']);
  expect(html).toMatch(/<fieldset\b[^>]*disabled[^>]*aria-label="Scene options"/);
  expect(disabledButton(html, 'Save changes')).toBe(true);
});
it('enables Save and Discard when a Group choice differs, but not for browser preferences alone', () => {
  const changed = render({ value: { ...saved, time: 'night' } });
  expect(disabledButton(changed, 'Save changes')).toBe(false);
  expect(disabledButton(changed, 'Discard')).toBe(false);
  expect(
    disabledButton(
      render({ preferences: { motion: false, followPointer: false } }),
      'Save changes',
    ),
  ).toBe(true);
});
it('keeps the failed choice selected and says it was not saved', () => {
  const html = render({ value: { ...saved, time: 'night' }, error: 'Connection failed.' });
  expect(selected(html)).toEqual(['scene', 'eco-city', 'night']);
  expect(text(html)).toContain('Header not saved. Connection failed. Your choices are kept.');
  expect(html).toContain('role="alert"');
  expect(disabledButton(html, 'Save changes')).toBe(false);
});
