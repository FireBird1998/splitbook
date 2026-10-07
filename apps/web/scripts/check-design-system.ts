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
  'src/components/dashboard/HomeCard.tsx',
  'src/components/dashboard/HomeHeader.tsx',
  'src/components/dashboard/BalancesCard.tsx',
  'src/components/dashboard/NeedsYouCard.tsx',
  'src/components/dashboard/InvitationRow.tsx',
  'src/components/dashboard/GroupsTableCard.tsx',
  'src/components/dashboard/WhereItWentCard.tsx',
  'src/components/dashboard/SpendingChartCard.tsx',
  'src/components/charts/SegmentedControl.tsx',
  'src/components/balances/BalancesView.tsx',
  'src/components/balances/TabCard.tsx',
  'src/components/balances/PaymentsTable.tsx',
  'src/components/balances/EveryoneCard.tsx',
  'src/components/settlements/RecordPaymentForm.tsx',
  'src/app/(main)/layout.tsx',
  'src/components/layout/AppShell.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/SidebarGroups.tsx',
  'src/components/layout/TopBar.tsx',
  'src/components/layout/AccountMenu.tsx',
  'src/components/layout/BrandLogo.tsx',
  'src/components/groups/GroupDetailView.tsx',
  'src/components/groups/GroupPageHeader.tsx',
  'src/components/groups/GroupTabs.tsx',
  'src/components/groups/GroupMembersView.tsx',
  'src/components/groups/GroupExpensesTab.tsx',
  'src/components/insights/GroupInsightsTab.tsx',
  'src/components/insights/GroupInsightsView.tsx',
  'src/components/insights/MonthlySpendingCard.tsx',
  'src/components/insights/ByTagCard.tsx',
  'src/components/insights/WhoPaidCard.tsx',
  'src/components/insights/RecurringExpensesCard.tsx',
  'src/components/expenses/AddExpenseLauncher.tsx',
  'src/components/expenses/GroupChooserDialog.tsx',
  'src/components/search/SearchLauncher.tsx',
  'src/components/search/SearchDialog.tsx',
  'src/components/search/SearchPanel.tsx',
  'src/components/groups/MonthCycleBar.tsx',
  'src/components/expenses/ExpenseListView.tsx',
  'src/components/expenses/ExpenseToolbar.tsx',
  'src/components/expenses/ExpenseTable.tsx',
  'src/components/expenses/ExpenseCard.tsx',
  'src/components/expenses/ExpenseDetails.tsx',
  'src/components/expenses/ExpensePanel.tsx',
  'src/components/expenses/ExpenseStats.tsx',
  'src/components/expenses/expense-row-parts.tsx',
  'src/components/expenses/QuickAddExpense.tsx',
  'src/components/export/ExportView.tsx',
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
