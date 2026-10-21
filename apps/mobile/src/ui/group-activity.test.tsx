import type { RowPlaces } from './return-scroll';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyActivity,
  parseActivityPage,
  type ActivityEvent,
  type ActivityState,
} from '../data/activity';
import {
  findHosts,
  flatten,
  largeTextWindows,
  layoutHeight,
  layoutWidth,
  middleCutEnd,
  unreadText,
} from '../test-utils/layout';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { mockDeviceLocale } from '../test-utils/device-locale';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { GroupActivity } from './group-activity';
import { ThemeContext } from './theme';
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

function render(
  props: Partial<Parameters<typeof GroupActivity>[0]> = {},
  /** Rendered in this scheme's colours, as large-text checks are in light and dark. */
  mode?: 'light' | 'dark',
) {
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
    screen = create(
      mode ? (
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupActivity {...all} />
        </ThemeContext.Provider>
      ) : (
        <GroupActivity {...all} />
      ),
    );
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
        unsaved: true,
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
it.each(['direct', 'after a placeholder'])(
  'records native row coordinates once inside a Card %s (#225 coordinate)',
  (shape) => {
    const reported = vi.fn<(rows: RowPlaces) => void>();
    const view = render({
      onRowsLayout: reported,
      ...(shape === 'after a placeholder'
        ? { state: activity({ status: 'loading', events: [], pagination: null }) }
        : {}),
    });
    if (shape === 'after a placeholder') view.update({ state: activity() });
    let node: ReactTestInstance | null = pressables(view.root).find((candidate) =>
      String(candidate.props.accessibilityLabel).includes('Fictional event 1,'),
    )!;
    const places: ReactTestInstance[] = [];
    while (node && places.length < 4) {
      if (isHost(node, 'View') && node.props.onLayout) places.push(node);
      node = node.parent;
    }
    let parent = places[1].parent;
    while (parent && typeof parent.type !== 'string') parent = parent.parent;
    expect(parent!.type).toBe(shape === 'direct' ? 'View' : 'AnimatedView');
    if (shape === 'after a placeholder')
      act(() =>
        parent!.props.onLayout({
          nativeEvent: { layout: { y: 1, height: 1500 } },
        }),
      );
    // Native direct days include the Card border; a day under the fade body starts at zero.
    act(() =>
      places.forEach((place, index) =>
        place.props.onLayout({
          nativeEvent: {
            layout: { y: [30, shape === 'direct' ? 1 : 0, 200, 80][index], height: 60 },
          },
        }),
      ),
    );
    expect(reported.mock.lastCall?.[0].get(events[0]._id)).toEqual({ top: 311, height: 60 });
  },
);

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

  it('opens an event on a tap or a screen reader’s activate, never on a drag that starts on its row (#665)', () => {
    // Three events: too few to scroll, so nothing takes a drag.
    const { root, onSelect } = render({
      state: activity({
        events: events.slice(0, 3),
        pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
      }),
    });
    const shown = row(root, 'Fictional event 2')[0];
    const landed = { pageX: 200, pageY: 380 };
    act(() => touchAlong(shown, [landed, { pageX: 200, pageY: 300 }, { pageX: 201, pageY: 130 }]));
    expect(onSelect).not.toHaveBeenCalled();
    act(() => touchAlong(shown, [landed, { pageX: 204, pageY: 382 }]));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(events[1]._id);
    act(() => activateWithScreenReader(shown));
    expect(onSelect).toHaveBeenCalledTimes(2);
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

describe('the header says when its events were read, whole, at any text size (#222)', () => {
  /** The section header: the host View holding the "Changes in this Group" title. */
  const header = (): ReactTestRendererJSON => {
    const search = (node: ReactTestRendererJSON): ReactTestRendererJSON | null => {
      for (const child of node.children ?? []) {
        if (typeof child === 'string') continue;
        // The title keeps a hair space to spare (#639).
        if (child.type === 'Text' && child.children?.join('') === 'Changes in this Group\u200a')
          return node;
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(screen!.toJSON() as ReactTestRendererJSON)!;
  };
  /**
   * A part as Android draws it: an overline in capitals. The layout estimate measures letters as
   * written, and "Changes in this Group" in capitals is about 8% wider (the UI review's 242dp at
   * 130%, not 224dp).
   */
  const drawn = (node: ReactTestRendererJSON): ReactTestRendererJSON => {
    const capitals = flatten(node.props.style).textTransform === 'uppercase';
    return {
      ...node,
      children: (node.children ?? []).map((child) =>
        typeof child === 'string' ? (capitals ? child.toUpperCase() : child) : drawn(child),
      ),
    };
  };
  // Today at 12:44 PM, as wide as a time of day gets; and an earlier day's time.
  const today = new Date();
  today.setHours(12, 44, 0, 0);
  const notes: [string, Partial<Parameters<typeof GroupActivity>[0]>][] = [
    [
      'Newest first',
      { state: activity({ status: 'loading', events: [], pagination: null, refreshedAt: null }) },
    ],
    [
      `Updated ${refreshedLabel(today.getTime())}`,
      { state: activity({ refreshedAt: today.getTime() }) },
    ],
    [`Updated ${refreshedLabel(at)}`, { state: activity() }],
    [`Saved ${refreshedLabel(at)}`, { state: activity({ restored: true }) }],
    // Offline, this phone's copy is a badge.
    [`Saved ${refreshedLabel(at)}`, { state: activity({ restored: true }), offline: true }],
  ];

  // The UI review of 90f5c21 measured "Changes in this Group" beside "Updated 10:42 AM" needing
  // about 383dp at 130% text, against 328dp of room on a 360dp phone: the time was cut off.
  it.each([
    [320, 1],
    [320, 1.3],
    [360, 1],
    [360, 1.3],
    [412, 1],
    [412, 1.3],
  ])('keeps the title and its time whole at %sdp and %s× text', (width, scale) => {
    setWindow({ width, fontScale: scale });
    // The screen's content is inset 16dp on each side.
    const room = width - 32;
    const heights: number[] = [];
    for (const [note, props] of notes) {
      render(props);
      const bar = header();
      expect(text(screen!.root)).toContain(note);
      const style = flatten(bar.props.style);
      const inner = room - 2 * Number(style.paddingHorizontal ?? 0);
      const parts = (bar.children ?? [])
        .filter((child): child is ReactTestRendererJSON => typeof child !== 'string')
        .map(drawn);
      expect(parts).toHaveLength(2);
      // Each fits on a line of its own, and side by side only where both fit.
      for (const part of parts) expect(layoutWidth(part, scale, inner)).toBeLessThanOrEqual(inner);
      if (style.flexDirection === 'row')
        expect(
          parts.reduce((sum, part) => sum + layoutWidth(part, scale, inner), 0) +
            Number(style.columnGap ?? style.gap ?? 0),
        ).toBeLessThanOrEqual(inner);
      heights.push(layoutHeight(drawn(bar), scale, room));
      act(() => screen?.unmount());
      screen = null;
    }
    // The note's line is as tall whatever it says, so the events below never move as it changes:
    // "Newest first" to a time, or a Saved badge to "Updated".
    expect(new Set(heights).size).toBe(1);
  });
});

describe('offline with nothing shown (#222, the loading-state audit)', () => {
  it('says the server couldn’t complete the request when it answered, never that nothing is saved', () => {
    const { root } = render({
      offline: true,
      state: activity({
        status: 'error',
        events: [],
        pagination: null,
        refreshedAt: null,
        message: 'The server could not complete this request. Please try again.',
      }),
    });
    expect(text(root)).toContain('The server could not complete this request. Please try again.');
    expect(text(root)).not.toContain('isn’t saved on this phone');
    expect(button(root, 'Try again')).toHaveLength(1);
  });
});

describe('an event’s detail', () => {
  it('says when it happened day first, on a US phone too (#640)', () => {
    mockDeviceLocale('en-US');
    render({ state: activity({ selected: event(1) }) });
    const clock = new Date(2026, 8, 30, 11, 0).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    // The time is the last run of the details line, a string inside its text.
    expect(JSON.stringify(screen!.toJSON())).toContain(`"Wed 30 Sep 2026, ${clock}"`);
  });
});

describe('a change to the Group’s currencies, as read from the server (#721)', () => {
  it('names the currency added and what the list became, from what was recorded', () => {
    const sam = 'a00000000000000000000002';
    // The event as the API answers it, read the way the app reads every page.
    const page = parseActivityPage(
      {
        data: {
          activities: [
            {
              _id: hex('f', 1),
              group: groupId,
              type: 'group_updated',
              actor: { _id: sam, name: 'Sam Chen' },
              createdAt: new Date(2026, 8, 30, 11, 0).toISOString(),
              metadata: {
                changes: { alternateCurrencies: { old: ['EUR'], new: ['EUR', 'JPY'] } },
                groupName: 'Lisbon & Tokyo',
                currencies: ['INR', 'EUR', 'JPY'],
              },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
        status: 200,
      },
      groupId,
      1,
    );

    const { root } = render({
      state: activity({
        events: page.events,
        pagination: page.pagination,
      }),
    });

    expect(text(root)).toContain('added JPY to the Group’s currencies');
    // The row as it is spoken, with the line below the headline.
    expect(buttons(root)).toContain(
      'Sam Chen added JPY to the Group’s currencies, Lisbon & Tokyo now uses INR, EUR and JPY, 11:00 AM',
    );
  });
});

describe('an older removal from the Group’s currencies, as read from the server (#721)', () => {
  it('never says nothing used it without the list recorded with it', () => {
    const page = parseActivityPage(
      {
        data: {
          activities: [
            {
              _id: hex('f', 2),
              group: groupId,
              type: 'group_updated',
              actor: { _id: you, name: 'Alex Rivera' },
              createdAt: new Date(2026, 8, 30, 11, 0).toISOString(),
              metadata: { changes: { alternateCurrencies: { old: ['EUR', 'GBP'], new: ['EUR'] } } },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
        status: 200,
      },
      groupId,
      1,
    );

    const { root } = render({
      state: activity({ events: page.events, pagination: page.pagination }),
    });

    expect(buttons(root)).toContain('You removed GBP from the Group’s currencies, 11:00 AM');
  });
});

// #751: a long assistant host in an event's details was cut at its end after two lines.
describe('an assistant’s credit in an Activity row (#751)', () => {
  const host = 'chatgpt.com.secure-assistant-connector.evil.example.test';
  const prepared: ActivityEvent = {
    ...event(1),
    metadata: { ...event(1).metadata, preparedBy: { kind: 'assistant', name: host } },
  };
  /** The issue's second host, 120 characters, ending in the same domain. */
  const long =
    'claude.ai.household-ledger-reconciliation-assistant-for-shared-expenses.connectorgateway.region-euwest.evil.example.test';
  const preparedBy = (name: string): ActivityEvent => ({
    ...event(1),
    metadata: { ...event(1).metadata, preparedBy: { kind: 'assistant', name } },
  });
  const credit = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        isHost(node, 'Text') &&
        node.children
          .filter((child) => typeof child === 'string')
          .join('')
          .trimEnd() === `prepared by ${host}`,
    );

  it('takes a line of its own, cut in the middle so the domain stays, with the whole name read aloud', () => {
    const { root } = render({ state: activity({ events: [prepared] }) });
    expect(credit(root).props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'middle' });
    expect(buttons(root).some((label) => label?.includes(`prepared by ${host}`))).toBe(true);
  });

  it('wraps in full at the largest text', () => {
    setWindow({ fontScale: 2 });
    const { root } = render({ state: activity({ events: [prepared] }) });
    expect(credit(root).props.numberOfLines).toBe(0);
  });

  it('shows whole in the event’s details', () => {
    const { root } = render({ state: activity({ selected: prepared }) });
    expect(credit(root).props.numberOfLines ?? 0).toBe(0);
  });

  // Its end shows the domain to its last letter: "…evil.example.test" at 100% on the emulator and
  // "…vil.example.test" at 130%, where the line keeps room for the ellipsis Android draws wider
  // than it measured (#766).
  it.each([
    [1, host, /evil\.example\.test\s*$/],
    [1.3, host, /example\.test\s*$/],
    [1, long, /evil\.example\.test\s*$/],
    [1.3, long, /example\.test\s*$/],
  ])('keeps the domain readable on a 360dp phone at %s× text: %s', (fontScale, name, end) => {
    setWindow({ width: 360, height: 640, fontScale });
    render({ state: activity({ events: [preparedBy(name)] }) });
    // The list lies in a Card inset 16dp from the screen's edges, inside its 1dp border.
    expect(
      middleCutEnd(
        screen!.toJSON() as ReactTestRendererJSON,
        fontScale,
        360 - 34,
        `prepared by ${name}`,
      ),
    ).toMatch(end);
  });
});

// #728: the board "The Settlement's record": a Debt paid in another currency, opened from its
// Activity row, read the way the app reads every page.
describe('a payment in another currency’s record (#728)', () => {
  const sam = 'a00000000000000000000002';
  /** Fetched at 06:00 on 21 Oct on this phone; recorded at 10:20. */
  const fetchedAt = new Date(2026, 9, 21, 6, 0).toISOString();
  const payment = (metadata: Record<string, unknown> = {}) =>
    parseActivityPage(
      {
        status: 200,
        data: {
          activities: [
            {
              _id: hex('e', 900),
              group: groupId,
              type: 'settlement_recorded',
              actor: { _id: you, name: 'Alex Rivera' },
              createdAt: new Date(2026, 9, 21, 10, 20).toISOString(),
              metadata: {
                settlementId: 'f00000000000000000000001',
                amount: 20,
                amountMinor: 2000,
                currency: 'EUR',
                paidBy: you,
                paidTo: sam,
                paidByName: 'Alex Rivera',
                paidToName: 'Sam Chen',
                amountPaidMinor: 185000,
                paidCurrency: 'INR',
                appliedRate: '92.5',
                rateKind: 'custom',
                suggestedRate: '92.1',
                rateSource: 'frankfurter',
                rateAsOf: '2026-10-20',
                rateFetchedAt: fetchedAt,
                pairDebtBeforeMinor: -2000,
                pairDebtAfterMinor: 0,
                ...metadata,
              },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
      groupId,
      1,
    ).events[0];
  const labelled = (root: ReactTestInstance, label: string) =>
    root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityLabel === label,
    );

  it('shows both amounts, the rate used beside the suggestion, and what it changed', () => {
    const { root } = render({ state: activity({ selected: payment() }) });
    const shown = text(root);
    for (const words of [
      'Payment',
      'Paid',
      '₹1,850.00',
      'to clear €20.00, a Debt in EUR',
      'Rate used',
      '₹92.50 per €',
      'Your rate',
      'Suggested',
      '₹92.10 per €',
      'Frankfurter · rates of 20 Oct · fetched 21 Oct 06:00',
      'Amount cleared',
      '€20.00',
      'Amount paid',
      'Recorded',
      'by you',
      'What it changed',
      'You and Sam in EUR:',
      '−€20.00',
      '€0.00',
      'INR balances didn’t change. Only the Debt’s own currency moves.',
      'The rate is kept as recorded. It never changes, even when rates move later.',
    ])
      expect(shown).toContain(words);
    // Read aloud, the record says what happened in one line first.
    expect(labelled(root, 'You paid Sam Chen ₹1,850.00 to clear €20.00')).toHaveLength(1);
    // A Debt paid in another currency isn't the payment's old "You → Sam Chen" line.
    expect(shown).not.toContain('recorded a payment');
  });

  it('links a second source’s attribution where its rate shows', () => {
    const onOpenLink = vi.fn();
    const { root } = render({
      state: activity({ selected: payment({ rateSource: 'exchange-rate-api' }) }),
      onOpenLink,
    });
    expect(text(root)).toContain('Rates of 20 Oct · fetched 21 Oct 06:00');
    const [link] = labelled(root, 'Rates By Exchange Rate API');
    expect(link?.props.accessibilityRole).toBe('link');
    act(() => link!.props.onPress());
    expect(onOpenLink).toHaveBeenCalledWith('https://www.exchangerate-api.com');
  });

  it('leaves out what an older record didn’t keep, and says when no rate was suggested', () => {
    const { root } = render({
      state: activity({
        selected: payment({
          rateKind: 'entered',
          suggestedRate: undefined,
          rateSource: undefined,
          rateAsOf: undefined,
          rateFetchedAt: undefined,
          pairDebtBeforeMinor: undefined,
          pairDebtAfterMinor: undefined,
        }),
      }),
    });
    const shown = text(root);
    expect(shown).toContain('No suggestion');
    expect(shown).not.toContain('per €Suggested');
    expect(shown).not.toContain('You and Sam in EUR:');
    expect(shown).toContain('INR balances didn’t change. Only the Debt’s own currency moves.');
  });

  it.each([
    { width: 360, height: 640, fontScale: 1.3 },
    { width: 360, height: 640, fontScale: 2 },
  ])('reads in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    render({ state: activity({ selected: payment() }) });
    // The screen's content is inset 16dp on each side.
    expect(
      unreadText(screen!.toJSON() as ReactTestRendererJSON, size.fontScale, size.width - 32),
    ).toEqual([]);
  });
});

// #783: an event's detail is where it is read in full, and its details line took at most two
// lines: at 200% a payment's "You → Sam Chen · €20.00 · Wed 21 Oct 2026, 10:20 AM" needed three.
describe.each(['light', 'dark'] as const)(
  'an event’s detail at large text in %s (#783)',
  (mode) => {
    const payment = parseActivityPage(
      {
        status: 200,
        data: {
          activities: [
            {
              _id: hex('e', 901),
              group: groupId,
              type: 'settlement_recorded',
              actor: { _id: you, name: 'Alex Rivera' },
              createdAt: new Date(2026, 9, 21, 10, 20).toISOString(),
              metadata: {
                settlementId: 'f00000000000000000000002',
                amount: 20,
                amountMinor: 2000,
                currency: 'EUR',
                paidBy: you,
                paidTo: 'a00000000000000000000002',
                paidByName: 'Alex Rivera',
                paidToName: 'Sam Chen',
              },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
      groupId,
      1,
    ).events[0]!;

    it('keeps a row in the list to two lines of details', () => {
      setWindow({ width: 360, height: 640, fontScale: 2 });
      render({ state: activity({ events: [payment] }) }, mode);
      const details = screen!.root.findAll(
        (node) =>
          String(node.type) === 'Text' &&
          node.findAll((child) => child.props.children === '€20.00').length > 0,
      );
      expect(details.map((node) => node.props.numberOfLines)).toContain(2);
    });

    it.each(largeTextWindows)('reads in full, $width dp at $fontScale× text', (size) => {
      setWindow(size);
      render({ state: activity({ selected: payment }) }, mode);
      const tree = screen!.toJSON() as ReactTestRendererJSON;
      const words = (node: ReactTestRendererJSON | string): string =>
        typeof node === 'string' ? node : (node.children ?? []).map(words).join('');
      expect(words(tree)).toContain('You → Sam Chen · €20.00 · Wed 21 Oct 2026, 10:20');
      // The screen's content is inset 16dp on each side.
      expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
    });
  },
);

// #770, from the Designer's #751 check: a credit cut beside a dot read "chat….evil". Once the
// credit's line knows its width, the app cuts it, with no dot beside the "…"; at the largest
// text it reads in full.
describe.each(['light', 'dark'] as const)(
  'an Activity credit cut by the app in %s (#770)',
  (mode) => {
    const host = 'chatgpt.com.secure-assistant-connector.evil.example.test';
    const credited: ActivityEvent = {
      ...event(1),
      metadata: { ...event(1).metadata, preparedBy: { kind: 'assistant', name: host } },
    };
    const credit = () =>
      screen!.root.find(
        (node) =>
          String(node.type) === 'Text' &&
          [node.props.children].flat().join('').startsWith('prepared by'),
      );
    it.each([1.3, 2])('at %s× text, 360dp', (fontScale) => {
      setWindow({ width: 360, height: 640, fontScale });
      act(() => {
        screen = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupActivity
              state={activity({ events: [credited] })}
              currentUserId={you}
              currency="INR"
              offline={false}
              now={now}
              onRetry={vi.fn()}
              onMore={vi.fn()}
              onLoadNewer={vi.fn()}
              onShift={vi.fn()}
              onSelect={vi.fn()}
              onClose={vi.fn()}
            />
          </ThemeContext.Provider>,
        );
      });
      // The list lies in a Card 16dp in, inside its 1dp border; the row's 14dp padding, a 32dp
      // avatar and a 12dp gap leave its line 254dp.
      act(() => {
        credit().props.onLayout?.({
          nativeEvent: { layout: { x: 0, y: 0, width: 254, height: 16 } },
        });
      });
      const shown = [credit().props.children].flat().join('').trimEnd();
      if (fontScale < 1.5) {
        expect(shown).toMatch(/^prepared by [^…]*[^.]…[^.][^…]*example\.test$/);
      } else {
        expect(credit().props.numberOfLines).toBe(0);
        expect(shown).toBe(`prepared by ${host}`);
      }
    });
  },
);

// #734: a payment that settled several Debts at once, one Settlement for each, shows as one row,
// even when a page boundary splits it, and opens the batch's records.
describe('a payment that settled several Debts at once (#734)', () => {
  const sam = 'a00000000000000000000002';
  const people = { paidBy: you, paidTo: sam, paidByName: 'Alex Rivera', paidToName: 'Sam Chen' };
  const batch = { batchId: 'f00000000000000000000001', batchSize: 2 };
  const recorded = new Date(2026, 8, 30, 11, 30).toISOString();
  // As the feed lists it: newest first, and a batch's events share one time, so the euro Debt's
  // Settlement, recorded second, comes first.
  const [euros, rupees] = parseActivityPage(
    {
      status: 200,
      data: {
        activities: [
          {
            _id: hex('e', 902),
            group: groupId,
            type: 'settlement_recorded',
            actor: { _id: you, name: 'Alex Rivera' },
            createdAt: recorded,
            metadata: {
              ...people,
              ...batch,
              settlementId: 'f00000000000000000000002',
              amount: 20,
              amountMinor: 2000,
              currency: 'EUR',
              amountPaidMinor: 184200,
              paidCurrency: 'INR',
              appliedRate: '92.1',
              rateKind: 'suggested',
              suggestedRate: '92.1',
              rateSource: 'frankfurter',
              rateAsOf: '2026-10-20',
              rateFetchedAt: new Date(2026, 9, 21, 6, 0).toISOString(),
              pairDebtBeforeMinor: -2000,
              pairDebtAfterMinor: 0,
            },
          },
          {
            _id: hex('e', 901),
            group: groupId,
            type: 'settlement_recorded',
            actor: { _id: you, name: 'Alex Rivera' },
            createdAt: recorded,
            metadata: {
              ...people,
              ...batch,
              settlementId: 'f00000000000000000000001',
              amount: 1480,
              amountMinor: 148000,
              currency: 'INR',
            },
          },
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      },
    },
    groupId,
    1,
  ).events as [ActivityEvent, ActivityEvent];
  const whole = 'You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00';

  it('shows its Settlements as one row, in the single payment’s words and recorded order', () => {
    const { root, onSelect } = render({
      state: activity({
        events: [euros, rupees, ...events.slice(0, 3)],
        pagination: { page: 1, limit: 20, total: 5, totalPages: 1 },
      }),
    });
    const rows = buttons(root).filter((label) => label?.includes('Sam Chen'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(whole);
    expect(rows[0]).toContain('€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)');
    expect(text(root)).not.toContain('recorded a payment');
    act(() => button(root, rows[0]!)[0]!.props.onPress());
    // The row is where the payment is in the feed: at its newest event.
    expect(onSelect).toHaveBeenCalledWith(euros._id);
  });

  // #792: a batch's row has details, so from 130% its avatar keeps beside the headline.
  it('keeps its avatar beside its headline at 130% text (#792)', () => {
    setWindow({ width: 360, height: 640, fontScale: 1.3 });
    render({
      state: activity({
        events: [euros, rupees],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      }),
    });
    const [row] = findHosts(
      screen!.toJSON() as ReactTestRendererJSON,
      (props, type) =>
        type === 'Pressable' &&
        props.accessibilityRole === 'button' &&
        String(props.accessibilityLabel).includes('Sam Chen'),
    );
    expect(flatten(row!.props.style).alignItems).toBe('flex-start');
  });

  it('says where the rest of one a page boundary split is, and joins it once that page loads', () => {
    const { root, update } = render({
      state: activity({
        events: [...events.slice(0, 19), euros],
        pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
      }),
    });
    const split = buttons(root).find((label) => label?.includes('Sam Chen'));
    expect(split).toContain('You paid Sam Chen to clear €20.00 and 1 more Debt');
    expect(split).toContain('The rest of this payment is in older Activity.');
    update({
      state: activity({
        events: [...events.slice(0, 19), euros, rupees],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      }),
    });
    expect(buttons(root).filter((label) => label?.includes('Sam Chen'))).toHaveLength(1);
    expect(buttons(root).find((label) => label?.includes('Sam Chen'))).toContain(whole);
    expect(text(root)).not.toContain('more Debt');
  });

  it('opens the payment with each of its Settlements’ records, in recorded order', () => {
    const { root } = render({ state: activity({ events: [euros, rupees], selected: euros }) });
    const shown = text(root);
    expect(shown).toContain('Payment');
    expect(shown).toContain('to clear ₹1,480.00 and €20.00');
    expect(shown).toContain('₹1,480.00, same currency, no rate');
    // The euro Debt's record, as a single payment in another currency opens it (#728).
    expect(shown).toContain('to clear €20.00, a Debt in EUR');
    expect(shown).toContain('Rate used');
    expect(shown).toContain('What it changed');
    expect(
      root.findAll(
        (node) => typeof node.type === 'string' && node.props.accessibilityLabel === whole,
      ),
    ).toHaveLength(1);
  });
});

// #792, from the Designer's #770 check: at 130% text and above an Activity row runs three to six
// lines, and its centred avatar drifted down beside the details, away from the headline that says
// who did it. A row with details keeps its avatar beside the headline, at the top; a row without
// details, and every row below 130%, keeps it centred, as a list row with a note does (#770).
describe.each(['light', 'dark'] as const)('an Activity row’s avatar in %s (#792)', (mode) => {
  const joined: ActivityEvent = { ...event(2), type: 'member_joined', metadata: {} };
  const alignment = (label: string) => {
    const [row] = findHosts(
      screen!.toJSON() as ReactTestRendererJSON,
      (props, type) =>
        type === 'Pressable' &&
        props.accessibilityRole === 'button' &&
        String(props.accessibilityLabel).startsWith(label),
    );
    return flatten(row!.props.style).alignItems;
  };
  it.each([
    { fontScale: 1, detailed: 'center' },
    { fontScale: 1.3, detailed: 'flex-start' },
    { fontScale: 2, detailed: 'flex-start' },
  ])('$fontScale× text, 360dp: a row with details aligns it $detailed', (size) => {
    setWindow({ width: 360, height: 640, fontScale: size.fontScale });
    act(() => {
      screen = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupActivity
            state={activity({ events: [event(1), joined] })}
            currentUserId={you}
            currency="INR"
            offline={false}
            now={now}
            onRetry={vi.fn()}
            onMore={vi.fn()}
            onLoadNewer={vi.fn()}
            onShift={vi.fn()}
            onSelect={vi.fn()}
            onClose={vi.fn()}
          />
        </ThemeContext.Provider>,
      );
    });
    expect(alignment('You added Fictional event 1')).toBe(size.detailed);
    expect(alignment('You joined the Group')).toBe('center');
  });
});
