import { describe, expect, it } from 'vitest';
import { leaveRecurringProblem, removalRecurringProblem } from './departure-refusals';

/*
 * #257: the words for a recurring Expense in its problem state that still includes the member,
 * by name, whether they leave or an admin removes them. Fictional Household costs only.
 */

const rent = { id: 'e00000000000000000000001', description: 'Rent' };
const wifi = { id: 'e00000000000000000000002', description: 'Wi-Fi' };
const water = { id: 'e00000000000000000000003', description: 'Water' };

async function answer(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe('a recurring Expense that still includes the member who leaves', () => {
  it.each([
    [
      [rent],
      false,
      'Rent (recurring) still includes you. Ask an admin to remove you from it, then leave.',
    ],
    [
      [rent, wifi],
      false,
      'Rent (recurring) and Wi-Fi (recurring) still include you. Ask an admin to remove you from them, then leave.',
    ],
    [[rent], true, 'Rent (recurring) still includes you. Remove yourself from it, then leave.'],
    [
      [rent, wifi, water],
      true,
      'Rent (recurring), Wi-Fi (recurring) and Water (recurring) still include you. Remove yourself from them, then leave.',
    ],
  ])('names %j, for an admin: %s', async (recurringExpenses, admin, error) => {
    expect(await answer(leaveRecurringProblem(recurringExpenses, admin))).toEqual({
      status: 409,
      body: { error, status: 409, code: 'RECURRING_EXPENSE_PROBLEM', recurringExpenses },
    });
  });
});

describe('a recurring Expense that still includes the member an admin removes', () => {
  it.each([
    [
      [rent],
      'Rent (recurring) still includes Priya Shah. Remove them from it before removing them from the Group.',
    ],
    [
      [rent, wifi],
      'Rent (recurring) and Wi-Fi (recurring) still include Priya Shah. Remove them from each before removing them from the Group.',
    ],
  ])('names %j', async (recurringExpenses, error) => {
    expect(await answer(removalRecurringProblem('Priya Shah', recurringExpenses))).toEqual({
      status: 409,
      body: { error, status: 409, code: 'RECURRING_EXPENSE_PROBLEM', recurringExpenses },
    });
  });
});
