import ts from 'typescript';
import { bindSources, sourceTokens, unwrap, type SourceInput } from './source-program.ts';

export interface RecordingFinding {
  path: string;
  line: number;
  operation: string;
  site: string;
  within: string;
  message: string;
}
export interface AllowedRecordingSite {
  path: string;
  operation: string;
  site: string;
  within: string;
  reason: string;
}
const modulePath = 'apps/web/src/lib/ledger-recording.ts';
const writes = new Set([
  'create',
  'save',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
  'bulkWrite',
]);
export function isRecordingSource(path: string) {
  return (
    /^(apps\/web\/(src|scripts)|packages\/shared\/src)\//.test(path) &&
    /\.[cm]?[jt]sx?$/.test(path) &&
    !/\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
    !/(^|\/)(test-utils|__tests__|__fixtures__|fixtures|__mocks__)(\/|$)/.test(path) &&
    !/-test-suite\.[cm]?[jt]sx?$/.test(path)
  );
}
function owner(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent))
      return parent.name?.getText() ?? '';
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent)
    )
      return parent.parent.name.getText();
  }
  return '';
}
/** A bound source rule, not a text search: aliases keep the identity of models and documents. */
export function checkRecordingSources(
  inputs: readonly SourceInput[],
  allowed: readonly AllowedRecordingSite[] = [],
): RecordingFinding[] {
  const {
    nodes,
    symbol: baseSymbol,
    checker,
  } = bindSources(inputs.filter((file) => isRecordingSource(file.path)));
  function symbol(node: ts.Node): ts.Symbol | undefined {
    const found = baseSymbol(node);
    const shorthand = found?.declarations?.find(ts.isShorthandPropertyAssignment);
    if (!shorthand) return found;
    const value = checker.getShorthandAssignmentValueSymbol(shorthand);
    return value && value.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(value) : value;
  }
  const assignments = new Map<ts.Symbol, ts.Expression[]>();
  const parameters = new Map<ts.Symbol, ts.Expression[]>();
  function callable(
    node: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): ts.SignatureDeclaration | undefined {
    node = unwrap(node);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    const found = symbol(node);
    if (!found || seen.has(found)) return;
    const next = new Set(seen).add(found);
    for (const declaration of found.declarations ?? []) {
      if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
        return declaration;
      for (const value of initializers(declaration)) {
        const fn = callable(value, next);
        if (fn) return fn;
      }
    }
  }
  for (const node of nodes) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const found = symbol(node.left);
      if (found) assignments.set(found, [...(assignments.get(found) ?? []), node.right]);
    }
    if (ts.isCallExpression(node)) {
      const fn = callable(node.expression);
      for (const [index, parameter] of (fn?.parameters ?? []).entries()) {
        const found = symbol(parameter.name),
          argument = node.arguments[index];
        if (found && argument) parameters.set(found, [...(parameters.get(found) ?? []), argument]);
      }
    }
  }
  function initializers(declaration: ts.Declaration): ts.Node[] {
    if (ts.isShorthandPropertyAssignment(declaration))
      return (
        checker
          .getShorthandAssignmentValueSymbol(declaration)
          ?.declarations?.flatMap(initializers) ?? []
      );
    if (
      (ts.isVariableDeclaration(declaration) ||
        ts.isPropertyAssignment(declaration) ||
        ts.isEnumMember(declaration)) &&
      declaration.initializer
    )
      return [declaration.initializer];
    if (
      (ts.isVariableDeclaration(declaration) ||
        ts.isPropertyDeclaration(declaration) ||
        ts.isPropertySignature(declaration)) &&
      declaration.type
    )
      return [declaration.type];
    if (ts.isBindingElement(declaration)) {
      const binding = declaration.parent.parent;
      if (ts.isVariableDeclaration(binding) && binding.initializer) {
        const key = (declaration.propertyName ?? declaration.name)
          .getText()
          .replace(/^['"]|['"]$/g, '');
        const property = checker.getPropertyOfType(
          checker.getTypeAtLocation(binding.initializer),
          key,
        );
        return property?.declarations?.flatMap(initializers) ?? [];
      }
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      ts.isForOfStatement(declaration.parent.parent)
    )
      return [declaration.parent.parent.expression];
    if (ts.isParameter(declaration) && declaration.type) return [declaration.type];
    if (
      ts.isParameter(declaration) &&
      (ts.isArrowFunction(declaration.parent) || ts.isFunctionExpression(declaration.parent))
    ) {
      const call = declaration.parent.parent;
      if (
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression) &&
        ['map', 'forEach', 'filter', 'find'].includes(call.expression.name.text)
      )
        return [call.expression.expression];
    }
    return [];
  }
  function origins(
    node: ts.Node,
    seen: ReadonlySet<ts.Symbol>,
    visit: (node: ts.Node, seen: ReadonlySet<ts.Symbol>) => boolean,
  ): boolean {
    const found = symbol(node);
    if (!found || seen.has(found)) return false;
    const next = new Set(seen).add(found);
    return [
      ...(assignments.get(found) ?? []),
      ...(parameters.get(found) ?? []),
      ...(found.declarations ?? []).flatMap(initializers),
    ].some((n) => visit(n, next));
  }
  function strings(node: ts.Node, seen: ReadonlySet<ts.Symbol> = new Set()): string[] {
    node = unwrap(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isConditionalExpression(node))
      return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((n) => strings(n, seen));
    if (ts.isElementAccessExpression(node)) return strings(node.expression, seen);
    const found = symbol(node);
    if (!found || seen.has(found)) return [];
    const next = new Set(seen).add(found);
    const type = checker.getTypeAtLocation(node);
    const literals = (type.isUnion() ? type.types : [type]).flatMap((t) =>
      t.isStringLiteral() ? [t.value] : [],
    );
    return [
      ...literals,
      ...[
        ...(assignments.get(found) ?? []),
        ...(parameters.get(found) ?? []),
        ...(found.declarations ?? []).flatMap(initializers),
      ].flatMap((n) => strings(n, next)),
    ];
  }
  function ledger(node: ts.Node, seen: ReadonlySet<ts.Symbol> = new Set()): boolean {
    node = unwrap(node);
    if (ts.isConditionalExpression(node))
      return ledger(node.whenTrue, seen) || ledger(node.whenFalse, seen);
    if (ts.isArrayLiteralExpression(node)) return node.elements.some((n) => ledger(n, seen));
    if (
      symbol(node)?.declarations?.some(
        (d) =>
          /\/models\/(Expense|Settlement)\.ts$/.test(d.getSourceFile().fileName) &&
          /^(Expense|Settlement|IExpenseDocument|ISettlementDocument)$/.test(
            (d as ts.NamedDeclaration).name?.getText() ?? '',
          ),
      )
    )
      return true;
    if (ts.isTypeReferenceNode(node))
      return (
        ledger(node.typeName, seen) || (node.typeArguments?.some((n) => ledger(n, seen)) ?? false)
      );
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return ledger(node.expression, seen) || origins(node, seen, ledger);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ['collection', 'model'].includes(node.expression.name.text) &&
        node.arguments?.[0] &&
        strings(node.arguments[0]).some((s) =>
          ['expenses', 'settlements', 'Expense', 'Settlement'].includes(s),
        )
      )
        return true;
      if (ledger(node.expression, seen)) return true;
      const fn = callable(node.expression),
        found = symbol(node.expression);
      if (fn && (!found || !seen.has(found))) {
        const next = new Set(seen);
        if (found) next.add(found);
        let result = false;
        function returned(child: ts.Node) {
          if (
            child !== fn &&
            (ts.isArrowFunction(child) ||
              ts.isFunctionDeclaration(child) ||
              ts.isFunctionExpression(child))
          )
            return;
          if (ts.isReturnStatement(child) && child.expression && ledger(child.expression, next))
            result = true;
          child.forEachChild(returned);
        }
        returned(fn);
        if (result) return true;
      }
    }
    return origins(node, seen, ledger);
  }
  function method(
    node: ts.Node,
    seen: ReadonlySet<ts.Symbol> = new Set(),
  ): { name: string; receiver: ts.Node } | undefined {
    node = unwrap(node);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind'
    )
      return method(node.expression.expression, seen);
    if (ts.isPropertyAccessExpression(node)) {
      if (['call', 'apply'].includes(node.name.text)) return method(node.expression, seen);
      return { name: node.name.text, receiver: node.expression };
    }
    if (ts.isElementAccessExpression(node)) {
      const name = strings(node.argumentExpression)[0];
      if (name) return { name, receiver: node.expression };
    }
    const found = symbol(node);
    if (!found || seen.has(found)) return;
    const next = new Set(seen).add(found);
    for (const value of assignments.get(found) ?? []) {
      const resolved = method(value, next);
      if (resolved) return resolved;
    }
    for (const declaration of found.declarations ?? []) {
      if (ts.isBindingElement(declaration)) {
        const binding = declaration.parent.parent;
        if (ts.isVariableDeclaration(binding) && binding.initializer)
          return {
            name: (declaration.propertyName ?? declaration.name).getText(),
            receiver: binding.initializer,
          };
      }
      for (const value of initializers(declaration)) {
        const resolved = method(value, next);
        if (resolved) return resolved;
      }
    }
  }
  function named(
    node: ts.Node,
    path: string,
    name: string,
    seen: ReadonlySet<ts.Symbol> = new Set(),
  ): boolean {
    node = unwrap(node);
    if (
      symbol(node)?.declarations?.some(
        (d) =>
          d.getSourceFile().fileName.endsWith(path) &&
          (d as ts.NamedDeclaration).name?.getText() === name,
      )
    )
      return true;
    return origins(node, seen, (value, next) => named(value, path, name, next));
  }
  function schema(node: ts.Node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isNewExpression(parent)) continue;
      const target = ts.isPropertyAccessExpression(parent.expression)
        ? parent.expression.name
        : parent.expression;
      const declaration = checker.getSymbolAtLocation(target)?.declarations?.[0];
      if (
        declaration &&
        ts.isImportSpecifier(declaration) &&
        (declaration.propertyName ?? declaration.name).text === 'Schema'
      ) {
        const statement = declaration.parent.parent.parent;
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === 'mongoose'
        )
          return true;
      }
    }
    return false;
  }
  function ledgerFence(node: ts.CallExpression) {
    if (!named(node.expression, '/lib/group-mutation.ts', 'withGroupMutation')) return false;
    const budget = node.arguments[2];
    if (!budget) return false;
    function enabled(value: ts.Node, seen: ReadonlySet<ts.Symbol> = new Set()): boolean {
      value = unwrap(value);
      function truth(flag: ts.Node, seen: ReadonlySet<ts.Symbol> = new Set()): boolean {
        flag = unwrap(flag);
        if (flag.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (ts.isConditionalExpression(flag))
          return truth(flag.whenTrue, seen) || truth(flag.whenFalse, seen);
        return origins(flag, seen, truth);
      }
      if (ts.isConditionalExpression(value))
        return enabled(value.whenTrue, seen) || enabled(value.whenFalse, seen);
      if (ts.isObjectLiteralExpression(value))
        return value.properties.some((p) =>
          ts.isSpreadAssignment(p)
            ? enabled(p.expression, seen)
            : ts.isPropertyAssignment(p) &&
              p.name.getText().replace(/^['"]|['"]$/g, '') === 'ledger' &&
              truth(p.initializer),
        );
      return origins(value, seen, enabled);
    }
    if (!enabled(budget)) return false;
    const callback = node.arguments[1];
    if (!callback) return false;
    function touches(value: ts.Node, seen = new Set<ts.Node>()): boolean {
      if (seen.has(value)) return false;
      seen.add(value);
      if (ledger(value)) return true;
      if (ts.isCallExpression(value)) {
        const target = callable(value.expression);
        if (target && touches(target, seen)) return true;
      }
      let result = false;
      value.forEachChild((child) => {
        if (touches(child, seen)) result = true;
      });
      return result;
    }
    return touches(callable(callback) ?? callback);
  }
  const findings: RecordingFinding[] = [];
  const used = new Set<number>();
  function report(node: ts.Node, operation: string) {
    const source = node.getSourceFile(),
      path = source.fileName.slice(1);
    if (!path.startsWith('apps/web/') || path === modulePath) return;
    const site = sourceTokens(node.getText()),
      within = owner(node);
    const exception = allowed.findIndex(
      (entry, index) =>
        entry.path === path &&
        entry.operation === operation &&
        entry.within === within &&
        sourceTokens(entry.site) === site &&
        !used.has(index),
    );
    if (exception >= 0) {
      used.add(exception);
      return;
    }
    findings.push({
      path,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      operation,
      site,
      within,
      message:
        'Ledger writes belong in ledger-recording.ts. Use recordLedger(description) or changeLedgerExpense(description) instead.',
    });
  }
  for (const node of nodes) {
    if (ts.isNewExpression(node) && ledger(node.expression)) report(node, 'constructor');
    if (!schema(node)) {
      if (
        ts.isPropertyAssignment(node) &&
        node.name
          .getText()
          .replace(/^['"]|['"]$/g, '')
          .split('.')
          .at(-1) === 'notificationContext'
      )
        report(node, 'audience');
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const left = node.left;
        const names = ts.isPropertyAccessExpression(left)
          ? [left.name.text]
          : ts.isElementAccessExpression(left)
            ? strings(left.argumentExpression)
            : [];
        if (names.includes('notificationContext')) report(node, 'audience');
      }
    }
    if (ts.isCallExpression(node)) {
      const target = method(node.expression);
      if (target && writes.has(target.name) && ledger(target.receiver)) report(node, target.name);
      if (
        named(node.expression, '/lib/financial-write.ts', 'makePendingActivity') ||
        named(node.expression, '/lib/ledger-recording.ts', 'makePendingActivity')
      )
        report(node, 'event');
      if (ledgerFence(node)) report(node, 'ledger-fence');
    }
  }
  for (const [index, entry] of allowed.entries())
    if (!used.has(index))
      findings.push({
        path: entry.path,
        line: 1,
        operation: entry.operation,
        site: entry.site,
        within: entry.within,
        message: `Unused ledger recording exception (${entry.reason}). Review or remove this allow-list entry.`,
      });
  return findings;
}
