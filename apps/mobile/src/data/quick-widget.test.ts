import { expect, it } from 'vitest';
import { quickWidget, type QuickWidgetSetup } from '@splitbook/shared/quick-widget';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup: QuickWidgetSetup = { kind: 'quick', widgetId: 8, accountId: 'alex', groupId: null };
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: null,
  savedGroups: {
    verifiedAt: 1,
    rows: [
      {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: false,
        members: 3,
        currencies: 1,
      },
    ],
  },
};
it('defaults to Ask each time and names a chosen Group even for the icon-only widget', () => {
  expect(quickWidget(copy, setup, { width: 172, height: 104 }, session)).toMatchObject({
    title: 'Add expense',
    subtitle: 'Choose a Group',
    target: 'choose-group',
    summary: 'Add expense. Choose a Group',
  });
  expect(
    quickWidget(copy, { ...setup, groupId: 'maple' }, { width: 78, height: 104 }, session),
  ).toMatchObject({
    title: 'Add expense',
    subtitle: 'Maple House',
    summary: 'Add expense in Maple House',
    target: { kind: 'expense', groupId: 'maple' },
  });
});
for (const size of ['1x1', '2x1'] as const)
  it(`keeps every account and access state safe at ${size}`, () => {
    const chosen = { ...setup, groupId: 'maple' };
    expect(
      quickWidget(
        copy,
        chosen,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        { status: 'signed-out' },
      ),
    ).toMatchObject({
      state: 'signed-out',
      title: 'Sign in',
      subtitle: 'to add expenses',
      target: 'sign-in',
    });
    expect(
      quickWidget(
        copy,
        chosen,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        { status: 'expired' },
      ),
    ).toMatchObject({
      state: 'expired',
      title: 'Sign in again',
      subtitle: 'to add expenses',
      target: 'sign-in',
    });
    expect(
      quickWidget(
        copy,
        chosen,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        { ...session, accountId: 'sam' },
      ),
    ).toMatchObject({
      state: 'other-account',
      title: 'Set up again',
      subtitle: 'Another account',
      target: { kind: 'setup', widgetId: 8 },
    });
    expect(
      quickWidget(
        { ...copy, lostGroupIds: ['maple'] },
        chosen,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        session,
      ),
    ).toMatchObject({
      state: 'lost-access',
      title: 'Not in this Group',
      subtitle: 'Choose a Group',
      target: { kind: 'setup', widgetId: 8 },
    });
    expect(
      quickWidget(
        {
          ...copy,
          savedGroups: {
            ...copy.savedGroups!,
            rows: [{ ...copy.savedGroups!.rows[0], archived: true }],
          },
        },
        chosen,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        session,
      ),
    ).toMatchObject({
      state: 'archived',
      title: 'Group archived',
      subtitle: 'Choose another',
      target: { kind: 'setup', widgetId: 8 },
    });
    for (const status of [
      { status: 'signed-out' as const },
      { status: 'expired' as const },
      { ...session, accountId: 'sam' },
    ])
      expect(
        JSON.stringify(
          quickWidget(
            copy,
            chosen,
            size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
            status,
          ),
        ),
      ).not.toContain('Maple');
  });
it('uses the Group read archive flag ahead of an older active list entry', () => {
  const archived = {
    ...copy,
    groups: {
      maple: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home' as const,
        archived: true,
        mainCurrency: 'INR',
        verifiedAt: 2,
        balancesVerifiedAt: 2,
        currencies: [],
      },
    },
  };
  expect(
    quickWidget(archived, { ...setup, groupId: 'maple' }, { width: 172, height: 104 }, session),
  ).toMatchObject({
    state: 'archived',
    title: 'Group archived',
  });
  expect(
    quickWidget(
      { ...copy, accountId: 'sam' },
      { ...setup, groupId: 'maple' },
      { width: 172, height: 104 },
      session,
    ).state,
  ).toBe('other-account');
});

