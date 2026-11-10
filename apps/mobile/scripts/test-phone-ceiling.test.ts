import { describe, expect, it } from 'vitest';
import { controllerTestFiles, assertControllerTestCeiling } from './test-phone-ceiling';

describe('direct controller construction ceiling', () => {
  const direct =
    "import { createMobileController as build } from './mobile-controller'; build({}, {});";
  it('counts constructor aliases and monitored construction, excluding only runtime wiring tests', () => {
    expect(
      controllerTestFiles({
        'src/data/one.test.ts': direct,
        'src/ui/two.test.tsx':
          "import { createCheckedMobileController as build } from '../test-utils/flow-monitor'; build({}, {});",
        'src/runtime.test.ts': direct,
        'src/runtime-notifications.test.ts': direct,
        'src/runtime-http-store-failure.test.ts': direct,
        'src/data/comment.test.ts': '// createMobileController({}, {})',
        'src/data/type.test.ts':
          "import type { createMobileController } from './mobile-controller'; type C = typeof createMobileController;",
        'src/test-utils/test-phone.ts': direct,
      }),
    ).toEqual(['src/data/one.test.ts', 'src/ui/two.test.tsx']);
  });
  it('refuses extra constructing files or a raised limit, and permits the initial limit or a reduction', () => {
    expect(() => assertControllerTestCeiling(['one', 'two'], 1, 1)).toThrow('2');
    expect(() => assertControllerTestCeiling(['one'], 2, 1)).toThrow('rose');
    expect(() => assertControllerTestCeiling(['one'], 1, undefined)).not.toThrow();
    expect(() => assertControllerTestCeiling(['one'], 1, 2)).not.toThrow();
  });
});
