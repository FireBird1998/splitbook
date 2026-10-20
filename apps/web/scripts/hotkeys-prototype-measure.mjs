// Throwaway #715: reproduce owned source counts without installing another measurement tool.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = '45485342f4e2b70f9497b13e14573bf3bfd6c0e2';
const files = [
  'apps/web/src/lib/shortcuts/shortcuts.ts',
  'apps/web/src/lib/shortcuts/ShortcutsProvider.tsx',
  'apps/web/src/lib/shortcuts/shortcut-setting.ts',
  'apps/web/src/components/expenses/expense-table-keys.ts',
];
function count(source) {
  const lines = source.trimEnd().split('\n');
  const owned = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('//'));
  return { physical: lines.length, nonblankNoncomment: owned.length };
}
const rows = files.map((file) => {
  const before = count(
    execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }),
  );
  const after = count(readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'));
  return {
    file,
    beforePhysical: before.physical,
    afterPhysical: after.physical,
    beforeOwned: before.nonblankNoncomment,
    afterOwned: after.nonblankNoncomment,
  };
});
console.table(rows);
console.log(
  'Totals',
  rows.reduce(
    (totals, row) => ({
      beforePhysical: totals.beforePhysical + row.beforePhysical,
      afterPhysical: totals.afterPhysical + row.afterPhysical,
      beforeOwned: totals.beforeOwned + row.beforeOwned,
      afterOwned: totals.afterOwned + row.afterOwned,
    }),
    { beforePhysical: 0, afterPhysical: 0, beforeOwned: 0, afterOwned: 0 },
  ),
);