it('writes the action and Group at real 2×1 bounds, including large text and Record payment', () => {
  for (const mode of ['expense', 'payment'] as const)
    for (const scale of [1, 1.3, 2]) {
      const view = quickWidget(
        copy,
        { ...setup, groupId: 'maple', mode },
        { width: 172, height: 104 },
        session,
        scale,
      );
      expect(view.title).toBe(mode === 'expense' ? 'Add expense' : 'Record payment');
      expect(view.subtitle).toBe('Maple House');
      expect(view.layout.showTitle).toBe(scale < 2);
      expect(view.layout.showSubtitle).toBe(scale < 2);
      expect(view.layout.fits).toBe(true);
      expect(view.summary).toBe(`${view.title} in Maple House`);
      expect(view.target).toEqual({
        kind: mode === 'expense' ? 'expense' : 'record-payment',
        groupId: 'maple',
      });
    }
});

for (const [width, height] of [
  [40, 40],
  [78, 104],
  [172, 104],
  [266, 104],
  [360, 104],
  [172, 224],
  [360, 224],
  [360, 344],
])
  for (const scale of [1, 1.3, 2])
    for (const mode of ['expense', 'payment'] as const)
      it(`fits both actions and their access states in ${width}×${height} dp at ${scale}× (${mode})`, () => {
        const chosen = { ...setup, groupId: 'maple', mode };
        const size = { width, height, pixelRatio: 2.625 };
        const normal = quickWidget(copy, chosen, size, session, scale);
        expect(normal.layout.fits).toBe(true);
        expect(normal.summary).toContain('Maple House');
        if (width < 140) expect(normal.layout.showTitle).toBe(false);
        if (width >= 360) expect(normal.layout.showSubtitle).toBe(true);
        const states = [
          quickWidget(copy, chosen, size, { status: 'signed-out' }, scale),
          quickWidget(copy, chosen, size, { status: 'expired' }, scale),
          quickWidget(copy, chosen, size, { ...session, accountId: 'sam' }, scale),
          quickWidget({ ...copy, lostGroupIds: ['maple'] }, chosen, size, session, scale),
          quickWidget(
            {
              ...copy,
              savedGroups: {
                ...copy.savedGroups!,
                rows: [{ ...copy.savedGroups!.rows[0], archived: true }],
              },
            },
            chosen,
            size,
            session,
            scale,
          ),
        ];
        expect(states.map((s) => s.state)).toEqual([
          'signed-out',
          'expired',
          'other-account',
          'lost-access',
          'archived',
        ]);
        for (const state of states) expect(state.layout.fits).toBe(true);
        expect(states[0].subtitle).toBe(
          mode === 'payment' ? 'to record payments' : 'to add expenses',
        );
      });

it('uses the mark and badge when enlarged action words cannot fit, rather than ellipsizing the action', () => {
  const view = quickWidget(
    copy,
    { ...setup, groupId: 'maple', mode: 'payment' },
    { width: 172, height: 104 },
    session,
    2,
  );
  expect(view.layout).toMatchObject({
    compact: true,
    showTitle: false,
    showSubtitle: false,
    icon: 'payment',
    fits: true,
  });
  expect(view.summary).toBe('Record payment in Maple House');
});

it('wraps a blocked action’s reason in full and keeps its status glyph inside the muted tile', () => {
  const view = quickWidget(
    copy,
    { ...setup, groupId: 'maple', mode: 'payment' },
    { width: 172, height: 104 },
    { status: 'expired' },
  );
  expect(view.layout).toMatchObject({
    subtitleLines: ['to record', 'payments'],
    showSubtitle: true,
    glyphSize: 24,
    tileTone: 'muted',
  });
});

