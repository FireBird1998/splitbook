import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { NO_BREAK_SEPARATOR, NO_BREAK_SPACE, SEPARATOR } from './separator';

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
