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
    // (#471). The few left uncovered can't be reached; a drop below the threshold fails the run.
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
