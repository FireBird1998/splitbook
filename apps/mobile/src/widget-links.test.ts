import { afterEach, expect, it, vi } from 'vitest';
import { widgetLink, widgetLinkTarget } from './widget-links';
afterEach(() => vi.unstubAllEnvs());
it('builds dev-client cold links with a local Metro destination, and plain release links', () => {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
  expect(widgetLink('review', '127.0.0.1:8083')).toBe(
    'splitbook-dev://widget/review?__expo_url=http%3A%2F%2F127.0.0.1%3A8083',
  );
  expect(widgetLinkTarget('splitbook-dev://widget/review')).toBe('review');
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
  expect(widgetLink('home')).toBe('splitbook://widget/home');
});
it('accepts only this build’s fixed widget targets', () => {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
  for (const url of [
    'splitbook://widget/home',
    'https://widget/home',
    'splitbook-dev://person@widget/home',
    'splitbook-dev://widget:99/home',
    'splitbook-dev://widget/home?next=review',
    'splitbook-dev://widget/expense',
    'not a link',
  ])
    expect(widgetLinkTarget(url)).toBeNull();
  expect(widgetLinkTarget('splitbook-dev://widget/sign-in')).toBe('sign-in');
});
it('round trips fixed Group destinations and setup without arbitrary route inputs', () => {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
  for (const target of [
    { kind: 'group', groupId: 'b00000000000000000000001' },
    { kind: 'settle', groupId: 'b00000000000000000000001' },
    { kind: 'expense', groupId: 'b00000000000000000000001' },
    { kind: 'setup', widgetId: 7 },
  ] as const)
    expect(widgetLinkTarget(widgetLink(target))).toEqual(target);
  expect(widgetLinkTarget('splitbook-dev://widget/group/not-an-id/settle')).toBeNull();
});

it('round trips a payment identity without amounts or names', () => {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
  const target = {
    kind: 'settle' as const,
    groupId: 'b00000000000000000000001',
    payment: { from: 'a00000000000000000000001', to: 'a00000000000000000000003', currency: 'INR' },
  };
  expect(widgetLinkTarget(widgetLink(target))).toEqual(target);
});

it('round trips the blank Record payment destination without changing existing Settle up links', () => {
  const target = { kind: 'record-payment' as const, groupId: 'b00000000000000000000001' };
  expect(widgetLinkTarget(widgetLink(target))).toEqual(target);
  expect(widgetLinkTarget(widgetLink({ kind: 'settle', groupId: target.groupId }))).toEqual({
    kind: 'settle',
    groupId: target.groupId,
  });
});
