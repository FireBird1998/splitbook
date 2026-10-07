import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFileWindow } from '../test-utils/native';

// #127: the compact offline, not-available and refreshing states.
setFileWindow({ width: 360, height: 640 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { NotAvailableOffline, OfflineNotice } = await import('./offline-notice');
const { RefreshStatus } = await import('./financial-views');
const { GroupShell } = await import('./group-shell');
const { refreshedLabel } = await import('./refresh-feedback');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
function render(element: ReactElement) {
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
}
const hosts = (root: ReactTestInstance, match: (props: Record<string, unknown>) => boolean) =>
  root.findAll((node) => typeof node.type === 'string' && match(node.props));
const byRole = (root: ReactTestInstance, role: string, label?: string) =>
  hosts(
    root,
    (p) => p.accessibilityRole === role && (label === undefined || p.accessibilityLabel === label),
  );
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
const savedAt = new Date(2026, 8, 30, 10, 42).getTime();

describe('offline banner', () => {
  it('is one polite banner saying when what’s shown was saved, with Try again where asked', () => {
    const onRetry = vi.fn();
    const root = render(
      <OfflineNotice
        state={{ active: true, refreshedAt: savedAt, message: null }}
        onRetry={onRetry}
      />,
    );
    const [banner] = byRole(root, 'summary');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(text(banner)).toBe(
      `You’re offlineWhat’s shown was saved on this device at ${refreshedLabel(savedAt)} and may have changed since.Try again`,
    );
    act(() => byRole(root, 'button', 'Try again')[0].props.onPress());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says nothing online, and interrupts only for a storage problem', () => {
    expect(
      render(<OfflineNotice state={{ active: false, refreshedAt: null, message: null }} />)
        .children,
    ).toEqual([]);
    const root = render(
      <OfflineNotice
        state={{ active: false, refreshedAt: null, message: 'Could not save this view.' }}
      />,
    );
    expect(byRole(root, 'summary')).toHaveLength(0);
    expect(text(byRole(root, 'alert')[0])).toBe('Could not save this view.');
    expect(text(root)).toBe('Could not save this view.');
  });
});

describe('not available offline', () => {
  it('names the state as a heading, explains it and offers Try again', () => {
    const onRetry = vi.fn();
    const root = render(
      <NotAvailableOffline message="Lisbon Offsite hasn’t been opened here." onRetry={onRetry} />,
    );
    expect(byRole(root, 'header').map(text)).toEqual(['Not available offline']);
    expect(text(root)).toContain('Lisbon Offsite hasn’t been opened here.');
    act(() => byRole(root, 'button', 'Try again')[0].props.onPress());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('refresh status', () => {
  // What is shown says when it was read; the status says only what is happening (#332).
  it('reads “Refreshing…”, or “Checking…” for the saved Home at cold start', () => {
    expect(text(render(<RefreshStatus visible />))).toBe('Refreshing…');
    expect(text(render(<RefreshStatus visible checking />))).toBe('Checking…');
    expect(render(<RefreshStatus visible={false} />).children).toEqual([]);
  });

  it('draws a first load’s one progress bar under the Group’s top bar', () => {
    const props = {
      group: null,
      destination: 'expenses' as const,
      onDestination: vi.fn(),
      back: { label: 'Back to Home', onPress: vi.fn() },
      invite: { onPress: vi.fn(), disabled: false, offline: false },
      onMembers: vi.fn(),
      onRefresh: vi.fn(),
      pull: { refreshing: false, onRefresh: vi.fn() },
    };
    const root = render(
      <GroupShell {...props} progress="Opening Maple House">
        {null}
      </GroupShell>,
    );
    const [bar] = byRole(root, 'progressbar', 'Opening Maple House');
    expect(bar.props.accessibilityState).toEqual({ busy: true });
    act(() => renderer?.update(<GroupShell {...props}>{null}</GroupShell>));
    expect(byRole(root, 'progressbar')).toHaveLength(0);
  });
});
