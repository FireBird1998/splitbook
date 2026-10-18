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
    /** Whether Alex is still an admin of Harbour Flat. */
    admin: true,
  };
}
const snapshot = () => ({ canManage: server.admin, tags: structuredClone(server.tags) });

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
/** Whether an element shows this text anywhere inside it, as its text or a row's title. */
const shows = (node: unknown, text: string): boolean =>
  node === text ||
  (Array.isArray(node) && node.some((child) => shows(child, text))) ||
  (typeof node === 'object' &&
    node !== null &&
    'props' in node &&
    ((node as { props: { title?: unknown } }).props.title === text ||
      shows((node as { props: { children?: unknown } }).props.children, text)));

/** Alex's Tags at 200% text, once they are read. */
async function openManageTags(offline = false) {
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
  await showManageTags(offline);
}

/** Tags on screen, as opening it from the Group does. */
async function showManageTags(offline = false) {
  views = [];
  measured = [];
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
  setWindow({ width: 360, height: 780, fontScale: 2 });
  act(() => {
    renderer = create(
      <TagManager
        controller={controller!}
        groupId={groupId}
        groupName="Harbour Flat"
        accountId={alex.id}
        offline={offline}
        onClose={vi.fn()}
      />,
      nativeViews(),
    );
  });
  await settle();
}

/** Press a control by its spoken label, and let what it starts finish. */
const press = async (label: string) => {
  await act(async () => labelled(label).props.onPress());
  await settle();
};
/** Press a control in the sheet that's showing, such as its Cancel. */
const pressInSheet = async (label: string) => {
  const sheet = renderer!.root.find(
    (node: ReactTestInstance) =>
      String(node.type) === 'Modal' && node.props.transparent && node.props.visible,
  );
  await act(async () =>
    sheet
      .find(
        (node: ReactTestInstance) =>
          typeof node.type === 'string' && node.props.accessibilityLabel === label,
      )
      .props.onPress(),
  );
  await settle();
};
/** Whether a control with this spoken label is on screen. */
const offered = (label: string) =>
  renderer!.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  ).length > 0;
/** Every text on screen, joined. */
const screenText = () =>
  renderer!.root
    .findAll((node: ReactTestInstance) => String(node.type) === 'Text')
    .map((node) => [node.props.children].flat().join(''))
    .join('\n');
/** The bottom sheet showing, by its title: one at a time. */
const sheetTitle = () =>
  renderer!.root
    .findAll(
      (node: ReactTestInstance) =>
        String(node.type) === 'Modal' && node.props.transparent && node.props.visible,
    )
    .map(
      (modal) =>
        modal.find(
          (node: ReactTestInstance) =>
            String(node.type) === 'Text' && node.props.accessibilityRole === 'header',
        ).props.children,
    );
/** Whether the Tag name box was focused, which raises the keyboard. */
const typed = () =>
  views.some(
    (view) => view.element.props.accessibilityLabel === 'Tag name' && view.focus.mock.calls.length,
  );
/** What the screen reader was last moved to. */
const announced = () =>
  (
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1)?.[0] as
      | NativeView
      | undefined
  )?.element;
/** Long enough for a sheet to slide in and its name box to take the keyboard. */
const sheetIn = () => act(() => new Promise((resolve) => setTimeout(resolve, 650)));
const row = `${longName}, active. Opens Rename and Archive`;

