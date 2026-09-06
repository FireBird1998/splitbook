import ts from 'typescript';
import { createAppTheme } from './createAppTheme';

const palette = createAppTheme('light').palette;
const colorProperties = new Set([
  'color',
  'bgcolor',
  'background',
  'backgroundColor',
  'borderColor',
  'outlineColor',
  'fill',
  'stroke',
  'boxShadow',
  'border',
  'outline',
]);

export interface StyleFinding {
  line: number;
  message: string;
}

function paletteHas(path: string): boolean {
  let value: unknown = palette;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !(key in value)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string';
}

/** Static style literals only; dynamic expressions still need rendered tests. */
export function checkStyles(source: string): StyleFinding[] {
  const file = ts.createSourceFile(
    'ui.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: StyleFinding[] = [];
  function checkLiterals(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      const path = /^\w+\.palette\.([a-z]\w*\.\w+)$/.exec(node.getText(file))?.[1];
      if (path && !paletteHas(path))
        findings.push({
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          message: `Unknown palette token: ${path}`,
        });
    }
    if (ts.isStringLiteralLike(node)) {
      const value = node.text;
      const message = /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(value)
        ? `Use a semantic color instead of: ${value}`
        : /^[a-z]\w*\.\w+$/.test(value) && !paletteHas(value)
          ? `Unknown palette token: ${value}`
          : undefined;
      if (message)
        findings.push({
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          message,
        });
    }
    ts.forEachChild(node, checkLiterals);
  }
  function visit(node: ts.Node, inStyle = false) {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      if (colorProperties.has(name) && node.initializer) checkLiterals(node.initializer);
      inStyle = inStyle || name === 'sx' || name === 'style';
    }
    if (inStyle && ts.isPropertyAssignment(node)) {
      const name = ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText(file);
      if (colorProperties.has(name)) checkLiterals(node.initializer);
    }
    ts.forEachChild(node, (child) => visit(child, inStyle));
  }
  visit(file);
  return findings;
}
