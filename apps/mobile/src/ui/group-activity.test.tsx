import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyActivity, type ActivityEvent, type ActivityState } from '../data/activity';
import { GroupActivity } from './group-activity';
import { refreshedLabel } from './refresh-feedback';

// #222: the Activity destination's time, offline wording, page controls and sliding window,
// rendered. Fictional people and events only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001';
const groupId = 'b00000000000000000000001';
// Wednesday 30 September 2026, midday on this device.
const now = new Date(2026, 8, 30, 12).getTime();
const at = new Date(2026, 8, 30, 10, 42).getTime();
const hex = (prefix: string, index: number) => `${prefix}${String(index).padStart(23, '0')}`;
/** Fictional event `number`, newest first, all on one day. */
const event = (number: number): ActivityEvent => ({
  _id: hex('e', number),
  group: groupId,
  type: 'expense_added',
  actor: { _id: you, name: 'Alex Rivera' },
  createdAt: new Date(2026, 8, 30, 11, 0).toISOString(),
  metadata: { description: `Fictional event ${number}`, amount: 10, currency: 'INR' },
});
const events = Array.from({ length: 120 }, (_, index) => event(index + 1));
const activity = (state: Partial<ActivityState> = {}): ActivityState => ({
  ...emptyActivity(),
  groupId,
  status: 'ready',
  events: events.slice(0, 20),
  pagination: { page: 1, limit: 20, total: 120, totalPages: 6 },
  refreshedAt: at,
  ...state,
});
/** The window from page `first` to page `first + 4`, as the controller shows it. */
const window = (first: number, state: Partial<ActivityState> = {}) =>
  activity({
    events: events.slice((first - 1) * 20, (first + 4) * 20),
    firstPage: first,
    pagination: { page: first + 4, limit: 20, total: 120, totalPages: 6 },
    ...state,
  });

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const pressables = (root: ReactTestInstance) => root.findAll((node) => isHost(node, 'Pressable'));
const buttons = (root: ReactTestInstance) =>
  pressables(root).map((node) => node.props.accessibilityLabel as string);
const button = (root: ReactTestInstance, label: string) =>
  pressables(root).filter((node) => node.props.accessibilityLabel === label);
const rowIndex = (root: ReactTestInstance, number: number) =>
  buttons(root).findIndex((label) => label?.includes(`Fictional event ${number},`));

