import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';

it.each([
  ['runtime.ts', 2],
  ['widgets.tsx', 1],
  ['widget-setup.tsx', 1],
] as const)('%s opens widget rows with the shared configuration key', (file, count) => {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  expect(text).not.toContain('EXPO_PUBLIC_API_URL');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['createWidgetsStore', 'createWidgetsNative'].includes(node.expression.text)
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(calls).toHaveLength(count);
  for (const call of calls) {
    const key = call.arguments[0];
    expect(ts.isCallExpression(key)).toBe(true);
    if (!ts.isCallExpression(key)) throw new Error(`${file} derives its own widget key`);
    expect(key.expression.getText(source)).toBe('widgetKey');
    expect(key.arguments.map((arg) => arg.getText(source))).toEqual([
      'mobileBuildSettings',
      '__DEV__',
    ]);
  }
});

it('names cross-build placement reconciliation instead of opening an empty environment', () => {
  const source = readFileSync(new URL('widget-lifecycle.ts', import.meta.url), 'utf8');
  expect(source).toContain('reconcileWidgetSetupsAcrossBuilds(');
  expect(source).not.toContain('createWidgetsStore');
});
