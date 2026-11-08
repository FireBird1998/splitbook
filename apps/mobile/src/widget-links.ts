import type { WidgetTarget } from '@splitbook/shared/balances-widget';
export const widgetScheme = () =>
  process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? 'splitbook-dev'
    : process.env.EXPO_PUBLIC_APP_ENV === 'staging'
      ? 'splitbook-staging'
      : 'splitbook';
export function widgetLink(target: WidgetTarget, developmentServer?: string) {
  const url = new URL(`${widgetScheme()}://widget/${target}`);
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
