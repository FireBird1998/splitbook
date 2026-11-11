import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isRecordingSource } from './recording-contract.ts';
import type { SourceInput } from './source-program.ts';

export function readRecordingSources(root: string): SourceInput[] {
  const sources: SourceInput[] = [];
  function collect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) collect(absolute);
      else {
        const path = relative(root, absolute).replaceAll('\\', '/');
        if (isRecordingSource(path)) sources.push({ path, source: readFileSync(absolute, 'utf8') });
      }
    }
  }
  for (const directory of ['apps/web/src', 'apps/web/scripts', 'packages/shared/src'])
    collect(join(root, directory));
  return sources;
}
