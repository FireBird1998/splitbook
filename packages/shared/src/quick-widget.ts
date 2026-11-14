import { SEPARATOR } from './separator';
import { readWidgetTagIds } from './widget-setup';
import { widgetTextLevel } from './widget-layout';
import {
  fitWidgetSections,
  fitWidgetLayout,
  widgetText,
  type WidgetDimensions,
} from './widget-sizing';
import type { WidgetCopy, WidgetSession, WidgetTarget } from './balances-widget';
export interface QuickWidgetSetup {
  kind: 'quick';
  widgetId: number;
  accountId: string;
  groupId: string | null;
  /** Absent on widgets placed before Quick actions. */
  mode?: 'expense' | 'payment';
  tagIds?: string[];
}
interface QuickButton {
  id: string;
  label: string;
  summary: string;
  target: WidgetTarget;
  width: number;
  primary: boolean;
  fontSize: number;
}
interface QuickShortcuts {
  header: string | null;
  headerSubtitle: string | null;
  headerHeight: number;
  headerDirection: 'row' | 'column';
  headerIcon: string;
  headerIconSize: number;
  headerTileSize: number;
  headerFontSize: number;
  headerSubtitleFontSize: number;
  fontSize: number;
  padding: number;
  gap: number;
  rows: { height: number; buttons: QuickButton[] }[];
}

