import type { WidgetTarget } from '@splitbook/shared/balances-widget';
export const widgetScheme = () =>
  process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? 'splitbook-dev'
    : process.env.EXPO_PUBLIC_APP_ENV === 'staging'
      ? 'splitbook-staging'
      : 'splitbook';
export function widgetLink(target: WidgetTarget, developmentServer?: string) {
  const path =
    typeof target === 'string'
      ? target
      : target.kind === 'setup'
        ? `setup/${target.widgetId}`
        : `group/${target.groupId}/${target.kind}`;
  const url = new URL(`${widgetScheme()}://widget/${path}`);
  if (process.env.EXPO_PUBLIC_APP_ENV === 'development' && developmentServer)
    url.searchParams.set(
      '__expo_url',
      developmentServer.startsWith('http') ? developmentServer : `http://${developmentServer}`,
    );
  return url.toString();
}
export function widgetLinkTarget(url: string): WidgetTarget | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== `${widgetScheme()}:` ||
      parsed.hostname !== 'widget' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const group = /^\/group\/([a-f0-9]{24})\/(group|settle|expense)$/.exec(parsed.pathname);
    if (group) return { kind: group[2] as 'group' | 'settle' | 'expense', groupId: group[1] };
    const setup = /^\/setup\/([1-9][0-9]*)$/.exec(parsed.pathname);
    if (setup && Number.isSafeInteger(Number(setup[1])))
      return { kind: 'setup', widgetId: Number(setup[1]) };
    return (
      (
        {
          '/home': 'home',
          '/review': 'review',
          '/sign-in': 'sign-in',
          '/create-group': 'create-group',
        } as const
      )[parsed.pathname as '/home'] ?? null
    );
  } catch {
    return null;
  }
}
