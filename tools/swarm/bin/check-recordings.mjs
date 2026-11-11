import { fileURLToPath, URL } from 'node:url';
import { checkRecordingSources } from '../src/recording-contract.ts';
import { recordingExceptions } from '../src/recording-exceptions.ts';
import { readRecordingSources } from '../src/recording-workspace.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const findings = checkRecordingSources(readRecordingSources(root), recordingExceptions);
for (const finding of findings) console.error(`${finding.path}:${finding.line} ${finding.message}`);
if (findings.length) process.exitCode = 1;
else
  console.log(
    `Ledger recording contract passed (${recordingExceptions.length} reviewed exceptional sites).`,
  );
