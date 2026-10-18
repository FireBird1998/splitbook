import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { AccountGroupRecordStore } from '../data/account-record-storage';
import type { MobileFetch } from '../data/types';
import type { TagCommand } from '@splitbook/shared/tag-management';
import { AccessibilityInfo } from 'react-native';
import { setWindow } from '../test-utils/native';
import { TagManager } from './tag-manager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Alex, an admin of Harbour Flat, a fictional Group, renames its one long Tag.
const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';
const longName = 'Shared groceries and household supplies for the flat';
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify({ status, ...Object(data) }), {
    status,
    headers: cookie ? { 'Set-Cookie': cookie } : {},
  });

const archivedId = 'c00000000000000000000002';
/** Harbour Flat's Tags as the server keeps them, applying each Tag action it accepts. */
let server = newServer();
function newServer() {
  return {
    tags: [
      { id: tagId, name: longName, revision: 0, isArchived: false, isDeleted: false },
      { id: archivedId, name: 'Old rent', revision: 0, isArchived: true, isDeleted: false },
    ],
    /** A refusal the next Tag action gets instead of being applied. */
    refusal: null as { status: number; code: string } | null,
  };
}
const snapshot = () => ({ canManage: true, tags: structuredClone(server.tags) });

const fetch: MobileFetch = async (url, init) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/sign-in'))
    return json({ user: alex }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
  if (path.endsWith('/get-session'))
    return json({ user: alex, session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' } });
  if (path.endsWith('/tag-actions') && init.method === 'POST') {
    const command = JSON.parse(String(init.body)) as TagCommand;
    if (server.refusal)
      return json(
        { code: server.refusal.code, error: 'Tag action refused', snapshot: snapshot() },
        server.refusal.status,
      );
    const { intent } = command;
    const tag = server.tags.find((tag) => 'tagId' in intent && tag.id === intent.tagId)!;
    if (intent.action === 'rename') tag.name = intent.name;
    if (intent.action === 'archive' || intent.action === 'restore')
      tag.isArchived = intent.action === 'archive';
    tag.revision++;
    return json({
      data: {
        state: 'applied',
        requestId: command.requestId,
        receipt: { intent, tagId: tag.id, appliedAt: '2026-10-18T10:00:00.000Z' },
        snapshot: snapshot(),
      },
    });
  }
  if (path.endsWith('/tag-actions')) return json({ data: snapshot() });
  return json({ data: {} });
};

/** Kept Tag actions, on this device only. */
function memoryRecords(): AccountGroupRecordStore {
  const records = new Map<string, unknown>();
  return {
    load: async (accountId, id) => structuredClone(records.get(accountId + id) ?? null),
    save: async (accountId, id, value) => {
      records.set(accountId + id, structuredClone(value));
    },
    remove: async (accountId, id) => {
      records.delete(accountId + id);
    },
    clear: async () => records.clear(),
    keys: async (accountId) =>
      [...records.keys()]
        .filter((key) => key.startsWith(accountId))
        .map((key) => key.slice(accountId.length)),
  };
}

let controller: MobileController | undefined;
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  server = newServer();
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
  controller?.dispose();
  controller = undefined;
});