function render(props: Partial<Parameters<typeof GroupActivity>[0]> = {}) {
  const calls = {
    onRetry: vi.fn(),
    onMore: vi.fn(),
    onLoadNewer: vi.fn(),
    onShift: vi.fn(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };
  const all = {
    state: activity(),
    currentUserId: you,
    currency: 'INR',
    offline: false,
    now,
    ...calls,
    ...props,
  };
  act(() => {
    screen = create(<GroupActivity {...all} />);
  });
  return {
    root: screen!.root,
    ...calls,
    update: (next: Partial<Parameters<typeof GroupActivity>[0]>) =>
      act(() => screen!.update(<GroupActivity {...all} {...next} />)),
  };
}

describe('when Activity’s events were read (#222, the loading-state audit)', () => {
  it('says “Updated hh:mm” for events read in this session, online and offline', () => {
    const { root, update } = render();
    expect(text(root)).toContain(`Updated ${refreshedLabel(at)}`);
    update({ offline: true });
    expect(text(root)).toContain(`Updated ${refreshedLabel(at)}`);
    expect(text(root)).not.toContain('Saved');
  });

  it('says “Saved hh:mm” only for this phone’s copy, and nothing more while it is read again', () => {
    const { root, update } = render({ state: activity({ status: 'loading', restored: true }) });
    expect(text(root)).toContain(`Saved ${refreshedLabel(at)}`);
    expect(text(root)).not.toContain('refreshing');
    update({ state: activity({ status: 'loading' }) });
    expect(text(root)).toContain(`Updated ${refreshedLabel(at)}`);
    expect(text(root)).not.toContain('refreshing');
  });

  it('never says Activity hasn’t been opened: offline with nothing to show, it isn’t saved on this phone (#280 item 2)', () => {
    const { root, onRetry } = render({
      offline: true,
      state: activity({
        status: 'error',
        events: [],
        pagination: null,
        refreshedAt: null,
        message: 'This view was not saved on this device. Connect to load it.',
      }),
    });
    expect(text(root)).toContain(
      'This Group’s activity isn’t saved on this phone. Connect to load it.',
    );
    expect(text(root)).not.toContain('hasn’t been opened');
    expect(text(root)).not.toContain('Saved');
    act(() => button(root, 'Try again')[0].props.onPress());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Load older and Load newer (#222, M7-2)', () => {
  it('loads newer above events that have slid past the newest page, as Load older does below them', () => {
    const { root, onLoadNewer, update } = render({ state: window(1) });
    expect(buttons(root)).not.toContain('Load newer activity');
    update({ state: window(2) });
    // Above the events, and TalkBack names it.
    expect(buttons(root).indexOf('Load newer activity')).toBeGreaterThanOrEqual(0);
    expect(buttons(root).indexOf('Load newer activity')).toBeLessThan(rowIndex(root, 21));
    expect(button(root, 'Load newer activity')[0].props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    act(() => button(root, 'Load newer activity')[0].props.onPress());
    expect(onLoadNewer).toHaveBeenCalledOnce();
  });

  it('loads newer busy in its own place, and keeps the events with a retry when it fails', () => {
    const { root, update } = render({ state: window(2, { newerStatus: 'loading' }) });
    const busy = button(root, 'Loading newer activity…');
    expect(busy).toHaveLength(1);
    expect(busy[0].props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(buttons(root).indexOf('Loading newer activity…')).toBeLessThan(rowIndex(root, 21));
    expect(text(root)).toContain('Fictional event 21');
    update({ state: window(2, { newerStatus: 'error' }) });
    const alert = root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children.join('')).toBe(
      'Couldn’t load newer activity. The events shown are still here.',
    );
    expect(button(root, 'Try loading newer activity')).toHaveLength(1);
    expect(text(root)).toContain('Fictional event 21');
  });

  it('keeps Load older and Load newer in place, disabled, while the events shown are read again', () => {
    // Pages 2 to 6 of 7: both ends are offered.
    const pagination = { page: 6, limit: 20, total: 130, totalPages: 7 };
    const { root, update } = render({ state: window(2, { status: 'loading', pagination }) });
    for (const label of ['Load newer activity', 'Load older activity']) {
      expect(button(root, label)).toHaveLength(1);
      expect(button(root, label)[0].props.accessibilityState).toEqual({
        disabled: true,
        busy: false,
      });
    }
    update({ state: window(2, { pagination }) });
    for (const label of ['Load newer activity', 'Load older activity'])
      expect(button(root, label)[0].props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      });
  });
});

describe('when the newest page drops (#222, #215)', () => {
  const layout = (node: ReactTestInstance, y: number) =>
    act(() =>
      node.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 390, height: 60 } } }),
    );
  /** The host Views that report the layout of an event's row, its day and the list. */
  const places = (root: ReactTestInstance, number: number) => {
    const found: ReactTestInstance[] = [];
    let node: ReactTestInstance | null = root.find(
      (candidate) =>
        isHost(candidate, 'Pressable') &&
        String(candidate.props.accessibilityLabel).includes(`Fictional event ${number},`),
    );
    while (node && found.length < 3) {
      if (isHost(node, 'View') && node.props.onLayout) found.push(node);
      node = node.parent;
    }
    const [row, day, list] = found;
    return { row, day, list };
  };
  /** Lays the window out as a phone would: the list at `listY`, each row 60 high under its day. */
  const lay = (root: ReactTestInstance, first: number, listY: number) => {
    const { day, list } = places(root, first * 20 - 19);
    layout(list, listY);
    layout(day, 0);
    for (let number = first * 20 - 19; number <= (first + 4) * 20; number += 1)
      layout(places(root, number).row, 30 + (number - (first * 20 - 19)) * 60);
  };
  const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it('keeps the event on screen in its place: the view moves up by the events that went', async () => {
    const { root, onShift, update } = render({ state: window(1) });
    lay(root, 1, 200);
    await tick();
    expect(onShift).not.toHaveBeenCalled();
    // Load older read page 6: pages 2 to 6 show, below Load newer.
    update({ state: window(2) });
    lay(root, 2, 260);
    await tick();
    // Event 21 was at 200 + 30 + 20 × 60 = 1430; it is now at 260 + 30 = 290.
    expect(onShift).toHaveBeenCalledExactlyOnceWith(290 - 1430);
    // Only the slide's own layout moves the view.
    layout(places(root, 21).list, 300);
    await tick();
    expect(onShift).toHaveBeenCalledOnce();
  });

  it('keeps the event on screen when Load newer brings the newest page back: the view moves down by the events that came', async () => {
    const { root, onShift, update } = render({ state: window(2) });
    lay(root, 2, 260);
    await tick();
    update({ state: window(1) });
    lay(root, 1, 200);
    await tick();
    expect(onShift).toHaveBeenCalledExactlyOnceWith(1430 - 290);
  });

  it('moves nothing when the events are read anew from the first page, with none of those shown', async () => {
    const { root, onShift, update } = render({ state: window(2) });
    lay(root, 2, 260);
    const others = events.map((item) => ({ ...item, _id: `f${item._id.slice(1)}` }));
    update({
      state: activity({
        events: others.slice(0, 20),
        firstPage: 1,
        pagination: { page: 1, limit: 20, total: 120, totalPages: 6 },
      }),
    });
    const { row, day, list } = places(root, 1);
    layout(list, 200);
    layout(day, 0);
    layout(row, 30);
    await tick();
    expect(onShift).not.toHaveBeenCalled();
  });
});