/** Geometry and admission are projected here; native drawing just paints rows. */
function tagShortcuts(
  copy: WidgetCopy,
  setup: QuickWidgetSetup,
  size: WidgetDimensions,
  fontScale: number,
  group: string,
  theme: string,
): QuickShortcuts | null {
  const tags = readWidgetTagIds(setup.tagIds).flatMap(
    (id) => copy.tags?.[setup.groupId!]?.rows.find((tag) => tag.id === id) ?? [],
  );
  if (!tags.length || (size.width < 250 && size.height < 180)) return null;
  const padding = 12,
    gap = 6,
    width = size.width - padding * 2;
  const horizontal = size.height < 180;
  const bigHeader = !horizontal && size.width >= 250;
  const text = widgetText(width, fontScale, 1, size.pixelRatio);
  const minimumWidth = Math.max(44, text.line(12) + 16);
  const fitColumns = (count: number) =>
    fitWidgetSections(
      width,
      Array.from({ length: count }, (_, i) => ({
        id: `column-${i}`,
        rows: 1,
        rowHeight: minimumWidth,
        grow: true,
      })),
      gap,
      size.pixelRatio,
    );
  let columnsFit = fitColumns(size.width < 250 ? 2 : 4);
  // Reduce columns before admitting rows: every displayed name must fit in full,
  // except a single Tag using the whole row. Height admission then drops the tail.
  if (!horizontal) {
    for (let count = columnsFit.sections.length; count > 1; count--) {
      const available = columnsFit.sections[0]?.height ?? 0;
      if (tags.every((tag) => text.width(tag.name, 12) + 8 <= available)) break;
      columnsFit = fitColumns(count - 1);
    }
  }
  // A balanced grid avoids a fourth Tag stranded beneath three columns.
  if (!horizontal && tags.length % columnsFit.sections.length) {
    for (let count = columnsFit.sections.length - 1; count >= 2; count--) {
      if (tags.length % count === 0) {
        columnsFit = fitColumns(count);
        break;
      }
    }
  }
  const columns = columnsFit.sections.length;
  if (!horizontal && !columns) return null;
  // The LargeText drawing trades short-row Tags before shrinking type. Real width
  // can admit fewer again; each button is a section, so its gaps are fitted too.
  const cap = [4, 3, 1][widgetTextLevel(fontScale)];
  const across = fitWidgetSections(
    width,
    [
      { id: 'add', rows: 1, rowHeight: Math.max(44, text.line(18) + 16), required: true },
      ...tags
        .slice(0, cap)
        .map((_, i) => ({ id: `tag-${i}`, rows: 1, rowHeight: minimumWidth, grow: true })),
    ],
    gap,
    size.pixelRatio,
  );
  const admitted = across.sections.filter((section) => section.id.startsWith('tag-'));
  let visible = horizontal ? tags.slice(0, admitted.length) : tags;
  if (!horizontal && columns === 1) {
    while (visible.length > 1 && visible.some((tag) => text.width(tag.name, 12) + 8 > width))
      visible = visible.slice(0, -1);
  }
  // A one-column cell never substitutes an ellipsis for a Tag's name.
  if (
    !horizontal &&
    size.width < 140 &&
    visible.some((tag) => text.width(tag.name, 12) + 8 > width)
  )
    visible = [];
  if (!visible.length && (horizontal || size.width >= 140)) return null;
  const rowCount = horizontal ? 1 : Math.ceil(visible.length / columns);
  const addLabel = horizontal || text.width('＋ Add expense', 14) > width ? '＋' : '＋ Add expense';
  const fitted = fitWidgetLayout(
    { ...size, width, height: size.height - padding * 2 },
    fontScale,
    (text, optional) => ({
      sections: [
        ...(!horizontal
          ? [
              {
                id: 'add',
                rows: 1,
                rowHeight: Math.max(40, text.line(addLabel === '＋' ? 18 : 14) + 12),
                required: true,
                grow: !visible.length,
              },
            ]
          : []),
        ...Array.from({ length: rowCount }, (_, i) => ({
          id: `tags-${i}`,
          rows: 1,
          rowHeight: Math.max(36, text.line(12) + 16),
          grow: true,
          required: horizontal,
        })),
        {
          id: 'header',
          rows: visible.length && optional && !widgetTextLevel(fontScale) ? 1 : 0,
          rowHeight: Math.max(
            bigHeader ? 32 : 14,
            text.line(bigHeader ? 15 : 12) + (bigHeader ? text.line(12) : 0),
          ),
          whenComplete: `tags-${rowCount - 1}`,
        },
      ],
      fontSize: text.font(12),
      addFontSize: text.font(addLabel === '＋' ? 18 : 14),
      headerFontSize: text.font(bigHeader ? 15 : 12),
      headerSubtitleFontSize: text.font(12),
    }),
    gap,
  );
  const tagRows = fitted.sections.filter((section) => section.id.startsWith('tags-'));
  if (!fitted.fits || (visible.length > 0 && !tagRows.length)) return null;
  const fullWidth =
    columnsFit.sections.reduce((sum, section) => sum + section.height, 0) +
    Math.max(0, columns - 1) * columnsFit.gap;
  const add: QuickButton = {
    id: 'add',
    label: addLabel,
    summary: `Add expense in ${group}`,
    target: { kind: 'expense', groupId: setup.groupId! },
    width: horizontal ? across.sections[0].height : fullWidth,
    primary: true,
    fontSize: fitted.addFontSize,
  };
  const shown = visible.slice(0, horizontal ? visible.length : tagRows.length * columns);
  const buttons = shown.map((tag, i) => {
    const rowStart = Math.floor(i / columns) * columns;
    const rowColumns = Math.min(columns, shown.length - rowStart);
    return {
      id: tag.id,
      label: tag.name,
      summary: `Add expense in ${group} with ${tag.name}`,
      target: { kind: 'expense-tag' as const, groupId: setup.groupId!, tagId: tag.id },
      width: horizontal
        ? admitted[i].height
        : (fullWidth - (rowColumns - 1) * fitted.gap) / rowColumns,
      primary: false,
      fontSize: fitted.fontSize,
    };
  });
  const rows = horizontal
    ? [{ height: tagRows[0].height, buttons: [add, ...buttons] }]
    : [
        { height: fitted.sections.find((section) => section.id === 'add')!.height, buttons: [add] },
        ...tagRows.map((row, i) => ({
          height: row.height,
          buttons: buttons.slice(i * columns, (i + 1) * columns),
        })),
      ];
  const header = fitted.sections.find((section) => section.id === 'header');
  return {
    header: header ? (horizontal ? 'Add expense' : group) : null,
    headerSubtitle: header
      ? horizontal
        ? `${SEPARATOR}${group}`
        : bigHeader
          ? 'Add an Expense'
          : null
      : null,
    headerDirection: horizontal ? 'row' : 'column',
    headerHeight: header?.height ?? 0,
    headerIcon: bigHeader ? theme : 'brand',
    headerIconSize: bigHeader ? 20 : 14,
    headerTileSize: bigHeader ? 32 : 14,
    headerFontSize: fitted.headerFontSize,
    headerSubtitleFontSize: fitted.headerSubtitleFontSize,
    fontSize: fitted.fontSize,
    rows,
    gap: fitted.gap,
    padding,
  };
}

