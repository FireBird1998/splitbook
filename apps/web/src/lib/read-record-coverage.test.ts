import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import {
  acrossCases,
  acrossReads,
  exportReads,
  groupReads,
  groupSections,
  inapplicableReadCases,
} from './test-utils/reads/catalog';
import { assistantInapplicableCases, assistantTools } from './test-utils/reads/assistant';
import { metadataReads } from './test-utils/reads/metadata';
import { readCases } from './test-utils/reads/fixture';
const sourceRoot = resolve(import.meta.dirname, '..');
const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
function exportsName(file: string, name: string) {
  return parse(file).statements.some((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      return statement.exportClause.elements.some((entry) => entry.name.text === name);
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      return false;
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === name;
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name)
          ? declaration.name.text === name
          : declaration.name.elements.some(
              (entry) =>
                ts.isBindingElement(entry) &&
                ts.isIdentifier(entry.name) &&
                entry.name.text === name,
            ),
      );
    return false;
  });
}
export const nonLedgerGetRoutes = {
  'cron/exchange-rates/route.ts':
    'Protected scheduled provider refresh, outside a member ledger read.',
  'notifications/device/route.ts': 'Android notification-device status, outside a Group ledger.',
  'auth/[...all]/route.ts': 'Better Auth owns authentication, not a ledger read.',
  'mcp/route.ts':
    'GET is method-not-allowed. The authenticated POST tool layer is recorded separately.',
  'user/profile/route.ts': 'Account profile, with no Group ledger.',
  'invitations/route.ts': 'Incoming invitations, outside the member-ledger reads named in #1120.',
  'join/[code]/route.ts': 'Public invitation preview, before Group membership.',
};
it('covers every current ledger GET and the read-only Draft-review POST', () => {
  const api = resolve(sourceRoot, 'app/api');
  const actual = readdirSync(api, { recursive: true }).filter(
    (file): file is string =>
      typeof file === 'string' &&
      file.endsWith('route.ts') &&
      exportsName(resolve(api, file), 'GET'),
  );
  const covered = new Set(
    [...groupReads.filter((read) => read.method !== 'POST'), ...acrossReads, ...exportReads].map(
      (read) => read.file,
    ),
  );
  expect(actual.filter((file) => !covered.has(file)).sort()).toEqual(
    Object.keys(nonLedgerGetRoutes).sort(),
  );
  expect([...covered].filter((file) => !actual.includes(file))).toEqual([]);
  expect(groupReads.filter((read) => read.method === 'POST').map((read) => read.file)).toEqual([
    'groups/[id]/drafts/review/route.ts',
  ]);
  expect(exportsName(resolve(api, 'groups/[id]/drafts/review/route.ts'), 'POST')).toBe(true);
  expect(new Set(groupReads.map((read) => read.section))).toEqual(new Set(groupSections));
});
function snapshotKeys() {
  const keys = new Set<string>();
  const folder = resolve(import.meta.dirname, '__snapshots__');
  for (const file of readdirSync(folder).filter(
    (file) => file.startsWith('read-') && file.endsWith('.snap'),
  )) {
    for (const statement of parse(resolve(folder, file)).statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression))
        continue;
      const target = statement.expression.left;
      if (
        ts.isElementAccessExpression(target) &&
        target.argumentExpression &&
        ts.isStringLiteralLike(target.argumentExpression)
      )
        keys.add(target.argumentExpression.text);
    }
  }
  return keys;
}
it('has a stored answer for every declared HTTP reader and explicit non-applicable combination', () => {
  const keys = snapshotKeys();
  for (const read of [...groupReads, ...acrossReads, ...exportReads])
    for (const state of read.scope === 'across' ? acrossCases : readCases)
      expect(keys.has(`${read.name} / ${state} 1`), `${read.name} / ${state}`).toBe(true);
  for (const state of readCases) expect(keys.has(`Statement page / ${state} 1`)).toBe(true);
  expect(new Set([...acrossCases, ...inapplicableReadCases.across])).toEqual(new Set(readCases));
  expect(inapplicableReadCases.reason).toContain('no Group id');
  expect(inapplicableReadCases.httpAssistantRestrictions).toContain('Connected assistant');
});
it('records every registered assistant tool through its applicable Group cases', () => {
  const registered = new Set<string>();
  for (const file of ['mcp/tools.ts', 'mcp/connection.ts']) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'registerTool' &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        registered.add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(parse(resolve(import.meta.dirname, file)));
  }
  expect(registered).toEqual(
    new Set([...assistantTools.map((tool) => tool.name), 'connection_status']),
  );
  const keys = snapshotKeys();
  for (const tool of assistantTools) {
    for (const state of [...readCases, 'excluded', 'not-allowed']) {
      if (tool.name === 'list_groups' && (state === 'missing' || state === 'malformed')) {
        expect(assistantInapplicableCases.list_groups[state]).toContain('no Group selector');
      } else expect(keys.has(`${tool.name} / ${state} 1`), `${tool.name} / ${state}`).toBe(true);
    }
  }
  expect(keys.has('connection_status / member 1')).toBe(true);
  expect(keys.has('connection_status / revoked grant 1')).toBe(true);
  expect(assistantInapplicableCases.connection_status).toContain('no Group id');
});
it('records every Group page metadata entry point', () => {
  const pages = resolve(sourceRoot, 'app/(main)/groups/[id]');
  const actual = readdirSync(pages, { recursive: true })
    .filter(
      (file): file is string =>
        typeof file === 'string' &&
        file.endsWith('page.tsx') &&
        exportsName(resolve(pages, file), 'generateMetadata'),
    )
    .map((file) => resolve(pages, file));
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      imports.push(resolve(sourceRoot, node.arguments[0].text.replace('@/', '')) + '.tsx');
    ts.forEachChild(node, visit);
  };
  visit(parse(resolve(import.meta.dirname, 'test-utils/reads/metadata.ts')));
  expect(imports.sort()).toEqual(actual.sort());
  const keys = snapshotKeys();
  for (const read of metadataReads)
    for (const state of readCases) expect(keys.has(`${read.name} / ${state} 1`)).toBe(true);
});
