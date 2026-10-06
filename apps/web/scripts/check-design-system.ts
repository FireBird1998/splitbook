import { readFileSync } from 'node:fs';
import { checkStyles } from '../src/lib/theme/style-policy';

// Explicit adoption list. Extend it with each migration; do not silently exempt
// new violations. Dynamic styles still require theme and browser verification.
const adoptedFiles = [
  'src/lib/theme/createAppTheme.ts',
  'src/components/common/MoneyText.tsx',
  'src/components/common/StatusLabel.tsx',
  'src/components/common/ErrorState.tsx',
  'src/components/common/EmptyState.tsx',
  'src/components/design-system/DesignSystemLab.tsx',
  'src/components/dashboard/DashboardView.tsx',
  'src/components/dashboard/LatestChangesCard.tsx',
  'src/components/balances/BalancesView.tsx',
  'src/app/(main)/layout.tsx',
  'src/components/layout/AppShell.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/SidebarGroups.tsx',
  'src/components/layout/TopBar.tsx',
  'src/components/layout/AccountMenu.tsx',
  'src/components/layout/BrandLogo.tsx',
];

let failed = false;
for (const file of adoptedFiles) {
  const findings = checkStyles(readFileSync(file, 'utf8'));
  for (const finding of findings) {
    console.error(`${file}:${finding.line}: ${finding.message}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Design-system style policy passed (${adoptedFiles.length} adopted files).`);
