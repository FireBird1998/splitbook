import ts from 'typescript';

export interface RefusalSource {
  path: string;
  source: string;
}
export interface AllowedRefusalSite {
  path: string;
  code: string;
  when: string;
  within?: string;
  reason: string;
}
export interface RefusalFinding {
  path: string;
  line: number;
  code?: string;
  message: string;
}
const codePattern = /^[A-Z][A-Z0-9_]+$/;
export function isProductionRefusalSource(path: string): boolean {
  return (
    /^(apps\/web\/src|packages\/shared\/src)\//.test(path) &&
    /\.[cm]?[jt]sx?$/.test(path) &&
    !/\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
    !/(^|\/)(test-utils|__tests__|__fixtures__|fixtures|__mocks__)(\/|$)/.test(path)
  );
}
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
function tokens(text: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let result = '';
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    result += scanner.getTokenText();
  }
  return result;
}
function guard(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent)) return tokens(parent.expression.getText());
  }
  return '';
}
function expression(node: ts.Node): ts.Node {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return expression(node.expression);
  }
  return node;
}
type Callable =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;
function isCallable(node: ts.Node): node is Callable {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function owner(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isCallable(parent) && parent.name) return parent.name.getText();
  }
  return '';
}

/** Bind only the supplied production files. External libraries are outside this source rule. */
export function checkRefusalSources(
  inputs: readonly RefusalSource[],
  allowed: readonly AllowedRefusalSite[] = [],
): RefusalFinding[] {
  const sources = new Map(
    inputs
      .filter((file) => isProductionRefusalSource(file.path))
      .map((file) => {
        const name = '/' + file.path.replaceAll('\\', '/');
        return [
          name,
          ts.createSourceFile(name, file.source, ts.ScriptTarget.Latest, true),
        ] as const;
      }),
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: '/',
    paths: { '@/*': ['apps/web/src/*'], '@splitbook/shared/*': ['packages/shared/src/*'] },
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => '/';
  host.getSourceFile = (path) => sources.get(path);
  host.fileExists = (path) => sources.has(path);
  host.readFile = (path) => sources.get(path)?.text;
  host.directoryExists = (path) =>
    [...sources.keys()].some((name) => name.startsWith(path.replace(/\/$/, '') + '/'));
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const nodes: ts.Node[] = [];
  for (const source of sources.values()) walk(source, (node) => nodes.push(node));
  function symbol(node: ts.Node): ts.Symbol | undefined {
    const found = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    );
    return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  }
  function callable(node: ts.Node, seen = new Set<ts.Symbol>()): Callable | undefined {
    node = expression(node);
    if (isCallable(node)) return node;
    const found = symbol(node);
    if (!found || seen.has(found)) return;
    seen.add(found);
    for (const declaration of found.declarations ?? []) {
      if (isCallable(declaration)) return declaration;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        return callable(declaration.initializer, seen);
    }
  }
  const parameterInputs = new Map<ts.Symbol, ts.Expression[]>();
  const assignments = new Map<ts.Symbol, ts.Expression[]>();
  const caught = new Set<ts.Symbol>();
  const messages = new Set<ts.Symbol>();
  function addRoot(name: ts.Node | undefined, roots: Set<ts.Symbol>) {
    const found = name && symbol(name);
    if (!found || roots.has(found)) return false;
    roots.add(found);
    return true;
  }
  function catchBinding(name: ts.BindingName) {
    if (ts.isIdentifier(name)) addRoot(name, caught);
    else
      for (const item of name.elements) {
        if (ts.isBindingElement(item) && (item.propertyName ?? item.name).getText() === 'message')
          addRoot(item.name, messages);
      }
  }
  // Resolve the value behind a declaration, including a destructured object property.
  function initializers(declaration: ts.Declaration): ts.Expression[] {
    if (
      (ts.isVariableDeclaration(declaration) ||
        ts.isEnumMember(declaration) ||
        ts.isPropertyAssignment(declaration)) &&
      declaration.initializer
    )
      return [declaration.initializer];
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
        return (property?.declarations ?? []).flatMap(initializers);
      }
    }
    return [];
  }
  for (const node of nodes) {
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      catchBinding(node.variableDeclaration.name);
    }
    if (isCallable(node))
      for (const parameter of node.parameters) {
        if (parameter.type && /(?:Error|Refusal)(?:<.*>)?$/.test(parameter.type.getText()))
          addRoot(parameter.name, caught);
      }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = symbol(node.left);
      if (name) assignments.set(name, [...(assignments.get(name) ?? []), node.right]);
    }
    if (!ts.isCallExpression(node)) continue;
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
      const callback = node.arguments[0] && callable(node.arguments[0]);
      if (callback?.parameters[0]) catchBinding(callback.parameters[0].name);
    }
    const target = callable(node.expression);
    if (!target) continue;
    for (const [index, parameter] of target.parameters.entries()) {
      const name = symbol(parameter.name);
      const argument = node.arguments[index];
      if (name && argument)
        parameterInputs.set(name, [...(parameterInputs.get(name) ?? []), argument]);
    }
  }
  function values(node: ts.Node, seen = new Set<ts.Symbol>()): string[] {
    node = expression(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isConditionalExpression(node))
      return [...values(node.whenTrue, seen), ...values(node.whenFalse, seen)];
    if (ts.isArrayLiteralExpression(node))
      return node.elements.flatMap((item) => values(item, seen));
    if (ts.isObjectLiteralExpression(node))
      return node.properties.flatMap((item) =>
        item.name ? [item.name.getText().replace(/^['"]|['"]$/g, '')] : [],
      );
    if (ts.isNewExpression(node) && node.arguments?.[0]) return values(node.arguments[0], seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return values(node.left, seen).flatMap((left) =>
        values(node.right, seen).map((right) => left + right),
      );
    }
    const found = symbol(node);
    if (!found || seen.has(found)) return [];
    const next = new Set(seen).add(found);
    const inputs = [...(parameterInputs.get(found) ?? []), ...(assignments.get(found) ?? [])];
    for (const declaration of found.declarations ?? []) {
      inputs.push(...initializers(declaration));
      if (ts.isParameter(declaration)) {
        const fn = declaration.parent;
        const call = fn.parent;
        if (
          ts.isCallExpression(call) &&
          ts.isPropertyAccessExpression(call.expression) &&
          ['some', 'every', 'find', 'filter', 'map', 'forEach'].includes(call.expression.name.text)
        )
          inputs.push(call.expression.expression);
      }
    }
    const type = checker.getTypeAtLocation(node);
    const literals = (type.isUnion() ? type.types : [type]).flatMap((item) =>
      item.isStringLiteral() ? [item.value] : [],
    );
    return [...literals, ...inputs.flatMap((input) => values(input, next))];
  }
  function nativeError(node: ts.Node, seen = new Set<ts.Symbol>()): boolean {
    node = expression(node);
    if (ts.isIdentifier(node) && node.text === 'Error' && !symbol(node)) return true;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'Error' &&
      ts.isIdentifier(node.expression) &&
      ['globalThis', 'global', 'window'].includes(node.expression.text) &&
      !symbol(node.expression)
    )
      return true;
    const found = symbol(node);
    if (!found || seen.has(found)) return false;
    const next = new Set(seen).add(found);
    return (
      [...(assignments.get(found) ?? []), ...(parameterInputs.get(found) ?? [])].some((input) =>
        nativeError(input, next),
      ) ||
      (found.declarations ?? []).flatMap(initializers).some((input) => nativeError(input, next))
    );
  }
  function origin(node: ts.Node, kind: 'error' | 'message', seen = new Set<ts.Symbol>()): boolean {
    node = expression(node);
    if (ts.isConditionalExpression(node))
      return origin(node.whenTrue, kind, seen) || origin(node.whenFalse, kind, seen);
    if (
      kind === 'message' &&
      ((ts.isPropertyAccessExpression(node) && node.name.text === 'message') ||
        (ts.isElementAccessExpression(node) &&
          node.argumentExpression &&
          values(node.argumentExpression).includes('message')))
    ) {
      return origin(node.expression, 'error', seen);
    }
    const found = symbol(node);
    if (!found || seen.has(found)) return false;
    if ((kind === 'error' ? caught : messages).has(found)) return true;
    const next = new Set(seen).add(found);
    const inputs = [...(assignments.get(found) ?? [])];
    for (const declaration of found.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        inputs.push(declaration.initializer);
      if (
        kind === 'message' &&
        ts.isBindingElement(declaration) &&
        (declaration.propertyName ?? declaration.name).getText() === 'message'
      ) {
        const binding = declaration.parent.parent;
        if (
          ts.isVariableDeclaration(binding) &&
          binding.initializer &&
          origin(binding.initializer, 'error', next)
        )
          return true;
      }
    }
    return inputs.some((input) => origin(input, kind, next));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [parameter, inputs] of parameterInputs) {
      if (!caught.has(parameter) && inputs.some((input) => origin(input, 'error'))) {
        caught.add(parameter);
        changed = true;
      }
      if (!messages.has(parameter) && inputs.some((input) => origin(input, 'message'))) {
        messages.add(parameter);
        changed = true;
      }
    }
  }
  // Follow HTTP adapters into their helpers, stopping at domain, model and protocol modules.
  const helpers = new Set(
    [...sources.keys()].filter((path) => path.startsWith('/apps/web/src/app/api/')),
  );
  const queue = [...helpers];
  for (const path of queue)
    for (const statement of sources.get(path)?.statements ?? []) {
      if (
        (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, path, options, host)
        .resolvedModule?.resolvedFileName;
      if (
        !resolved ||
        !sources.has(resolved) ||
        /\/lib\/(services|models|mcp)\//.test(resolved) ||
        helpers.has(resolved)
      )
        continue;
      helpers.add(resolved);
      queue.push(resolved);
    }
  const findings: RefusalFinding[] = [];
  const used = new Set<AllowedRefusalSite>();
  function report(node: ts.Node, message: string, code?: string) {
    const source = node.getSourceFile();
    findings.push({
      path: source.fileName.slice(1),
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      ...(code ? { code } : {}),
      message,
    });
  }
  for (const node of nodes) {
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      nativeError(node.expression) &&
      node.arguments?.[0]
    ) {
      for (const code of new Set(
        values(node.arguments[0]).filter((value) => codePattern.test(value)),
      )) {
        const exception = allowed.find(
          (site) =>
            site.path === node.getSourceFile().fileName.slice(1) &&
            site.code === code &&
            (site.within ?? '') === owner(node) &&
            tokens(site.when) === guard(node),
        );
        if (exception && !used.has(exception)) used.add(exception);
        else
          report(
            node,
            `Plain Error message ${code}. Use new Refusal(code) with any required data instead.`,
            code,
          );
      }
    }
    if (!helpers.has(node.getSourceFile().fileName)) continue;
    let compared: ts.Node[] = [];
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.InKeyword,
      ].includes(node.operatorToken.kind)
    ) {
      if (origin(node.left, 'message')) compared.push(node.right);
      if (origin(node.right, 'message')) compared.push(node.left);
    }
    if (ts.isSwitchStatement(node) && origin(node.expression, 'message'))
      compared = node.caseBlock.clauses.flatMap((clause) =>
        ts.isCaseClause(clause) ? [clause.expression] : [],
      );
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      origin(node.argumentExpression, 'message')
    )
      compared.push(node.expression);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (
        ['includes', 'has', 'hasOwnProperty'].includes(node.expression.name.text) &&
        node.arguments[0] &&
        origin(node.arguments[0], 'message')
      )
        compared.push(node.expression.expression);
      if (
        node.expression.name.text === 'hasOwn' &&
        node.arguments[0] &&
        node.arguments[1] &&
        origin(node.arguments[1], 'message')
      )
        compared.push(node.arguments[0]);
    }
    const codes = [
      ...new Set(
        compared.flatMap((part) => values(part)).filter((value) => codePattern.test(value)),
      ),
    ];
    if (codes.length)
      report(
        node,
        `Caught error.message dispatch (${codes.join(', ')}). Use serverError(cause), or Refusal.code for a family policy.`,
        codes.join(', '),
      );
  }
  for (const site of allowed)
    if (!used.has(site))
      findings.push({
        path: site.path,
        line: 1,
        code: site.code,
        message: `Unused refusal exception (${site.reason}). Review or remove this allow-list entry.`,
      });
  return findings;
}
