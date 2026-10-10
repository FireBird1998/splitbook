import { afterEach } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import {
  expenseTransitions,
  settlementTransitions,
  creationTransitions,
  leaveTransitions,
} from '../data/flow-transitions';

const tables = {
  expense: expenseTransitions,
  settlement: settlementTransitions,
  creation: creationTransitions,
  leave: leaveTransitions,
};
const monitored = new Set<ReturnType<typeof monitorFlows>>();

/** Observe only public snapshots, wrapping the commands that authorize writes. Violations
 * remain recorded even if a subscriber exception would be caught by a request handler. */
export function monitorFlows(controller: MobileController) {
  let previous = controller.getSnapshot();
  let saves = 0,
    leaves = 0;
  const violations: string[] = [];
  for (const command of [
    'saveExpense',
    'deleteExpense',
    'recordSettlement',
    'createGroup',
    'leaveGroup',
  ] as const) {
    const original = controller[command];
    controller[command] = async () => {
      if (command === 'leaveGroup') leaves++;
      else saves++;
      try {
        return await original();
      } finally {
        if (command === 'leaveGroup') leaves--;
        else saves--;
      }
    };
  }
  const stop = controller.subscribe(() => {
    const next = controller.getSnapshot();
    for (const flow of ['expense', 'settlement', 'creation', 'leave'] as const) {
      const from = previous[flow].status,
        to = next[flow].status;
      if (from === to) continue;
      const table: Readonly<Record<string, readonly string[]>> = tables[flow];
      if (!table[from]?.includes(to)) violations.push(`${flow}: undeclared ${from} → ${to}`);
      if (to === 'saving' && !saves)
        violations.push(`${flow}: saving without an explicit save command`);
      if (to === 'leaving' && !leaves) violations.push('leave: leaving without leaveGroup');
    }
    previous = next;
  });
  return {
    stop,
    assertValid() {
      if (violations.length) throw new Error([...new Set(violations)].join('\n'));
    },
  };
}

export function createCheckedMobileController(...args: Parameters<typeof createMobileController>) {
  const controller = createMobileController(...args);
  monitored.add(monitorFlows(controller));
  return controller;
}

afterEach(() => {
  const checks = [...monitored];
  monitored.clear();
  for (const check of checks) check.stop();
  for (const check of checks) check.assertValid();
});
