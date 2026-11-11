import { fileURLToPath, URL } from 'node:url';
import { checkReadSources } from '../src/read-contract.ts';
import { readExceptions } from '../src/read-exceptions.ts';
import { readRecordingSources } from '../src/recording-workspace.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const findings = checkReadSources(readRecordingSources(root), readExceptions);
for (const finding of findings)
  console.error(`${finding.path}:${finding.line} ${finding.within}: ${finding.message}`);
if (findings.length) process.exitCode = 1;
else console.log(`Group ledger read contract passed (${readExceptions.length} reviewed sites).`);