describe('Renaming a Tag (#554)', () => {
  it('opens a long name at its start, and leaves the cursor to the member while typing', async () => {
    await openManageTags();
    await press(row);
    await press('Rename, Saved Expenses show the new name');
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

describe('Tags on a phone (#562)', () => {
  it('keeps its content inside the safe area, clear of the status bar and gesture bar', async () => {
    await openManageTags();
    const heading = renderer!.root.find(
      (node: ReactTestInstance) => String(node.type) === 'Text' && node.props.children === 'Tags',
    );
    let area: ReactTestInstance | null = heading.parent;
    while (area && String(area.type) !== 'SafeAreaView') area = area.parent;
    expect(area, 'a SafeAreaView around the heading').not.toBeNull();
    // Every edge: a full-screen Modal draws under the status bar and the gesture bar.
    expect(area!.props.edges).toBeUndefined();
    // The list's own scroll view, not one of its sheets'.
    const scroll = renderer!.root.find(
      (node: ReactTestInstance) =>
        String(node.type) === 'ScrollView' && !!node.props.refreshControl,
    );
    expect(area!.findAll((node) => node === scroll)).toHaveLength(1);
    // The inset is the gap above the content now, not a fixed guess at the status bar.
    expect(scroll.props.contentContainerStyle).not.toHaveProperty('paddingTop');
  });
});

describe('A Tag’s options, in sheets over the list', () => {
  it('lists each Tag once, with its options a tap away instead of buttons under every Tag', async () => {
    await openManageTags();
    expect(screenText()).toContain('Active · 1');
    expect(screenText()).toContain('Archived · 1');
    expect(offered(`Rename ${longName}`)).toBe(false);
    expect(offered(`Archive ${longName}`)).toBe(false);
    await press(row);
    expect(sheetTitle()).toEqual([longName]);
    expect(offered('Rename, Saved Expenses show the new name')).toBe(true);
  });

  it('opens Rename in its sheet with the keyboard, and goes back to the Tag on Cancel', async () => {
    await openManageTags();
    await press(row);
    await press('Rename, Saved Expenses show the new name');
    expect(sheetTitle()).toEqual(['Rename Tag']);
    await sheetIn();
    expect(typed()).toBe(true);
    await pressInSheet('Cancel');
    expect(sheetTitle()).toEqual([]);
    expect(shows(announced(), longName)).toBe(true);
  });

  it('confirms a saved rename in a short note, with nothing to dismiss, and goes to the Tag', async () => {
    await openManageTags();
    await press(row);
    await press('Rename, Saved Expenses show the new name');
    act(() => labelled('Tag name').props.onChangeText('Weekly groceries'));
    await press('Save name');
    expect(sheetTitle()).toEqual([]);
    expect(screenText()).toContain('Renamed to Weekly groceries');
    expect(screenText()).not.toContain('Your change went through');
    expect(shows(announced(), 'Weekly groceries')).toBe(true);
    // Nothing is kept on the device to check later: the change is done.
    expect(controller!.getSnapshot().tagManager.recovery).toBeNull();
  });

  it('saves a name from the keyboard’s Done, and only a name that can be saved', async () => {
    await openManageTags();
    await press(row);
    await press('Rename, Saved Expenses show the new name');
    // Unchanged: Done does nothing.
    await act(async () => labelled('Tag name').props.onSubmitEditing());
    await settle();
    expect(sheetTitle()).toEqual(['Rename Tag']);
    act(() => labelled('Tag name').props.onChangeText('Weekly groceries'));
    await act(async () => labelled('Tag name').props.onSubmitEditing());
    await settle();
    expect(screenText()).toContain('Renamed to Weekly groceries');
  });

  it('says a name is taken as it is typed, and offers to restore an archived Tag instead', async () => {
    await openManageTags();
    await press('New Tag');
    act(() => labelled('Tag name').props.onChangeText('old RENT'));
    expect(screenText()).toContain(
      'Old rent is archived. Restore it to keep its Expenses together.',
    );
    expect(offered('Create Tag')).toBe(false);
    await press('Restore Old rent');
    expect(screenText()).toContain('Old rent restored');
    expect(screenText()).toContain('Active · 2');
  });

  it('restores an archived Tag in one step, with nothing to type', async () => {
    await openManageTags();
    await press('Old rent, archived. Opens Restore');
    expect(sheetTitle()).toEqual(['Old rent']);
    await press('Restore, Offer it on new Expenses again');
    await sheetIn();
    expect(sheetTitle()).toEqual([]);
    expect(screenText()).toContain('Old rent restored');
    expect(typed()).toBe(false);
  });

  it('keeps Archive from the only active Tag, saying why, and explains it before archiving', async () => {
    await openManageTags();
    await press(row);
    expect(offered('Archive, Stop offering it. Saved Expenses keep it.')).toBe(false);
    expect(screenText()).toContain('A Group needs one active Tag. Create another first.');
    await press(`Close ${longName}`);
    await press('Old rent, archived. Opens Restore');
    await press('Restore, Offer it on new Expenses again');
    await press(row);
    await press('Archive, Stop offering it. Saved Expenses keep it.');
    expect(sheetTitle()).toEqual([`Archive ${longName}?`]);
    expect(screenText()).toContain('Saved Expenses keep it, with their history.');
    expect(screenText()).toContain('Drafts using it need another Tag before they’re saved.');
    expect(screenText()).toContain(
      'Recurring Expenses using it pause until they get an active Tag.',
    );
    await press('Archive Tag');
    expect(screenText()).toContain(`${longName} archived`);
    expect(server.tags.find((tag) => tag.id === tagId)!.isArchived).toBe(true);
  });

  it('leaves a kept, refused rename in its sheet when Tags opens again, without the keyboard', async () => {
    await openManageTags();
    await press(row);
    await press('Rename, Saved Expenses show the new name');
    act(() => labelled('Tag name').props.onChangeText('Weekly groceries'));
    server.refusal = { status: 409, code: 'AMBIGUOUS_TAG' };
    await press('Save name');
    act(() => renderer!.unmount());
    await showManageTags();
    expect(labelled('Tag name').props.value).toBe('Weekly groceries');
    expect(screenText()).toContain('Not saved');
    // Nothing was tapped, so no keyboard comes up by itself.
    await sheetIn();
    expect(typed()).toBe(false);
  });
});

describe('Tags that can’t be changed here', () => {
  it('shows them offline, read only, and says changing them needs a connection', async () => {
    await openManageTags(true);
    expect(screenText()).toContain(
      'You’re offline. You can see the Tags; changing them needs a connection.',
    );
    expect(screenText()).toContain(longName);
    expect(offered('New Tag')).toBe(false);
    // Each Tag is listed, and none opens options.
    expect(offered(row)).toBe(false);
    expect(offered('Old rent, archived. Opens Restore')).toBe(false);
  });

  it('shows them to a member who isn’t an admin, with nothing to change', async () => {
    server.admin = false;
    await openManageTags();
    expect(screenText()).toContain(
      'Only Group admins can change Tags. You can use any active Tag on your Expenses.',
    );
    expect(offered('New Tag')).toBe(false);
    expect(screenText()).toContain('Old rent');
    expect(offered(row)).toBe(false);
    expect(offered('Old rent, archived. Opens Restore')).toBe(false);
  });
});