it('blocked summaries retain the action and only name an available Group', () => {
  const chosen = { ...setup, groupId: 'maple', mode: 'payment' as const };
  const size = { width: 172, height: 104 };
  expect(quickWidget(copy, { ...chosen, groupId: null }, size, session).summary).toBe(
    'Record payment. Choose a Group',
  );
  expect(quickWidget({ ...copy, lostGroupIds: ['maple'] }, chosen, size, session).summary).toBe(
    'Record payment. Not in this Group. Choose a Group',
  );
  expect(
    quickWidget(
      {
        ...copy,
        savedGroups: {
          ...copy.savedGroups!,
          rows: [{ ...copy.savedGroups!.rows[0], archived: true }],
        },
      },
      chosen,
      size,
      session,
    ).summary,
  ).toBe('Record payment in Maple House. Group archived. Choose another');
  expect(quickWidget(copy, chosen, size, { ...session, accountId: 'sam' }).summary).toBe(
    'Set up again. Another account',
  );
});

it('draws ordered Tag shortcuts in a row or grid and drops the header before the last Tags at large text', () => {
  const tags = ['Groceries', 'Rent', 'Bills', 'Dining'].map((name, i) => ({ id: `tag${i}`, name }));
  const tagged = { ...copy, tags: { maple: tags } };
  const chosen = { ...setup, groupId: 'maple', tagIds: tags.map((tag) => tag.id) };
  for (const size of [
    { width: 360, height: 104 },
    { width: 172, height: 224 },
    { width: 360, height: 224 },
  ]) {
    const view = quickWidget(tagged, chosen, size, session);
    expect(
      view.shortcuts?.rows.flatMap((row) => row.buttons).map((button) => button.label),
    ).toEqual(
      size.height < 180
        ? ['＋', 'Groceries', 'Rent', 'Bills', 'Dining']
        : ['＋ Add expense', 'Groceries', 'Rent', 'Bills', 'Dining'],
    );
    expect(
      view.shortcuts?.rows
        .flatMap((row) => row.buttons)
        .slice(1)
        .map((button) => button.summary),
    ).toEqual(tags.map((tag) => `Add expense in Maple House with ${tag.name}`));
    if (size.width < 200)
      expect(view.shortcuts?.rows.map((row) => row.buttons.length)).toEqual([1, 2, 2]);
  }
  for (const [scale, count] of [
    [1.3, 3],
    [2, 1],
  ]) {
    const view = quickWidget(tagged, chosen, { width: 360, height: 104 }, session, scale);
    expect(view.shortcuts?.header).toBeNull();
    expect(
      view.shortcuts?.rows
        .flatMap((row) => row.buttons)
        .slice(1)
        .map((button) => button.label),
    ).toEqual(tags.slice(0, count).map((tag) => tag.name));
  }
  const archived = quickWidget(
    { ...tagged, tags: { maple: tags.filter((tag) => tag.id !== 'tag1') } },
    chosen,
    { width: 360, height: 104 },
    session,
  );
  expect(
    archived.shortcuts?.rows
      .flatMap((row) => row.buttons)
      .slice(1)
      .map((button) => button.label),
  ).toEqual(['Groceries', 'Bills', 'Dining']);
  expect(
    quickWidget({ ...tagged, tags: { maple: [] } }, chosen, { width: 360, height: 104 }, session)
      .shortcuts,
  ).toBeNull();
});

it('fits three ordered Tags at real 3×1 bounds and keeps a long Group name for ellipsis', () => {
  const tags = ['Groceries', 'Rent', 'Bills', 'Dining'].map((name, i) => ({ id: String(i), name }));
  const view = quickWidget(
    { ...copy, tags: { maple: tags } },
    { ...setup, groupId: 'maple', tagIds: ['0', '1', '2', '3'] },
    { width: 266, height: 104 },
    session,
  );
  expect(view.shortcuts?.rows[0].buttons.map((button) => button.label)).toEqual([
    '＋',
    'Groceries',
    'Rent',
    'Bills',
  ]);
  const long = 'Maple House with a very long Group name';
  const named = quickWidget(
    {
      ...copy,
      savedGroups: { ...copy.savedGroups!, rows: [{ ...copy.savedGroups!.rows[0], name: long }] },
    },
    { ...setup, groupId: 'maple' },
    { width: 172, height: 104 },
    session,
  );
  expect(named.subtitle).toBe(long);
  expect(named.summary).toContain(long);
});
