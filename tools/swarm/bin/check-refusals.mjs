import { fileURLToPath, URL } from 'node:url';
import { checkRefusalSources } from '../src/refusal-contract.ts';
import { refusalExceptions } from '../src/refusal-exceptions.ts';
import { readRefusalSources } from '../src/refusal-workspace.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const findings = checkRefusalSources(readRefusalSources(root), refusalExceptions);
for (const finding of findings) {
  console.error(`${finding.path}:${finding.line} ${finding.message}`);
}
if (findings.length) process.exitCode = 1;
else console.log(`Refusal contract passed (${refusalExceptions.length} reviewed retained sites).`);