// The UI review of 90f5c21 (#222): what a row draws again (D6), the page controls after a failed
// read, the header at large text, and a server's failure with nothing shown.
describe('a row is drawn again only when what it says changes (#222, D6)', () => {
  /** The row naming `description`, by its spoken label. */
  const row = (root: ReactTestInstance, description: string) =>
    pressables(root).filter((node) =>
      String(node.props.accessibilityLabel).includes(`${description},`),
    );

  it('shows an event read again with new words under the same id', () => {
    const { root, update } = render();
    expect(row(root, 'Fictional event 1')).toHaveLength(1);
    // The same event, read again as a new object: what it says now shows, spoken and drawn.
    const renamed = {
      ...events[0],
      metadata: { ...events[0].metadata, description: 'Lake dinner' },
    };
    update({ state: activity({ events: [renamed, ...events.slice(1, 20)] }) });
    expect(row(root, 'Fictional event 1')).toHaveLength(0);
    expect(row(root, 'Lake dinner')).toHaveLength(1);
    expect(text(row(root, 'Lake dinner')[0])).toContain('Lake dinner');
  });

  it('opens an event only once read: rows are disabled while read again, and enabled when it lands', () => {
    const { root, update } = render({ state: activity({ status: 'loading' }) });
    for (const shown of [row(root, 'Fictional event 1')[0], row(root, 'Fictional event 20')[0]]) {
      expect(shown.props.disabled).toBe(true);
      expect(shown.props.accessibilityState).toEqual({ disabled: true });
    }
    update({ state: activity() });
    for (const shown of [row(root, 'Fictional event 1')[0], row(root, 'Fictional event 20')[0]]) {
      expect(shown.props.disabled).toBe(false);
      expect(shown.props.accessibilityState).toEqual({ disabled: false });
    }
  });
});

describe('Load older and Load newer stay in place (#222, as #219)', () => {
  // Pages 2 to 6 of 7: both ends are offered.
  const pagination = { page: 6, limit: 20, total: 130, totalPages: 7 };
  const state = (label: string) => button(screen!.root, label)[0]?.props.accessibilityState;

  it('keeps both, disabled, when reading the events shown again failed', () => {
    const { root } = render({
      state: window(2, { status: 'error', pagination, message: 'Could not refresh Activity.' }),
    });
    expect(text(root)).toContain('Couldn’t update Activity');
    for (const label of ['Load newer activity', 'Load older activity']) {
      expect(button(root, label)).toHaveLength(1);
      expect(state(label)).toEqual({ disabled: true, busy: false });
    }
    // In their places: above the first event shown, and below the last.
    expect(buttons(root).indexOf('Load newer activity')).toBeLessThan(rowIndex(root, 21));
    expect(buttons(root).indexOf('Load older activity')).toBeGreaterThan(rowIndex(root, 120));
  });

  it('keeps the other one disabled while one of them reads', () => {
    const { update } = render({ state: window(2, { pagination, moreStatus: 'loading' }) });
    expect(text(screen!.root)).toContain('Loading older activity…');
    expect(state('Load newer activity')).toEqual({ disabled: true, busy: false });
    update({ state: window(2, { pagination, newerStatus: 'loading' }) });
    expect(state('Loading newer activity…')).toEqual({ disabled: true, busy: true });
    expect(state('Load older activity')).toEqual({ disabled: true, busy: false });
    update({ state: window(2, { pagination }) });
    expect(state('Load newer activity')).toEqual({ disabled: false, busy: false });
    expect(state('Load older activity')).toEqual({ disabled: false, busy: false });
  });
});
