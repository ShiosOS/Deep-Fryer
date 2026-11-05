# Issue 25 evidence

- Issue: https://github.com/ShiosOS/Deep-Fryer/issues/25
- Worktree: `C:/Users/emofo/.t3/worktrees/Deep-Fryer/t3-e6061add`
- Base: `28426cc76067768f7ca67dc3963ca81afe729f6a`.
- Regression commit: `187af6beacb929493cc6d9d60b5f1c7722aad995`.
- Host: Windows, Node `v26.8.1`. Dependencies use an ignored junction to the parent checkout's `E:/Dev/Deep-Fryer/node_modules`.

`node --import tsx --test tests/image-files.test.ts` failed before the fix with 5 passed and 3 failed. Both write/sync tests reached `Missing expected rejection`, expecting `ENOENT` when reading the failed destination. Their fault callbacks had already asserted actual destination bytes. The cleanup-error test received the original sync error without the required cleanup report. A second run with `--test-name-pattern='a failed export'` reproduced both retained destinations, 0 passed and 2 failed.

The tests obtain the native FileHandle prototype from a probe file. `node:test` replaces `writeFile` or `sync`, performs a real 16-byte write, verifies the destination bytes, and throws a known error. Mocks restore before test-directory cleanup. The removal-error test moves the created output and replaces its path with a nonempty directory. Native nonrecursive removal then fails with `EISDIR`; the directory's other data and moved output remain intact.

The fix follows `writeDocumentExclusive`'s ownership boundary: a successful `wx` open precedes cleanup, and the handle closes before nonrecursive removal. Successful cleanup rethrows the exact original error. Failed close/removal throws an AggregateError containing both errors and the original cause, with an explicit incomplete-file warning. Normal saves and existing-path errors retain their behavior. No production dependency injection was added.

After the fix:

- `node --import tsx --test tests/image-files.test.ts`: 8 passed, 0 failed.
- `npm test`: 39 passed, 0 failed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

The regressions also verify unchanged source, source-hardlink, and pre-existing destination bytes, plus a successful save to the same filename after cleanup. This is controlled fault injection through the real Windows filesystem, not evidence of physical disk failure, power-loss recovery, or packaged Electron acceptance. No children, push, PR, or unsaved-work changes.

Type System Discipline uses the existing FileHandle type without casts. Model the Domain keeps ownership in the existing exclusive-write function. Laziness Protocol keeps the production change local and uses the native test seam. Sequence Work into Verifiable Units preserves the failing tests before the fix in commit history. Deslop review found no added abstraction, debug logging, or explanatory code comments.
