/**
 * `pnpm mobile ceilings:compare --base <commit>`: the ceilings ratchet (#206). Everything it
 * does is in `./ceilings.ts`, where its tests can reach it.
 */
import { runCeilingsCompare } from './ceilings';

void runCeilingsCompare(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  fetch,
  print: (line) => console.log(line),
}).then((code) => {
  process.exitCode = code;
});
