import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Typecheck is the main DOM guard for @splitbook/shared (ADR 0002): tsconfig.json
// has no DOM lib and no ambient types, so a DOM name reached through globalThis
// still fails here even though it gets past the lint rule. Each sample is checked
// on its own against the compiler options in packages/shared/tsconfig.json, where
// Vitest runs from. The samples stay in strings so lint never reads them as code.
function typecheck(source: string): string[] {
  const configPath = ts.findConfigFile(ts.sys.getCurrentDirectory(), ts.sys.fileExists);
  expect(configPath).toMatch(/packages[\\/]shared[\\/]tsconfig\.json$/);
  const configFile = ts.readConfigFile(configPath!, ts.sys.readFile);
  const packageDir = configPath!.slice(0, -'/tsconfig.json'.length);
  const { options, errors } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
  expect(errors).toEqual([]);

  const sampleFile = `${packageDir}/src/dom-types-sample.ts`;
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === sampleFile
      ? ts.createSourceFile(fileName, source, languageVersion)
      : readSourceFile.call(host, fileName, languageVersion, ...rest);

  const program = ts.createProgram([sampleFile], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
}

describe('packages/shared/tsconfig.json has no DOM types', () => {
  it('typechecks plain ES2022 code, so the harness itself is sound', () => {
    expect(typecheck(`export const last: number = [1, 2, 3].at(-1) ?? 0;\n`)).toEqual([]);
  });

  it('rejects window', () => {
    expect(typecheck(`export const width = window.innerWidth;\n`)).toEqual([
      "TS2304: Cannot find name 'window'.",
    ]);
  });

  it('rejects URLSearchParams', () => {
    expect(typecheck(`export const query = new URLSearchParams('page=2');\n`)).toEqual([
      "TS2304: Cannot find name 'URLSearchParams'.",
    ]);
  });

  it('rejects a DOM name reached through globalThis', () => {
    expect(typecheck(`export const store = globalThis.localStorage;\n`)).toEqual([
      "TS7017: Element implicitly has an 'any' type because type 'typeof globalThis' has no index signature.",
    ]);
  });
});
