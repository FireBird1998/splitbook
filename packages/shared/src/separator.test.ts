import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { counted, NO_BREAK_SEPARATOR, NO_BREAK_SPACE, SEPARATOR, WORD_JOINER } from './separator';

// #895: a line that wraps at a " · " with an ordinary space before the dot starts with "·". Every
// UI text that joins its parts with " · " uses SEPARATOR, whose no-break space keeps the dot at
// the end of the line it follows. This guard reads the words both clients show, as written in
// their source: the strings, the template literals and the JSX text.

/**
 * Where UI text is written: the shared words, the web app and the Android app, whose root screen
 * is App.tsx, beside its src.
 */
const UI_SOURCES = [
  'packages/shared/src',
  'apps/web/src',
  'apps/mobile/src',
  'apps/mobile/App.tsx',
];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/**
 * Left as they are, each for its reason. A test below fails once an entry no longer needs to be
 * here, so the list can only shrink.
 */
const ALLOWED: { path: string; why: string }[] = [
  {
    path: 'apps/web/src/components/landing-figures/generated/',
    why:
      'tools/landing-figures writes these and nobody edits them by hand (AGENTS.md). Their ' +
      'readouts change in that tool, which redraws the figures’ stills with them.',
  },
];

interface Finding {
  file: string;
  line: number;
  text: string;
}

/**
 * A JSX text as React renders it, as the JSX transform cleans it: each line trimmed where it meets
 * a line break, blank lines dropped, and the rest joined by a space.
 */
function renderedJsxText(raw: string): string {
  const lines = raw.replace(/\t/g, ' ').split(/\r\n|\n|\r/);
  const trimmed = lines.map((line, index) => {
    const start = index === 0 ? line : line.replace(/^ +/, '');
    return index === lines.length - 1 ? start : start.replace(/ +$/, '');
  });
  return trimmed.filter(Boolean).join(' ');
}

/** A plain space (U+0020) right before the dot: a line can break there and start with "·". */
const PLAIN_SEPARATOR = / ·/;

const SEPARATORS = new Set(['SEPARATOR', 'NO_BREAK_SEPARATOR']);
const isSeparator = (node: ts.Node | undefined) =>
  node !== undefined && ts.isIdentifier(node) && SEPARATORS.has(node.text);

/** The JSX children around `node` that render something: a blank line between them renders nothing. */
function renderedSiblings(node: ts.JsxChild) {
  const siblings = (node.parent as ts.JsxElement | ts.JsxFragment).children.filter(
    (child) => !ts.isJsxText(child) || renderedJsxText(child.text) !== '' || child === node,
  );
  const index = siblings.indexOf(node);
  return { before: siblings[index - 1], after: siblings[index + 1] };
}

/** What a JSX child renders at its edge, when the source says: its text, or a string's. */
function jsxChildText(child: ts.JsxChild | undefined): string | null {
  if (child === undefined) return null;
  if (ts.isJsxText(child)) return renderedJsxText(child.text);
  if (ts.isJsxExpression(child) && child.expression && ts.isStringLiteralLike(child.expression))
    return child.expression.text;
  return null;
}

