import mongoose from 'mongoose';
import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
// Registers the model `populate('members.user')` needs. A fresh server instance loads only the
// modules of the route it serves, so search must not rely on another route (#186).
import '@/lib/models/User';
import { readStoredAmountMinor } from '@splitbook/shared/exact-money';
import {
  SEARCH_LIMITS,
  matchesSearch,
  normalizeSearchQuery,
  searchRank,
  searchTerms,
  wordStartPattern,
} from '@splitbook/shared/search';
import type {
  SearchExpenseResult,
  SearchGroupResult,
  SearchPersonResult,
  SearchRead,
} from '@splitbook/shared/search-read';

/** A slow search gives up rather than hold the dialog. */
const EXPENSE_SEARCH_MAX_TIME_MS = 5_000;

interface MemberGroup {
  _id: mongoose.Types.ObjectId;
  name: string;
  category: string;
  members: { user: { _id: mongoose.Types.ObjectId; name?: string } | null }[];
}

/** The first `limit` items, best rank first and otherwise in the order given, and whether more matched. */
function capped<T>(items: T[], rank: (item: T) => number, limit: number) {
  const ordered = items
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
  return { results: ordered.slice(0, limit), more: ordered.length > limit };
}

function amountMinorOf(record: Parameters<typeof readStoredAmountMinor>[0]): number | null {
  try {
    return readStoredAmountMinor(record);
  } catch {
    return null;
  }
}

export const emptySearch = (query = ''): SearchRead => ({
  query,
  groups: [],
  people: [],
  expenses: [],
  more: { groups: false, people: false, expenses: false },
});

export class SearchService {
  /**
   * Search the member's own Groups (#321): Group names, the names of the people in them and
   * the descriptions of their Expenses. Only Groups the member belongs to now are read, the
   * same Groups as their Group list (archived ones are left out), so a Group they left or
   * never joined is never searched. People are read by name alone; no email is ever loaded.
   * Deleted Expenses are left out.
   *
   * Each word of the query must start a word of the name or description (see
   * `@splitbook/shared/search`). Expenses are matched in the database, newest first, within
   * the member's Groups only; the Group and people sections are matched here, from the Group
   * list already loaded.
   */
  async search(userId: string, rawQuery: string): Promise<SearchRead> {
    const query = normalizeSearchQuery(rawQuery);
    const terms = searchTerms(query);
    if (terms.length === 0) return emptySearch();

    await connectDB();
    const groups = (await Group.find({ 'members.user': userId, isArchived: false })
      .select('name category members.user')
      .populate('members.user', 'name')
      .sort({ updatedAt: -1 })
      .lean()) as unknown as MemberGroup[];
    if (groups.length === 0) return emptySearch(query);

    const groupNames = new Map(groups.map((group) => [String(group._id), group.name]));

    const groupMatches = capped(
      groups
        .filter((group) => matchesSearch(group.name, terms))
        .map(
          (group): SearchGroupResult => ({
            id: String(group._id),
            name: group.name,
            category: group.category,
            memberCount: group.members.length,
          }),
        ),
      (group) => searchRank(group.name, query),
      SEARCH_LIMITS.groups,
    );

    // Each person once, with the first Group the member shares with them in Group-list order.
    const people = new Map<string, SearchPersonResult>();
    for (const group of groups) {
      for (const { user } of group.members) {
        // A member whose account is gone has no name to match.
        if (!user || typeof user.name !== 'string') continue;
        const id = String(user._id);
        if (id === userId) continue;
        const known = people.get(id);
        if (known) known.groupCount += 1;
        else if (matchesSearch(user.name, terms))
          people.set(id, {
            id,
            name: user.name,
            groupId: String(group._id),
            groupName: group.name,
            groupCount: 1,
          });
      }
    }
    const peopleMatches = capped(
      [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
      (person) => searchRank(person.name, query),
      SEARCH_LIMITS.people,
    );

    const expenses = await Expense.find({
      group: { $in: groups.map((group) => group._id) },
      isDeleted: false,
      $and: terms.map((term) => ({
        description: { $regex: wordStartPattern(term), $options: 'i' },
      })),
    })
      .select('group description amount amountMinor moneyVersion currency date')
      .sort({ date: -1, createdAt: -1 })
      .limit(SEARCH_LIMITS.expenses + 1)
      .maxTimeMS(EXPENSE_SEARCH_MAX_TIME_MS)
      .lean();
    const expenseResults = expenses.slice(0, SEARCH_LIMITS.expenses).map(
      (expense): SearchExpenseResult => ({
        id: String(expense._id),
        groupId: String(expense.group),
        groupName: groupNames.get(String(expense.group)) ?? '',
        description: expense.description,
        amountMinor: amountMinorOf(expense),
        currency: expense.currency,
        date: new Date(expense.date).toISOString(),
      }),
    );

    return {
      query,
      groups: groupMatches.results,
      people: peopleMatches.results,
      expenses: expenseResults,
      more: {
        groups: groupMatches.more,
        people: peopleMatches.more,
        expenses: expenses.length > SEARCH_LIMITS.expenses,
      },
    };
  }
}

export const searchService = new SearchService();
