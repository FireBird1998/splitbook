import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isProductionRefusalSource, type RefusalSource } from './refusal-contract.ts';

export function readRefusalSources(root: string): RefusalSource[] {
  const sources: RefusalSource[] = [];
  function collect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) collect(absolute);
      else {
        const path = relative(root, absolute).replaceAll('\\', '/');
        if (isProductionRefusalSource(path))
          sources.push({ path, source: readFileSync(absolute, 'utf8') });
      }
    }
  }
  collect(join(root, 'apps/web/src'));
  collect(join(root, 'packages/shared/src'));
  return sources;
}
