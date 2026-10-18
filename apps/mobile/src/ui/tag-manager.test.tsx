import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { AccountGroupRecordStore } from '../data/account-record-storage';
import type { MobileFetch } from '../data/types';
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

const fetch: MobileFetch = async (url) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/sign-in'))
    return json({ user: alex }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
  if (path.endsWith('/get-session'))
    return json({ user: alex, session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' } });
  if (path.endsWith('/tag-actions'))
    return json({
      data: {
        canManage: true,
        tags: [{ id: tagId, name: longName, revision: 0, isArchived: false, isDeleted: false }],
      },
    });
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

describe('Renaming a Tag (#554)', () => {
  it('opens a long name at its start, and leaves the cursor to the member while typing', async () => {
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
      );
    });
    await settle();
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
