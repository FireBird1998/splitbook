import { createElement, type ComponentType, type ReactNode } from 'react';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { THEME_ID } from '@mui/material/styles';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import AssistantPage from './AssistantPage';

/*
 * One assistant's page (#620): its access, last use and Groups, with Save and Disconnect. Rendered
 * with only the server behind `fetch` a stand-in. Without a document, the confirmation dialog
 * renders in place and Next's Link as a plain link.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: (props: object) => createElement('a', props) };
});
vi.mock('@mui/material/Dialog', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? createElement('div', { role: 'dialog' }, children) : null,
  };
});

const [HOME, TRIP, CLUB] = [
  'b00000000000000000000001',
  'b00000000000000000000002',
  'b00000000000000000000003',
];
const ASSISTANT = {
  id: 'c2',
  clientId: 'https://assistant.example.test/client.json',
  name: 'Synthetic Assistant',
  lastUsedAt: null,
  scopes: ['ledger:read', MCP_DRAFT_SCOPE],
  access: 'Ledger + To review',
  excludedGroupIds: [TRIP],
};
const GROUPS = [
  { id: HOME, name: 'Maple House', theme: 'home', currencies: ['INR'], rule: 'allowed' },
  { id: TRIP, name: 'Goa Friends Trip', theme: 'trip', currencies: ['INR'], rule: 'allowed' },
  {
    id: CLUB,
    name: 'Studio Lunch Club',
    theme: 'work',
    currencies: ['INR', 'USD'],
    rule: 'not_allowed',
    ruleSetBy: { id: 'a00000000000000000000003', name: 'Priya Shah' },
  },
].map((group) => ({ currency: 'INR', archived: false, ruleSetBy: null, ...group }));

/** MUI's own provider reads the document on mount; Emotion's carries the theme without one. */
const AppTheme = EmotionThemeProvider as ComponentType<{ theme: object; children?: ReactNode }>;
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

/** The server as the page calls it; `saving` answers the save, `revoking` Disconnect. */
function server(
  saving: () => Response = () => Response.json({ excludedGroupIds: [] }),
  {
    revoking = () => Response.json({ disconnected: true }),
    reading = () => Response.json(ASSISTANT),
  } = {},
) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        if (url === '/api/auth/mcp/connection-groups') return saving();
        return revoking();
      }
      if (url.startsWith('/api/auth/mcp/connection?')) return reading();
      if (url === '/api/user/assistant-groups')
        return Response.json({ data: { groups: GROUPS }, status: 200 });
      return new Response(null, { status: 404 });
    }),
  );
  return calls;
}

async function open() {
  await act(async () => {
    renderer = create(
      createElement(
        AppTheme,
        { theme: { [THEME_ID]: createAppTheme('light') } },
        createElement(AssistantPage, { id: 'c2', accountId: 'a00000000000000000000001' }),
      ),
    );
  });
  return renderer!.root;
}

/** A Group's checkbox, found by the label around it, as the member reads it. */
const box = (root: ReactTestInstance, name: string) =>
  root
    .find((node) => node.type === 'label' && textOf(node).includes(name))
    .find((node) => node.type === 'input' && node.props.type === 'checkbox');
