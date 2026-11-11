import ts from 'typescript';
import { bindSources, sourceTokens, unwrap, type SourceInput } from './source-program.ts';
import { isRecordingSource } from './recording-contract.ts';

export interface ReadFinding {
  path: string;
  line: number;
  within: string;
  operation: string;
  site: string;
  message: string;
}
export interface AllowedReadSite {
  path: string;
  within: string;
  operation: string;
  site: string;
  reason: string;
}

const modulePath = 'apps/web/src/lib/group-ledger-read.ts';
function owner(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name)
      return parent.name.getText();
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent)
    )
      return parent.parent.name.getText();
  }
  return '';
}

/** Keep read admission and materialization together; exceptions describe one reviewed site. */
export function checkReadSources(
  inputs: readonly SourceInput[],
  allowed: readonly AllowedReadSite[] = [],
): ReadFinding[] {
  const { nodes, symbol, checker } = bindSources(
    inputs.filter((file) => isRecordingSource(file.path)),
  );
  function origins(
    node: ts.Node,
    match: (node: ts.Node) => boolean,
    seen = new Set<ts.Symbol>(),
  ): boolean {
    node = unwrap(node);
    if (match(node)) return true;
    const found = symbol(node);
    if (!found || seen.has(found)) return false;
    const next = new Set(seen).add(found);
    return (found.declarations ?? []).some((declaration) => {
      if (match(declaration)) return true;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        return origins(declaration.initializer, match, next);
      if (ts.isShorthandPropertyAssignment(declaration)) {
        const value = checker.getShorthandAssignmentValueSymbol(declaration);
        return value?.declarations?.some((d) => match(d)) ?? false;
      }
      if (ts.isBindingElement(declaration)) {
        const binding = declaration.parent.parent;
        if (ts.isVariableDeclaration(binding) && binding.initializer) {
          const key = (declaration.propertyName ?? declaration.name).getText();
          const property = checker.getPropertyOfType(
            checker.getTypeAtLocation(binding.initializer),
            key,
          );
          return property?.declarations?.some((d) => match(d)) ?? false;
        }
      }
      return false;
    });
  }
  function property(node: ts.Node, name: string): boolean {
    return (
      (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === name)
    );
  }
  function membershipFilter(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    return origins(node, (value) => {
      if (
        ts.isPropertyAssignment(value) &&
        /^members(?:\.|$)/.test(value.name.getText().replace(/^['"]|['"]$/g, ''))
      )
        return true;
      let found = false;
      value.forEachChild((child) => {
        if (membershipFilter(child, seen)) found = true;
      });
      return found;
    });
  }
  function groupModel(node: ts.Node): boolean {
    return origins(
      node,
      (value) =>
        value.getSourceFile().fileName.endsWith('/lib/models/Group.ts') ||
        (ts.isCallExpression(value) &&
          property(value.expression, 'collection') &&
          !!value.arguments[0] &&
          ts.isStringLiteralLike(value.arguments[0]) &&
          value.arguments[0].text === 'groups'),
    );
  }
  function named(node: ts.Node, name: string, file: string): boolean {
    return origins(
      node,
      (value) =>
        (ts.isFunctionDeclaration(value) || ts.isMethodDeclaration(value)) &&
        value.name?.getText() === name &&
        value.getSourceFile().fileName.endsWith(file),
    );
  }
  const admitted = new Set<ts.Symbol>();
  for (const node of nodes) {
    if (
      !ts.isCallExpression(node) ||
      !node.arguments[0] ||
      !named(node.expression, 'readGroupLedger', '/lib/group-ledger-read.ts')
    )
      continue;
    origins(node.arguments[0], (value) => {
      if (ts.isObjectLiteralExpression(value))
        for (const property of value.properties)
          if (ts.isPropertyAssignment(property) && property.name.getText() === 'read')
            origins(property.initializer, (callback) => {
              if (
                ts.isArrowFunction(callback) ||
                ts.isFunctionExpression(callback) ||
                ts.isFunctionDeclaration(callback)
              ) {
                for (const parameter of callback.parameters.slice(0, 2)) {
                  const found = symbol(parameter.name);
                  if (found) admitted.add(found);
                }
                return true;
              }
              return false;
            });
      return false;
    });
  }
  const findings: ReadFinding[] = [];
  const used = new Set<number>();
  function report(node: ts.Node, operation: string) {
    const source = node.getSourceFile(),
      path = source.fileName.slice(1);
    if (!path.startsWith('apps/web/src/') || path === modulePath) return;
    const site = sourceTokens(node.getText()),
      within = owner(node);
    const index = allowed.findIndex(
      (entry, index) =>
        !used.has(index) &&
        entry.path === path &&
        entry.operation === operation &&
        entry.within === within &&
        sourceTokens(entry.site) === site,
    );
    if (index >= 0) used.add(index);
    else
      findings.push({
        path,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        operation,
        within,
        site,
        message:
          'Group ledger reads belong in group-ledger-read.ts. Admit the actor and materialize through readGroupLedger or readGroupLedgers.',
      });
  }
  for (const node of nodes) {
    if (!ts.isCallExpression(node)) continue;
    if (
      ['getGroupInsights', 'getTripSummary'].some((name) =>
        named(
          node.expression,
          name,
          name === 'getGroupInsights'
            ? '/services/group-insights.service.ts'
            : '/services/trip-summary.service.ts',
        ),
      ) &&
      (!node.arguments[0] ||
        !origins(
          node.arguments[0],
          (value) =>
            ts.isParameter(value) && !!symbol(value.name) && admitted.has(symbol(value.name)!),
        ))
    )
      report(node, 'unadmitted-service');
    else if (
      origins(
        node.expression,
        (value) =>
          (ts.isMethodDeclaration(value) ||
            ts.isFunctionDeclaration(value) ||
            ts.isPropertyAssignment(value)) &&
          value.getSourceFile().fileName.endsWith('/services/recurring-expense.service.ts') &&
          [
            'generateDueExpenses',
            'generateDueExpensesForGroups',
            'materializeDueExpenses',
          ].includes(value.name?.getText() ?? ''),
      )
    )
      report(node, 'recurring');
    else if (
      origins(
        node.expression,
        (value) =>
          (ts.isMethodDeclaration(value) ||
            ts.isFunctionDeclaration(value) ||
            ts.isVariableDeclaration(value)) &&
          [
            'isMember',
            'isGroupAdmin',
            'isAdmin',
            'assertAdmin',
            'memberGroup',
            'accessibleGroup',
            'requireWritableGroup',
            'requireMembership',
            'requireLedgerMembership',
            'assistantGroupFilter',
          ].includes(value.name?.getText() ?? ''),
      )
    )
      report(node, 'membership');
    else if (
      (ts.isPropertyAccessExpression(node.expression) ||
        ts.isElementAccessExpression(node.expression)) &&
      (([
        'find',
        'findOne',
        'exists',
        'findOneAndUpdate',
        'countDocuments',
        'updateOne',
        'updateMany',
        'deleteOne',
        'deleteMany',
      ].some((name) => property(node.expression, name)) &&
        groupModel(node.expression.expression) &&
        !!node.arguments[0] &&
        membershipFilter(node.arguments[0])) ||
        (['some', 'find', 'filter', 'every'].some((name) => property(node.expression, name)) &&
          origins(node.expression.expression, (value) => property(value, 'members'))))
    )
      report(node, 'membership');
  }
  for (const [index, entry] of allowed.entries())
    if (!used.has(index))
      findings.push({
        ...entry,
        line: 1,
        message: `Unused ledger read exception (${entry.reason}). Review or remove this entry.`,
      });
  return findings;
}
