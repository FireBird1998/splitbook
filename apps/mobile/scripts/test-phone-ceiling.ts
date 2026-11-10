import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const testPhoneCeilingFile = 'src/test-utils/test-phone.ceilings.json';
const wiring = new Set([
  'src/runtime.test.ts',
  'src/runtime-notifications.test.ts',
  'src/runtime-http-store-failure.test.ts',
]);
const constructors = new Set(['createMobileController', 'createCheckedMobileController']);

/** Count executable construction, including imported aliases; comments and types do not count. */
export function controllerTestFiles(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([path, source]) => {
      if (!/\.test\.tsx?$/.test(path) || wiring.has(path)) return false;
      const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const names = new Set<string>();
      for (const node of tree.statements) {
        if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const entry of bindings.elements)
            if (!entry.isTypeOnly && constructors.has(entry.propertyName?.text ?? entry.name.text))
              names.add(entry.name.text);
      }
      let built = false;
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ((ts.isIdentifier(node.expression) && names.has(node.expression.text)) ||
            (ts.isPropertyAccessExpression(node.expression) &&
              constructors.has(node.expression.name.text)))
        )
          built = true;
        ts.forEachChild(node, visit);
      };
      visit(tree);
      return built;
    })
    .map(([path]) => path)
    .sort();
}

export function assertControllerTestCeiling(
  files: string[],
  limit: number,
  base: number | undefined,
) {
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error('Invalid directControllerTestFiles ceiling');
  if (base !== undefined && limit > base)
    throw new Error(`directControllerTestFiles ceiling rose: ${base} → ${limit}`);
  if (files.length > limit)
    throw new Error(
      `directControllerTestFiles: ${files.length} exceeds ${limit}:\n${files.join('\n')}`,
    );
}

/** Runs beside the render/request ratchet, so the same gate and PR check enforce this limit. */
export function checkTestPhoneCeiling(cwd: string, base: string) {
  const files: Record<string, string> = {};
  const walk = (path: string) => {
    for (const entry of readdirSync(join(cwd, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.test\.tsx?$/.test(child)) files[child] = readFileSync(join(cwd, child), 'utf8');
    }
  };
  walk('src');
  walk('scripts');
  const limit = JSON.parse(readFileSync(join(cwd, testPhoneCeilingFile), 'utf8'))
    .directControllerTestFiles as number;
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const before = git('ls-tree', '--name-only', base, '--', `./${testPhoneCeilingFile}`)
    ? (JSON.parse(git('show', `${base}:./${testPhoneCeilingFile}`))
        .directControllerTestFiles as number)
    : undefined;
  const constructing = controllerTestFiles(files);
  assertControllerTestCeiling(constructing, limit, before);
  return `directControllerTestFiles: ${constructing.length} ≤ ${limit}`;
}