const press = async (button: ReactTestInstance) => {
  await act(async () => {
    button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
};
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && textOf(node).trim() === label);
const toggle = async (root: ReactTestInstance, name: string, checked: boolean) => {
  await act(async () => {
    box(root, name).props.onChange({
      target: { checked },
      nativeEvent: { defaultPrevented: false },
    });
  });
};

describe('an assistant’s page (#620)', () => {
  it('shows its access, last use and Groups, with those it leaves out unticked', async () => {
    server();
    const root = await open();
    const shown = textOf(root);
    for (const line of [
      'Synthetic Assistant',
      'assistant.example.test/client.json',
      'Read only + To review',
      'Not used yet',
      'Priya Shah doesn’t allow assistants in this Group',
      'Changes here apply from Synthetic Assistant’s next call.',
      'To change To review access, disconnect it and connect it again.',
    ])
      expect(shown).toContain(line);
    expect(box(root, 'Maple House').props.checked).toBe(true);
    expect(box(root, 'Goa Friends Trip').props.checked).toBe(false);
    expect(box(root, 'Studio Lunch Club').props).toMatchObject({ checked: false, disabled: true });
  });

  it('saves the Groups ticked and unticked, for the assistant’s next call', async () => {
    const calls = server(() => Response.json({ excludedGroupIds: [HOME] }));
    const root = await open();
    expect(button(root, 'Save changes').props.disabled).toBe(true);
    await toggle(root, 'Goa Friends Trip', true);
    await toggle(root, 'Maple House', false);
    await press(button(root, 'Save changes'));
    expect(calls).toEqual([
      { url: '/api/auth/mcp/connection-groups', body: { id: 'c2', excludedGroupIds: [HOME] } },
    ]);
    expect(textOf(root)).toContain(
      'Saved. Synthetic Assistant uses these Groups from its next call.',
    );
    expect(button(root, 'Save changes').props.disabled).toBe(true);
  });

  it('asks for at least one Group before saving', async () => {
    server();
    const root = await open();
    await toggle(root, 'Maple House', false);
    expect(textOf(root)).toContain('Pick at least one Group.');
    expect(button(root, 'Save changes').props.disabled).toBe(true);
  });

  it('keeps the member’s choice and says so when saving fails', async () => {
    server(() => new Response(null, { status: 500 }));
    const root = await open();
    await toggle(root, 'Goa Friends Trip', true);
    await press(button(root, 'Save changes'));
    expect(textOf(root)).toContain('Your Groups couldn’t be saved. Try again.');
    expect(box(root, 'Goa Friends Trip').props.checked).toBe(true);
    expect(button(root, 'Save changes').props.disabled).toBeFalsy();
  });

  it('disconnects after the confirmation Settings asks for, then goes back to Settings', async () => {
    const calls = server();
    const root = await open();
    await press(button(root, 'Disconnect'));
    const dialog = root.find((node) => node.props.role === 'dialog');
    expect(textOf(dialog)).toContain('Disconnect Synthetic Assistant?');
    expect(textOf(dialog)).toContain('The assistant stops at once.');
    await press(
      dialog.find((node) => node.type === 'button' && textOf(node).trim() === 'Disconnect'),
    );
    expect(calls).toEqual([{ url: '/api/auth/mcp/revoke', body: { id: 'c2' } }]);
    expect(navigation.replace).toHaveBeenCalledWith('/settings#connected-assistants');
  });

  it('says when the assistant isn’t connected any more', async () => {
    server(undefined, { reading: () => Response.json({ message: 'Not found' }, { status: 404 }) });
    const root = await open();
    expect(textOf(root)).toContain(
      'This assistant isn’t connected any more. It may have been disconnected or expired.',
    );
    expect(root.findAll((node) => node.type === 'input')).toEqual([]);
  });

  it('keeps the member on the page when Disconnect isn’t confirmed, and revokes nothing on Cancel', async () => {
    const calls = server(undefined, { revoking: () => new Response(null, { status: 500 }) });
    const root = await open();
    await press(button(root, 'Disconnect'));
    let dialog = root.find((node) => node.props.role === 'dialog');
    await press(dialog.find((node) => node.type === 'button' && textOf(node).trim() === 'Cancel'));
    expect(calls).toEqual([]);
    await press(button(root, 'Disconnect'));
    dialog = root.find((node) => node.props.role === 'dialog');
    await press(
      dialog.find((node) => node.type === 'button' && textOf(node).trim() === 'Disconnect'),
    );
    expect(calls).toEqual([{ url: '/api/auth/mcp/revoke', body: { id: 'c2' } }]);
    expect(textOf(dialog)).toContain('Could not confirm disconnection. Reload and try again.');
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
