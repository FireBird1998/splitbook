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
function owner(node: ts.Node, owners: ReadonlyMap<ts.Node, string>): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const found = owners.get(parent);
    if (found) return found;
  }
  return '<module>';
}

/** Kind, lexical container and a local ordinal give every function its own exception identity. */
function functionOwners(nodes: readonly ts.Node[]) {
  const owners = new Map<ts.Node, string>();
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (
      !(
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      )
    )
      continue;
    let name =
      ts.isArrowFunction(node) || ts.isConstructorDeclaration(node)
        ? undefined
        : node.name?.getText();
    if (
      !name &&
      (ts.isVariableDeclaration(node.parent) ||
        ts.isPropertyAssignment(node.parent) ||
        ts.isPropertyDeclaration(node.parent))
    )
      name = node.parent.name.getText();
    if (ts.isMethodDeclaration(node)) {
      const container = node.parent;
      if ((ts.isClassDeclaration(container) || ts.isClassExpression(container)) && container.name)
        name = `${container.name.text}.${name}`;
      else if (
        ts.isObjectLiteralExpression(container) &&
        ts.isVariableDeclaration(container.parent)
      )
        name = `${container.parent.name.getText()}.${name}`;
    }
    const outer = owner(node, owners);
    const label = `${ts.SyntaxKind[node.kind]} ${name ?? '<callback>'}`;
    const identity = outer === '<module>' ? label : `${outer}/${label}`;
    const key = `${node.getSourceFile().fileName}/${identity}`;
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    owners.set(node, `${identity}#${ordinal}`);
  }
  return owners;
}

