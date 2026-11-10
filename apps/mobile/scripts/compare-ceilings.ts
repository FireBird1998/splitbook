/**
 * `pnpm mobile ceilings:compare --base <commit>`: the ceilings ratchet (#206). Everything it
 * does is in `./ceilings.ts`, where its tests can reach it.
 */
import { runCeilingsCompare } from './ceilings';
import { checkTestPhoneCeiling } from './test-phone-ceiling';

void runCeilingsCompare(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  fetch,
  print: (line) => console.log(line),
}).then((code) => {
  if (code === 0) {
    try {
      const args = process.argv.slice(2);
      const base =
        args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length) ??
        args[args.indexOf('--base') + 1]!;
      console.log(checkTestPhoneCeiling(process.cwd(), base));
    } catch (error) {
      console.error((error as Error).message);
      code = 1;
    }
  }
  process.exitCode = code;
});
