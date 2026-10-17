# PR #248 final verification and merge

The owner approved merging with Android15/API35 and Android16/API36 emulator evidence, with signed staging/real-account/physical-phone release checks remaining in open issue #193. #109 was already closed; a supplemental report was added without claiming release completion.

Final PR head: 7f26f7ff53327590467df4f60313ee707205cfad
Base: b85f5243ea51141e3027d1c29a0ad895f74080cf

Local gate: lint, typecheck, format, ceilings, 4,469 unit tests and all nine HTTP verifiers passed in146.1seconds, maxWorkers2, on an isolated fictional backend/database removed afterwards.

Native before/after and full route/draft/sheet/save matrix: see ../pr248-back-qa/README.md. Application sources are unchanged by the final rebase and test correction. Additional actual API35 left-edge gesture returned Maple House→Home, with original gestural overlay enabled and unchanged; gesture-before/after hierarchy files and screenshot are included here. Shared emulator5554/staging login remained untouched.

CI failure on first rebase: existing #225 test awaited layout, allowing a zero-delay restoration timer to finish before the cancellation input under test. A controlled yield reproduced it. The corrected test delivers layout and cancellation within one act before yielding. No runtime code changes. A mutation removing production drag cancellation fails the corrected test; restored afterwards. Corrected test passes in all three CI timezones. Logs retained here.

Final-head CI: https://github.com/FireBird1998/splitbook/actions/runs/37972442987
GitHub GraphQL closingIssuesReferences: exactly #197.
All branches retained; no direct push to main.

## Final outcome

Final-head CI completed successfully. #248 was squash-merged concurrently by ankit-thesys as db4a6769e32636031ed644ed8cf0172acccf1018. Tree matches tested head exactly; parent is the tested main base b85f524. Local main is db4a676; #197 CLOSED and #193 OPEN. Remote PR branch remains at7f26f7f.

Production deployment dpl_5x5sCXjB8jtvN65eiRwLnhNwp7NS is READY in splitbook, target production; GitHub Vercel status on db4a676 is success. URL: https://vercel.com/ankit-das-projects/splitbook/5x5sCXjB8jtvN65eiRwLnhNwp7NS.

Temporary worktree removed after evidence preservation. All branches retained. No staging/phone release gate marked passed.
