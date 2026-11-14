import { expect, it } from 'vitest';
import { widgetRecentGroup } from './widget-recent-request';

const first = '/api/groups/trip/expenses?page=1&limit=20&includeMemberBreakdown=1';
it('enriches the unfiltered All time first page', () => {
  expect(widgetRecentGroup(first, '2026-11', null)).toBe('trip');
});
it.each([
  first.replace('page=1', 'page=2'),
  first.replace('page=1', 'page=6'),
  `${first}&search=lunch`,
  `${first}&category=food`,
  `${first}&tagId=tag`,
  `${first}&paidByUser=sam`,
  `${first}&currency=JPY`,
  `${first}&sortBy=amount`,
  `${first}&dateFrom=2026-10-01&dateTo=2026-10-31`,
  `${first}&dateFrom=2026-11-01`,
])('does not enrich a paginated, searched or filtered read: %s', (path) => {
  expect(widgetRecentGroup(path, '2026-11', 'trip')).toBeNull();
});
it('enriches only the current Month first page for a Group using the Month lens', () => {
  const current = `${first}&dateFrom=2026-11-01&dateTo=2026-11-30`;
  expect(widgetRecentGroup(current, '2026-11', 'trip')).toBe('trip');
  expect(widgetRecentGroup(current, '2026-11', null)).toBeNull();
  expect(widgetRecentGroup(`${current}&search=lunch`, '2026-11', 'trip')).toBeNull();
});