export function quickWidget(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  fontScale = 1,
) {
  const payment = setup.mode === 'payment';
  const action = payment ? 'Record payment' : 'Add expense';
  const layout = (title: string, subtitle: string | null, normal: boolean) => {
    const compact = size.width < 140;
    const padding = Math.min(10, size.width / 8, size.height / 8),
      gap = 4,
      tileSize = Math.max(
        0,
        Math.min(
          compact && !normal ? 32 : 48,
          size.width - padding * 2 - 1,
          size.height - padding * 2 - 1,
        ),
      );
    const room = Math.max(0, size.width - padding * 2 - (compact ? 0 : tileSize + gap));
    const fitted = fitWidgetLayout(
      { ...size, width: room, height: Math.max(0, size.height - padding * 2) },
      fontScale,
      (text, optional) => {
        const titleFontSize = compact ? 10 : 15;
        const subtitleFontSize = compact ? 10 : 12;
        const titleLines = text.words(title, titleFontSize);
        const subtitleLines = subtitle
          ? normal
            ? [subtitle]
            : text.words(subtitle, subtitleFontSize)
          : [];
        const showTitle = !compact || (!normal && optional);
        const showSubtitle = !compact && optional && !!subtitle;
        const messageHeight =
          (showTitle ? titleLines.length * text.line(titleFontSize) : 0) +
          (showSubtitle ? 4 + subtitleLines.length * text.line(subtitleFontSize) : 0);
        return {
          sections: [
            {
              id: 'action',
              rows: 1,
              rowHeight: compact
                ? tileSize + (showTitle ? 4 + messageHeight : 0)
                : Math.max(tileSize, messageHeight),
              required: true,
            },
          ],
          showTitle,
          showSubtitle,
          titleLines,
          subtitleLines,
          subtitleMaxLines: 1,
          titleFontSize: text.font(titleFontSize),
          subtitleFontSize: text.font(subtitleFontSize),
          titleLineHeight: text.line(titleFontSize),
          subtitleLineHeight: text.line(subtitleFontSize),
        };
      },
      0,
    );
    const text = widgetText(room, fontScale, fitted.textFactor, size.pixelRatio);
    const fallback =
      !fitted.fits ||
      (fitted.showTitle &&
        fitted.titleLines.some((line) => text.width(line, compact ? 10 : 15) > room));
    return {
      ...fitted,
      ...(fallback
        ? fitWidgetLayout(
            { ...size, height: Math.max(0, size.height - padding * 2) },
            fontScale,
            () => ({ sections: [{ id: 'mark', rows: 1, rowHeight: tileSize, required: true }] }),
            0,
          )
        : {}),
      padding,
      gap,
      tileSize,
      glyphSize: normal
        ? tileSize
        : session.status === 'signed-out'
          ? tileSize * 0.625
          : tileSize / 2,
      tileTone: normal ? 'surface' : session.status === 'signed-out' ? 'brand' : 'muted',
      compact: compact || fallback,
      showTile: true,
      showTitle: fitted.showTitle && !fallback,
      showSubtitle: fitted.showSubtitle && !fallback,
      icon: normal
        ? payment
          ? 'payment'
          : 'expense'
        : session.status === 'signed-out'
          ? 'brand'
          : session.status === 'expired'
            ? 'lock'
            : title === 'Group archived'
              ? 'archive'
              : title === 'Set up again'
                ? 'account'
                : 'info',
    };
  };
  const blocked = (
    state: string,
    title: string,
    subtitle: string | null,
    target: WidgetTarget,
  ) => ({
    state,
    shortcuts: null as QuickShortcuts | null,
    layout: layout(title, subtitle, false),
    size,
    title,
    subtitle,
    summary: [
      ...(session.status === 'authenticated' && state !== 'other-account'
        ? [state === 'archived' && group ? `${action} in ${group.name}` : action]
        : []),
      title,
      subtitle,
    ]
      .filter(Boolean)
      .join('. '),
    target,
  });
  if (session.status !== 'authenticated')
    return blocked(
      session.status,
      session.status === 'expired' ? 'Sign in again' : 'Sign in',
      payment ? 'to record payments' : 'to add expenses',
      'sign-in',
    );
  if (session.accountId !== setup.accountId || (copy && copy.accountId !== setup.accountId))
    return blocked('other-account', 'Set up again', 'Another account', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  if (setup.groupId && copy && copy.lostGroupIds?.includes(setup.groupId))
    return blocked('lost-access', 'Not in this Group', 'Choose a Group', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  const group =
    setup.groupId && copy?.accountId === setup.accountId
      ? (copy.groups?.[setup.groupId] ?? copy.savedGroups?.rows.find((g) => g.id === setup.groupId))
      : null;
  if (group?.archived)
    return blocked('archived', 'Group archived', 'Choose another', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  if (payment && !setup.groupId)
    return blocked('no-group', 'Choose a Group', null, { kind: 'setup', widgetId: setup.widgetId });
  const subtitle = group?.name ?? 'Choose a Group';
  return {
    state: 'normal',
    shortcuts:
      !payment && group && copy
        ? tagShortcuts(copy, setup, size, fontScale, group.name, group.theme)
        : null,
    layout: layout(action, subtitle, true),
    size,
    title: action,
    subtitle,
    summary: group ? `${action} in ${group.name}` : `${action}. Choose a Group`,
    target: (setup.groupId
      ? { kind: payment ? 'record-payment' : 'expense', groupId: setup.groupId }
      : 'choose-group') as WidgetTarget,
  };
}
