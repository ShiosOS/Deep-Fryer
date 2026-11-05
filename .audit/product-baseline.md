# Baseline assessment

Revision `98d79878ef3c2aa73d8e8edce51f308ac6abf421` is the refreshed origin/main and published v0.4.0 commit.

The coordinator ran `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` in the root checkout. Type checking and build passed. All 34 unit tests passed. Electron reported 25 passed and three skipped. The skips were native clipboard copy, native clipboard paste, and staged installer upgrade. No personal clipboard write was performed.

The coordinator captured and inspected `.artifacts/baseline/editor-dark.png`. The capture also produced light-theme, point, and Help images in the same directory. Native file selection was intercepted. Rendering, image decoding, and editor controls ran in the built Electron app with disposable profile data.

Three independent read-only baseline reviewers used the fixed rubric. The target score was excluded from all briefs. Scores below are their reported assessments. Interface judgments were provisional because those reviewers used source and committed Help images, before the fresh captures were available.

| Reviewer model | Usefulness | Interface | Reliability | GitHub | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| gpt-6-astra | 7.5 | 7 | 5.5 | 4 | 6 |
| gpt-6.1-terra | 7 | 6 | 5 | 4 | 5.5 |
| gpt-6.1-sol | 7 | 6.5 | 5.5 | 5 | 6 |

All identified unsaved-work protection and repository onboarding as priorities. The editor specialist also identified unconstrained export aspect ratio and small inspector text. The GitHub specialist found packaging run 41563407942 attempt 1 failed at implicit electron-builder publishing and did not reach installed-offline or upgrade acceptance. The coordinator independently queried that run and confirmed its conclusion and skipped dependent jobs.

These evidence classes remain distinct. Local built Electron success does not certify the published installer. Source findings establish a mechanism to reproduce, not a completed repair. No published-release or installed-offline acceptance has been claimed for this run.

## Design decision

Two independent safety sketches considered explicit unsaved-work decisions and persistent session recovery. Both concluded that recovery rotation alone does not protect an old edit after document replacement. Choose an explicit Save project, Discard, or Cancel guard with content-derived saved state. Preserve recovery when close approval cannot be completed. Keep the existing bounded crash-recovery policy rather than add an indefinite archive.

Separate implementation worktrees own unsaved-work safety, proportional export dimensions, repository onboarding, and throwaway UI exploration. The coordinator alone integrates commits into the product branch.