/** Keep read admission and materialization together; exceptions describe one reviewed site. */
export function checkReadSources(
  inputs: readonly SourceInput[],
  allowed: readonly AllowedReadSite[] = [],
): ReadFinding[] {
  const { nodes, symbol, checker } = bindSources(
    inputs.filter((file) => isRecordingSource(file.path)),
  );
  const owners = functionOwners(nodes);
  function origins(
    node: ts.Node,
    match: (node: ts.Node) => boolean,
    seen = new Set<ts.Symbol>(),
  ): boolean {
    node = unwrap(node);
    if (match(node)) return true;
    // Binding a method does not invoke it; calling the bound value still has its identity.
    if (
      ts.isCallExpression(node) &&
      property(node.expression, 'bind') &&
      (ts.isPropertyAccessExpression(node.expression) ||
        ts.isElementAccessExpression(node.expression))
    )
      return origins(node.expression.expression, match, seen);
    if (
      (property(node, 'call') || property(node, 'apply')) &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    )
      return origins(node.expression, match, seen);
    const found =
      symbol(node) ??
      (ts.isElementAccessExpression(node) && literal(node.argumentExpression)
        ? checker.getPropertyOfType(
            checker.getTypeAtLocation(node.expression),
            literal(node.argumentExpression)!,
          )
        : undefined);
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
  function literal(node: ts.Node): string | undefined {
    let text: string | undefined;
    origins(node, (value) => {
      if (!ts.isStringLiteralLike(value)) return false;
      text = value.text;
      return true;
    });
    return text;
  }
  function property(node: ts.Node, name: string): boolean {
    return (
      (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
      (ts.isElementAccessExpression(node) && literal(node.argumentExpression) === name) ||
      (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText() === name)
    );
  }
  const mutatedFilters = new Set<ts.Symbol>();
  function membershipPath(node: ts.Node): boolean {
    const key = ts.isComputedPropertyName(node) ? node.expression : node;
    return /^members(?:\.|$)/.test(literal(key) ?? (ts.isIdentifier(key) ? key.text : ''));
  }
  function membershipFilter(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    return origins(node, (value) => {
      const binding = symbol(ts.isVariableDeclaration(value) ? value.name : value);
      if (binding && mutatedFilters.has(binding)) return true;
      if (ts.isPropertyAssignment(value) && membershipPath(value.name)) return true;
      let found = false;
      value.forEachChild((child) => {
        if (membershipFilter(child, seen)) found = true;
      });
      return found;
    });
  }
  function groupModel(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    return origins(node, (value) => {
      if (value.getSourceFile().fileName.endsWith('/lib/models/Group.ts')) return true;
      const target = receiver(value);
      if (target && property(value, 'collection') && groupModel(target, seen)) return true;
      if (!ts.isCallExpression(value)) return false;
      if (
        property(value.expression, 'collection') &&
        value.arguments[0] &&
        literal(value.arguments[0]) === 'groups'
      )
        return true;
      const query = receiver(value.expression);
      return (
        !!query &&
        ['find', 'findOne', 'findById', 'where'].some((name) => property(value.expression, name)) &&
        groupModel(query, seen)
      );
    });
  }
  function receiver(node: ts.Node): ts.Node | undefined {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return node.expression;
    if (ts.isBindingElement(node)) {
      const binding = node.parent.parent;
      if (ts.isVariableDeclaration(binding)) return binding.initializer;
    }
  }
  function memberList(node: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    return origins(node, (value) => {
      if (property(value, 'members')) return true;
      if (
        ts.isNewExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === 'Set' &&
        value.arguments?.[0]
      )
        return memberList(value.arguments[0], seen);
      if (
        ts.isCallExpression(value) &&
        ['map', 'filter'].some((name) => property(value.expression, name))
      ) {
        const target = receiver(value.expression);
        return !!target && memberList(target, seen);
      }
      return false;
    });
  }
  function contains(node: ts.Node, match: (value: ts.Node) => boolean): boolean {
    return match(node) || !!node.forEachChild((child) => contains(child, match));
  }
  function comparesLoopMember(loop: ts.ForOfStatement): boolean {
    const binding = ts.isVariableDeclarationList(loop.initializer)
      ? loop.initializer.declarations[0]?.name
      : loop.initializer;
    if (!binding) return false;
    const bindings = new Set<ts.Symbol>();
    function collectBindings(value: ts.Node) {
      const found = ts.isIdentifier(value) ? symbol(value) : undefined;
      if (found) bindings.add(found);
      value.forEachChild(collectBindings);
    }
    collectBindings(binding);
    return contains(
      loop.statement,
      (value) =>
        ts.isBinaryExpression(value) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(value.operatorToken.kind) &&
        contains(value, (part) => {
          const found = ts.isIdentifier(part) ? symbol(part) : undefined;
          return !!found && bindings.has(found);
        }),
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
  const callbacks = new Set<ts.SignatureDeclaration>();
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
                callbacks.add(callback);
                return true;
              }
              return false;
            });
      return false;
    });
  }
  const assigned = new Set<ts.Symbol>();
  for (const node of nodes)
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (
        (ts.isPropertyAccessExpression(node.left) && membershipPath(node.left.name)) ||
        (ts.isElementAccessExpression(node.left) && membershipPath(node.left.argumentExpression))
      ) {
        origins(node.left.expression, (value) => {
          const found = symbol(ts.isVariableDeclaration(value) ? value.name : value);
          if (found) mutatedFilters.add(found);
          return false;
        });
      }
      let target: ts.Node = node.left;
      while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
        target = target.expression;
      const found = symbol(target);
      if (found) assigned.add(found);
    }
  const admitted = new Set<ts.Symbol>();
  for (const callback of callbacks) {
    // A registered callback is not an admission gate for its other invocations.
    if (
      nodes.some(
        (node) =>
          ts.isCallExpression(node) && origins(node.expression, (value) => value === callback),
      )
    )
      continue;
    for (const parameter of callback.parameters.slice(0, 2)) {
      const found = symbol(parameter.name);
      if (found) admitted.add(found);
    }
  }
  function admittedValue(node: ts.Node): boolean {
    if (
      origins(node, (value) => {
        const found = symbol(
          ts.isVariableDeclaration(value) || ts.isParameter(value) ? value.name : value,
        );
        return !!found && assigned.has(found);
      })
    )
      return false;
    return origins(
      node,
      (value) => ts.isParameter(value) && !!symbol(value.name) && admitted.has(symbol(value.name)!),
    );
  }
  const findings: ReadFinding[] = [];
  const used = new Set<number>();
  function report(node: ts.Node, operation: string) {
    const source = node.getSourceFile(),
      path = source.fileName.slice(1);
    if (!path.startsWith('apps/web/src/') || path === modulePath) return;
    const site = sourceTokens(node.getText()),
      within = owner(node, owners);
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
    if (ts.isForOfStatement(node) && memberList(node.expression) && comparesLoopMember(node)) {
      report(node, 'membership');
      continue;
    }
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
      (!node.arguments[0] || !admittedValue(node.arguments[0]))
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
      (origins(node.expression, (value) => {
        const target = receiver(value);
        return (
          !!target &&
          groupModel(target) &&
          [
            'find',
            'aggregate',
            'where',
            'findOne',
            'exists',
            'findOneAndUpdate',
            'countDocuments',
            'updateOne',
            'updateMany',
            'deleteOne',
            'deleteMany',
          ].some((name) => property(value, name))
        );
      }) &&
        node.arguments[0] &&
        (membershipFilter(node.arguments[0]) ||
          (origins(node.expression, (value) => property(value, 'where')) &&
            membershipPath(node.arguments[0])))) ||
      origins(node.expression, (value) => {
        const target = receiver(value);
        return (
          !!target &&
          ['some', 'find', 'filter', 'every', 'findIndex', 'includes', 'has'].some((name) =>
            property(value, name),
          ) &&
          memberList(target)
        );
      })
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