function plainSeparators(file: string, source: string): Finding[] {
  const kind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) =>
    findings.push({
      file,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      text,
    });
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (PLAIN_SEPARATOR.test(node.text)) report(node, node.text);
    } else if (ts.isJsxText(node)) {
      const text = renderedJsxText(node.text);
      // `{' '}` and then "· this month" on the next line read " · this month".
      const spaceBefore = jsxChildText(renderedSiblings(node).before)?.endsWith(' ') ?? false;
      if (PLAIN_SEPARATOR.test(text) || (spaceBefore && text.startsWith('·'))) report(node, text);
    } else if (ts.isJsxExpression(node) && isSeparator(node.expression)) {
      // "{name}{' '}{SEPARATOR}" still has a plain space before the dot.
      if (jsxChildText(renderedSiblings(node).before)?.endsWith(' '))
        report(node, node.getText(tree));
    } else if (ts.isTemplateExpression(node)) {
      // `${name} ${SEPARATOR}` too.
      node.templateSpans.forEach((span, index) => {
        const before = index === 0 ? node.head : node.templateSpans[index - 1]!.literal;
        if (isSeparator(span.expression) && before.text.endsWith(' '))
          report(span, `${before.text}\${${span.expression.getText(tree)}}`);
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

// #898: at 200% "2 members" broke into "2 / members". A count and its noun are one: `counted`
// joins them with a no-break space. This guard finds a count and a noun joined by a plain space,
// as the clients write them: a choice between one and many after a count, or a noun the app
// counts right after an expression.

/** The nouns the app counts, one or many: "3 Expenses", "2 currencies", "1 person". */
const COUNTED_NOUN =
  /^ (Debts?|Expenses?|Groups?|Members?|Payments?|currenc(?:y|ies)|days?|debts?|expenses?|items?|members?|months?|payments?|people|person|places?|shares?|things?|ways?|Settlements?|invitations?|edits?)\b/;

/** `count === 1 ? one : many`, or its `!== 1` turn: the noun chosen for a count. */
function pluralChoice(node: ts.Node | undefined): node is ts.ConditionalExpression {
  if (node === undefined) return false;
  const choice = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (!ts.isConditionalExpression(choice)) return false;
  const test = ts.isParenthesizedExpression(choice.condition)
    ? choice.condition.expression
    : choice.condition;
  return (
    ts.isBinaryExpression(test) &&
    [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(
      test.operatorToken.kind,
    ) &&
    [test.left, test.right].some((side) => ts.isNumericLiteral(side) && side.text === '1')
  );
}

/** An expression as written, without parentheses, casts, spaces or a `?? 0`. */
const bare = (node: ts.Node, tree: ts.SourceFile) =>
  node
    .getText(tree)
    .replace(/\s+as\s+\w+/g, '')
    .replace(/\?\?\s*0/g, '')
    .replace(/[()\s]/g, '');

/** The condition's side that isn't the 1: the count the choice is for. */
function choiceCount(choice: ts.ConditionalExpression): ts.Expression {
  let test = choice.condition;
  while (ts.isParenthesizedExpression(test)) test = test.expression;
  const { left, right } = test as ts.BinaryExpression;
  return ts.isNumericLiteral(left) ? right : left;
}

/**
 * Whether an expression reads as a count by its name: a `.length`, a count or total, a number
 * of things, or a constant such as `MAX_CUSTOM_RANGE_DAYS`.
 */
const COUNT_NAME =
  /(^|\.)(length|count|total|shares|missing|groups|others|more|unreadable|edits|kept|skipped|waiting|ageDays)$|(Count|Total|Days|Months)$|^[A-Z0-9_]*(MAX|MIN|PER|DAYS|MONTHS|COUNT|LIMIT)[A-Z0-9_]*(\.(min|max|default))?$/;
function countExpression(node: ts.Node, tree: ts.SourceFile): boolean {
  if (ts.isParenthesizedExpression(node)) return countExpression(node.expression, tree);
  if (ts.isBinaryExpression(node))
    return [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)
      ? countExpression(node.left, tree) || countExpression(node.right, tree)
      : node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          countExpression(node.left, tree);
  return (
    (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) &&
    COUNT_NAME.test(node.getText(tree).replace(/\?\./g, '.'))
  );
}

/**
 * Whether `text`, between a count and the choice of its noun, is a plain space: " " before the
 * noun, " member" before its "s", or nothing before " items".
 */
function plainCount(text: string | null, choice: ts.ConditionalExpression): boolean {
  const [one, many] = [choice.whenTrue, choice.whenFalse].map((branch) =>
    ts.isStringLiteralLike(branch) ? branch.text : null,
  );
  if (text === null) return false;
  if ([one, many].includes('')) return /^ \p{L}+$/u.test(text);
  if ([one, many].some((branch) => branch?.startsWith(' '))) return text === '';
  return text === ' ';
}

function plainCounts(file: string, source: string): Finding[] {
  const kind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) =>
    findings.push({
      file,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      text,
    });
  /** The count right before a choice of its noun, by what the choice compares to 1. */
  const sameCount = (before: ts.Node | undefined, choice: ts.ConditionalExpression) =>
    before !== undefined && bare(before, tree) === bare(choiceCount(choice), tree);
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node)) {
      node.templateSpans.forEach((span, index) => {
        // `${count} ${count === 1 ? 'member' : 'members'}`, `${n} member${n !== 1 ? 's' : ''}`.
        const previous = node.templateSpans[index - 1];
        if (
          previous &&
          pluralChoice(span.expression) &&
          sameCount(previous.expression, span.expression) &&
          plainCount(previous.literal.text, span.expression)
        )
          report(span, span.expression.getText(tree));
        // `${items.length} Expenses`, when no choice of its "s" follows.
        const next = node.templateSpans[index + 1];
        if (
          COUNTED_NOUN.test(span.literal.text) &&
          countExpression(span.expression, tree) &&
          !(next && pluralChoice(next.expression))
        )
          report(span.literal, `\${${span.expression.getText(tree)}}${span.literal.text}`);
      });
    } else if (ts.isJsxExpression(node) && node.expression && pluralChoice(node.expression)) {
      // {n} {n === 1 ? 'Expense' : 'Expenses'}, {n}{' '}{…}, {n} member{…}, {n}{n === 1 ? ' item' : …}.
      const children = (node.parent as ts.JsxElement | ts.JsxFragment).children.filter(
        (child) => !ts.isJsxText(child) || renderedJsxText(child.text) !== '',
      );
      const index = children.indexOf(node);
      const before = children[index - 1];
      const between = before && jsxChildText(before) !== null;
      const count = between ? children[index - 2] : before;
      const text = between ? jsxChildText(before) : '';
      if (
        count !== undefined &&
        ts.isJsxExpression(count) &&
        count.expression &&
        sameCount(count.expression, node.expression) &&
        plainCount(text, node.expression)
      )
        report(node, node.getText(tree));
    } else if (ts.isJsxText(node)) {
      // {total} Expenses
      const { before, after } = renderedSiblings(node);
      const choice = after && ts.isJsxExpression(after) && pluralChoice(after.expression);
      if (
        !choice &&
        before !== undefined &&
        ts.isJsxExpression(before) &&
        before.expression &&
        countExpression(before.expression, tree) &&
        COUNTED_NOUN.test(node.text)
      )
        report(node, renderedJsxText(node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

function workspaceRoot(): string {
  let directory = ts.sys.getCurrentDirectory();
  while (!ts.sys.fileExists(`${directory}/pnpm-workspace.yaml`)) {
    const parent = directory.replace(/\/[^/]+$/, '');
    if (parent === directory || parent === '') throw new Error('No pnpm-workspace.yaml above here');
    directory = parent;
  }
  return directory;
}

/** Every UI source file, by its path from the workspace root; tests aren't UI text. */
function uiSourceFiles(root: string): string[] {
  return UI_SOURCES.flatMap((source) =>
    ts.sys.fileExists(`${root}/${source}`)
      ? [`${root}/${source}`]
      : ts.sys.readDirectory(`${root}/${source}`, SOURCE_EXTENSIONS, ['**/node_modules']),
  )
    .map((path) => path.slice(root.length + 1))
    .filter((path) => !/\.test\.[jt]sx?$/.test(path))
    .sort();
}

const allowed = (file: string) => ALLOWED.some((entry) => file.startsWith(entry.path));

describe('SEPARATOR', () => {
  it('is a no-break space, the dot and a space', () => {
    expect(NO_BREAK_SPACE).toBe('\u00a0');
    expect(SEPARATOR).toBe('\u00a0· ');
    expect(NO_BREAK_SEPARATOR).toBe('\u00a0·\u00a0');
  });
});

describe('the plain " · " guard (#895)', () => {
  const found = (source: string, file = 'sample.tsx') =>
    plainSeparators(file, source).map(({ line, text }) => ({ line, text }));

  it('finds a plain space before the dot in strings, template literals and JSX text', () => {
    expect(found(`const a = 'Equally · 2';`)).toEqual([{ line: 1, text: 'Equally · 2' }]);
    expect(found(`const b = parts.join(" · ");`)).toEqual([{ line: 1, text: ' · ' }]);
    expect(found('const c = `${day} · ${tag}`;')).toEqual([{ line: 1, text: ' · ' }]);
    expect(found('const d = `Updated ·`;')).toEqual([{ line: 1, text: 'Updated ·' }]);
    expect(found(`const e = <p>{day} · {tag}</p>;`)).toEqual([{ line: 1, text: ' · ' }]);
    expect(found(`const f = <p>\n  {currency} ·\n  {zone}\n</p>;`)).toEqual([
      { line: 2, text: ' ·' },
    ]);
    expect(found(`const g = <p>\n  {month}{' '}\n  · this month\n</p>;`)).toEqual([
      { line: 3, text: '· this month' },
    ]);
  });

  it('finds a plain space left before SEPARATOR', () => {
    expect(found(`const a = <p>\n  <b>{day}</b>{' '}\n  {SEPARATOR}\n  {date}\n</p>;`)).toEqual([
      { line: 3, text: '{SEPARATOR}' },
    ]);
    expect(found(`const b = <p>{day} {SEPARATOR}{date}</p>;`)).toEqual([
      { line: 1, text: '{SEPARATOR}' },
    ]);
    expect(found('const c = `${day} ${SEPARATOR}${date}`;')).toEqual([
      { line: 1, text: ' ${SEPARATOR}' },
    ]);
    expect(found(`const d = <p>\n  <b>{day}</b>\n  {SEPARATOR}\n  {date}\n</p>;`)).toEqual([]);
  });

  it('passes SEPARATOR, the no-break forms and a dot that no space comes before', () => {
    expect(found(`const a = 'Equally\\u00a0· 2';`)).toEqual([]);
    expect(found('const b = `${day}${SEPARATOR}${tag}`;')).toEqual([]);
    expect(found(`const c = parts.join(SEPARATOR);`)).toEqual([]);
    expect(found(`const d = <p>{day}{SEPARATOR}{tag}</p>;`)).toEqual([]);
    expect(found(`const e = 'Equally\u00a0·\u00a02';`)).toEqual([]);
    // A dot set apart by a margin, never by a space.
    expect(found(`const f = <p>{currency}<span>\n  · main\n</span></p>;`)).toEqual([]);
    expect(found(`const g = <span>····</span>;`)).toEqual([]);
  });

  it('leaves comments alone', () => {
    expect(found(`/** "Equally · 2" */\n// "Day 2 · Fri 18 Sep"\nconst a = 1;`)).toEqual([]);
    expect(found(`const a = <p>{/* "Day 2 · Fri" */}</p>;`)).toEqual([]);
  });

  it('reads TypeScript without JSX as TypeScript', () => {
    expect(found(`const a = <number>value; const b = 'x · y';`, 'sample.ts')).toEqual([
      { line: 1, text: 'x · y' },
    ]);
  });
});

describe('UI text (#895)', () => {
  const root = workspaceRoot();
  const files = uiSourceFiles(root);
  const findings = files.flatMap((file) =>
    plainSeparators(file, ts.sys.readFile(`${root}/${file}`) ?? ''),
  );

  it('reads every client’s source', () => {
    for (const source of UI_SOURCES)
      expect(files.filter((file) => file.startsWith(source)).length).toBeGreaterThan(
        /\.tsx?$/.test(source) ? 0 : 50,
      );
  });

  it('joins its parts with SEPARATOR, never with a plain " · "', () => {
    const plain = findings
      .filter(({ file }) => !allowed(file))
      .map(({ file, line, text }) => `${file}:${line} ${JSON.stringify(text)}`);
    expect(plain).toEqual([]);
  });

  it.each(ALLOWED)('still needs to leave $path as it is', ({ path, why }) => {
    expect(why.length).toBeGreaterThan(0);
    expect(findings.filter(({ file }) => file.startsWith(path)).length).toBeGreaterThan(0);
  });
});

describe('counted (#898)', () => {
  it('joins a count and its noun with a no-break space', () => {
    expect(counted(2, 'member')).toBe('2\u00a0members');
    expect(counted(1, 'member')).toBe('1\u00a0member');
    expect(counted(0, 'Expense')).toBe('0\u00a0Expenses');
    expect(counted(2, 'currency', 'currencies')).toBe('2\u00a0currencies');
    expect(counted(1, 'person', 'people')).toBe('1\u00a0person');
  });

  it('has a word joiner for a sign and its figure (#899)', () => {
    expect(WORD_JOINER).toBe('\u2060');
  });
});

describe('the plain count guard (#898)', () => {
  const found = (source: string, file = 'sample.tsx') =>
    plainCounts(file, source).map(({ line, text }) => ({ line, text }));

  it('finds a count and its noun joined by a plain space', () => {
    expect(found("const a = `${n} ${n === 1 ? 'member' : 'members'}`;")).toEqual([
      { line: 1, text: "n === 1 ? 'member' : 'members'" },
    ]);
    expect(found('const b = `${count} ${count === 1 ? one : many}`;')).toHaveLength(1);
    expect(found("const c = `${n} member${n !== 1 ? 's' : ''}`;")).toHaveLength(1);
    expect(found('const d = `Save ${items.length} Expenses?`;')).toEqual([
      { line: 1, text: '${items.length} Expenses?' },
    ]);
    expect(found("const e = <p>{n} {n === 1 ? 'Expense' : 'Expenses'}</p>;")).toHaveLength(1);
    expect(
      found("const f = <p>\n  {n}{' '}\n  {n === 1 ? 'Expense' : 'Expenses'}\n</p>;"),
    ).toHaveLength(1);
    expect(found("const g = <p>{list.length} member{list.length !== 1 ? 's' : ''}</p>;")).toEqual([
      { line: 1, text: "{list.length !== 1 ? 's' : ''}" },
    ]);
    expect(found("const h = <p>{n}{n === 1 ? ' item' : ' items'}</p>;")).toHaveLength(1);
    expect(found('const i = <p>{total} Expenses</p>;')).toEqual([{ line: 1, text: ' Expenses' }]);
  });

  it('passes counted, a no-break space and words that aren’t a count', () => {
    expect(found("const a = counted(n, 'member');")).toEqual([]);
    expect(found("const b = `${n}\\u00a0${n === 1 ? 'member' : 'members'}`;")).toEqual([]);
    expect(found("const c = `${n === 1 ? 'needs details' : 'need details'}`;")).toEqual([]);
    expect(found("const d = `${name} ${n === 1 ? 'owes' : 'each owe'} you`;")).toEqual([]);
    expect(found('const e = `${days}`;')).toEqual([]);
    expect(found("const f = <p>{counted(n, 'Expense')}</p>;")).toEqual([]);
    expect(found('const g = <p>\n  {name}\n  Expenses\n</p>;')).toEqual([]);
  });
});

describe('counts in UI text (#898)', () => {
  const root = workspaceRoot();
  const findings = uiSourceFiles(root)
    .filter((file) => !allowed(file))
    .flatMap((file) => plainCounts(file, ts.sys.readFile(`${root}/${file}`) ?? ''));

  it('joins each count to its noun with counted or a no-break space', () => {
    expect(
      findings.map(({ file, line, text }) => `${file}:${line} ${JSON.stringify(text)}`),
    ).toEqual([]);
  });
});
