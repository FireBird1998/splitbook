import ts from 'typescript';

export interface SourceInput {
  path: string;
  source: string;
}
/** Bind supplied files only, with the workspace aliases; never read installed code or credentials. */
export function bindSources(inputs: readonly SourceInput[]) {
  const sources = new Map(
    inputs.map((file) => {
      const name = '/' + file.path.replaceAll('\\', '/');
      return [name, ts.createSourceFile(name, file.source, ts.ScriptTarget.Latest, true)] as const;
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
  const checker = ts.createProgram([...sources.keys()], options, host).getTypeChecker();
  const nodes: ts.Node[] = [];
  function walk(node: ts.Node) {
    nodes.push(node);
    node.forEachChild(walk);
  }
  for (const source of sources.values()) walk(source);
  function symbol(node: ts.Node): ts.Symbol | undefined {
    const found = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    );
    return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  }
  return { sources, checker, nodes, symbol, options, host };
}
export function unwrap(node: ts.Node): ts.Node {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return unwrap(node.expression);
  return node;
}
export function sourceTokens(text: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let result = '';
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    result += scanner.getTokenText();
  return result;
}
