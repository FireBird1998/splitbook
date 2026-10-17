import { defineConfig } from 'vitest/config';

// Tests run in UTC, the zone CI uses, unless TZ names another zone (#227).
const requestedTimeZone = process.env.TZ || null;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: requestedTimeZone ?? 'UTC' },
    provide: { requestedTimeZone },
    // The money modules' branches, measured by `pnpm test` (and `test:unit`) with --coverage
    // (#471); a drop below the threshold fails the run. Left uncovered, as no test can reach them
    // under V8: the leftover ranking comparator's "a.id > b.id" arm (V8's sort reads only a
    // negative result), and splitEntryProblem's fallback for an error that isn't a
    // MoneyValidationError (parseDecimalUnits throws only those).
    coverage: {
      provider: 'v8',
      include: [
        'src/exact-money.ts',
        'src/split-calculation.ts',
        'src/debt-simplifier.ts',
        'src/expense-split.ts',
        'src/settlement-preview.ts',
        'src/dashboard.ts',
      ],
      reporter: ['text-summary'],
      thresholds: { branches: 98 },
    },
  },
});