const settle = () =>
  act(async () => {
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const labelled = (label: string) =>
  renderer!.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

/** A native view as the tests see it: its element, where it is laid out, what was asked of it. */
interface NativeView {
  element: ReactElement<Record<string, unknown>>;
  y: number;
  focus: ReturnType<typeof vi.fn>;
  scrollTo: ReturnType<typeof vi.fn>;
  measureLayout: ReturnType<typeof vi.fn>;
}
/** Every native view handed out; each sits 100 below the one made before it. */
let views: NativeView[] = [];
/** The views measured to scroll to, in order. */
let measured: NativeView[] = [];
const nativeViews = () => ({
  createNodeMock: (element: ReactElement<Record<string, unknown>>): NativeView => {
    const y = 100 * (views.length + 1);
    const view: NativeView = {
      element,
      y,
      focus: vi.fn(),
      scrollTo: vi.fn(),
      measureLayout: vi.fn((_relativeTo: unknown, onSuccess: (x: number, y: number) => void) => {
        measured.push(view);
        onSuccess(0, y);
      }),
    };
    views.push(view);
    return view;
  },
});
/** Whether an element shows this text anywhere inside it. */
const shows = (node: unknown, text: string): boolean =>
  node === text ||
  (Array.isArray(node) && node.some((child) => shows(child, text))) ||
  (typeof node === 'object' &&
    node !== null &&
    'props' in node &&
    shows((node as { props: { children?: unknown } }).props.children, text));

/** Alex's Manage Tags at 200% text, once its Tags are read. */
async function openManageTags() {
  let cookie: string | null = null;
  let owner: string | null = null;
  const tagRequests = memoryRecords();
  controller = createMobileController(
    {
      apiBaseUrl: 'http://tags.example.test',
      authOrigin: 'http://tags.example.test',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
      tagRequests,
      newSubmissionKey: () => crypto.randomUUID(),
      accountLocal: {
        owner: {
          load: async () => owner,
          save: async (next) => {
            owner = next;
          },
          clear: async () => {
            owner = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [tagRequests],
      },
      credentials: {
        load: async () => cookie,
        save: async (next) => {
          cookie = next;
        },
        clear: async () => {
          cookie = null;
        },
      },
    },
  );
  await controller.signIn('alex');
  await showManageTags();
}

/** Manage Tags on screen, as opening it from the Group does. */
async function showManageTags() {
  views = [];
  measured = [];
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  setWindow({ width: 360, height: 780, fontScale: 2 });
  act(() => {
    renderer = create(
      <TagManager
        controller={controller!}
        groupId={groupId}
        accountId={alex.id}
        offline={false}
        onClose={vi.fn()}
      />,
      nativeViews(),
    );
  });
  await settle();
}

describe('Renaming a Tag (#554)', () => {
  it('opens a long name at its start, and leaves the cursor to the member while typing', async () => {
    await openManageTags();
    await act(async () => labelled(`Rename ${longName}`).props.onPress());
    const box = () => labelled('Tag name');
    expect(box().props.value).toBe(longName);
    // Android otherwise opens a filled single-line box at its end, cutting off the start.
    expect(box().props.selection).toEqual({ start: 0, end: 0 });
    act(() => box().props.onFocus());
    expect(box().props.selection).toBeUndefined();
    act(() => box().props.onBlur());
    expect(box().props.selection).toEqual({ start: 0, end: 0 });
  });
});

describe('Manage Tags on a phone (#562)', () => {
  it('keeps its content inside the safe area, clear of the status bar and gesture bar', async () => {
    await openManageTags();
    const heading = renderer!.root.find(
      (node: ReactTestInstance) =>
        String(node.type) === 'Text' && node.props.children === 'Manage Tags',
    );
    let area: ReactTestInstance | null = heading.parent;
    while (area && String(area.type) !== 'SafeAreaView') area = area.parent;
    expect(area, 'a SafeAreaView around the heading').not.toBeNull();
    // Every edge: a full-screen Modal draws under the status bar and the gesture bar.
    expect(area!.props.edges).toBeUndefined();
    const scroll = renderer!.root.find(
      (node: ReactTestInstance) => String(node.type) === 'ScrollView',
    );
    expect(area!.findAll((node) => node === scroll)).toHaveLength(1);
    // The inset is the gap above the content now, not a fixed guess at the status bar.
    expect(scroll.props.contentContainerStyle).not.toHaveProperty('paddingTop');
  });
});

describe('Opening a Tag edit from low in the list (#584)', () => {
  /** Where the view last scrolled to, and what it scrolled to: the view last measured. */
  const scrolled = () => {
    const to = views
      .filter((view) => view.element.type === 'ScrollView')
      .flatMap((view) => view.scrollTo.mock.calls)
      .at(-1)?.[0];
    const target = measured.at(-1);
    return { to, target, near: target && { y: Math.max(0, target.y - 16), animated: false } };
  };
  /** What the screen reader was last moved to. */
  const announced = () =>
    (
      vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1)?.[0] as
        | NativeView
        | undefined
    )?.element;
  const typed = (label: string) =>
    views.some(
      (view) => view.element.props.accessibilityLabel === label && view.focus.mock.calls.length,
    );
  const press = async (label: string) => {
    await act(async () => labelled(label).props.onPress());
    await settle();
  };

  it('brings Rename into view and into the Tag name box, then back to the Tag on Cancel', async () => {
    await openManageTags();
    await press(`Rename ${longName}`);
    // The edit sits above the lists, so the view scrolls up to it from the tapped Tag.
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, 'Rename Tag')).toBe(true);
    expect(typed('Tag name')).toBe(true);
    await press('Cancel Tag edit');
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, longName)).toBe(true);
    expect(shows(scrolled().target?.element, 'Rename Tag')).toBe(false);
    expect(shows(announced(), longName)).toBe(true);
    // The cards get their buttons back, and the view stops short of the Tag until it has taken
    // the list's new length: once it has, it goes to the Tag again.
    vi.stubGlobal('requestAnimationFrame', (next: () => void) => next());
    const before = measured.length;
    act(() =>
      renderer!.root
        .find((node: ReactTestInstance) => String(node.type) === 'ScrollView')
        .props.onContentSizeChange(360, 4000),
    );
    vi.unstubAllGlobals();
    expect(measured.length).toBe(before + 1);
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, longName)).toBe(true);
  });

  it('shows a saved rename’s confirmation, then goes back to the renamed Tag', async () => {
    await openManageTags();
    await press(`Rename ${longName}`);
    act(() => labelled('Tag name').props.onChangeText('Weekly groceries'));
    await press('Save Tag name');
    // The confirmation appears above the lists, so it is brought into view, not the Tag.
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, 'Confirmed earlier action')).toBe(true);
    expect(shows(announced(), 'Confirmed earlier action')).toBe(true);
    await press('Continue managing Tags');
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, 'Weekly groceries')).toBe(true);
    expect(shows(announced(), 'Weekly groceries')).toBe(true);
  });

  it('brings Archive and Restore into view and to the screen reader, with nothing to type', async () => {
    await openManageTags();
    await press(`Archive ${longName}`);
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, 'Archive Tag?')).toBe(true);
    expect(shows(announced(), 'Archive Tag?')).toBe(true);
    await press('Cancel Tag edit');
    await press('Restore Old rent');
    expect(scrolled().to).toEqual(scrolled().near);
    expect(shows(scrolled().target?.element, 'Restore Tag?')).toBe(true);
    expect(shows(announced(), 'Restore Tag?')).toBe(true);
    expect(typed('Tag name')).toBe(false);
  });

  it('leaves a kept, refused rename where it is when Manage Tags opens again', async () => {
    await openManageTags();
    await press(`Rename ${longName}`);
    act(() => labelled('Tag name').props.onChangeText('Weekly groceries'));
    server.refusal = { status: 409, code: 'AMBIGUOUS_TAG' };
    await press('Save Tag name');
    act(() => renderer!.unmount());
    await showManageTags();
    expect(labelled('Tag name').props.value).toBe('Weekly groceries');
    // Nothing was tapped, so the screen opens at its top, with no keyboard.
    expect(scrolled().to).toBeUndefined();
    expect(typed('Tag name')).toBe(false);
  });
});
