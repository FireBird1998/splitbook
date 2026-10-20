// Throwaway #715: measure emitted chunks after a production build of either workspace.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

const workspace = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../../../', import.meta.url));
const root = path.join(workspace, 'apps/web/.next');
function sum(files) {
  const unique = new Set(files);
  let raw = 0,
    gzip = 0;
  for (const file of unique) {
    const bytes = readFileSync(path.join(root, decodeURIComponent(file)));
    raw += bytes.length;
    gzip += gzipSync(bytes, { level: 9 }).length;
  }
  return { files: unique.size, raw, gzip };
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)],
  );
}
const build = JSON.parse(readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));
const result = {
  method:
    'Sum individually gzip(level9)-compressed unique emitted JS chunks; route uses client-reference manifest plus rootMainFiles, not measured transfer bytes',
  all: sum(
    walk(path.join(root, 'static/chunks'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => path.relative(root, file)),
  ),
};
for (const route of ['(main)/groups', '(main)/groups/[id]/(tabs)/expenses']) {
  const context = {};
  runInNewContext(
    readFileSync(path.join(root, 'server/app', route, 'page_client-reference-manifest.js'), 'utf8'),
    context,
  );
  const manifest = Object.values(context.__RSC_MANIFEST)[0];
  const files = [
    ...build.rootMainFiles,
    ...Object.values(manifest.clientModules)
      .flatMap((value) => value.chunks)
      .filter((file) => typeof file === 'string' && file.endsWith('.js')),
  ];
  result[route] = sum(files);
}
console.log(JSON.stringify(result, null, 2));
