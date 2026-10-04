# Final batch verification logs

See [the aggregate handoff](../../ade-launch-review-2026-10-04.md) for implementation, reference receipts and limitations. These logs cover this uncommitted working tree; they are not a release or provider E2E certification.

| Native command/lane | Observed exit/result | Log |
| --- | --- | --- |
| Backend `go test ./...` | Exit 1; agents and presenter blocked by Application Control, all other test packages passed | `baseline-launch-review-final-backend.log` |
| Backend `go vet ./...` | Exit 0; empty output | `baseline-launch-review-final-vet.log` |
| Build staged `dist/orchestra/orchestrad.exe` | Exit 0; empty output | `baseline-launch-review-final-build.log` |
| Desktop typecheck and full Vitest | Exit 0; 489 passed, two existing skips | `baseline-launch-review-desktop.log` |
| Desktop production build | Exit 0 | `baseline-launch-review-build.log` |
| Managed backend Node tests | Exit 0; 16 passed | `baseline-launch-review-helper.log` |
| Isolated native Electron audit | Exit 0; ready, no cleanup warning, owned ports released | `baseline-launch-review-final-audit.log` |

The manual audit on 4011/5173 remained running with its prior backend. No hosted mutation or provider inference was used. Native test policy blocks were not bypassed. Final container results are linked in the aggregate handoff and configuration transport receipt.

Final Docker image `sha256:e2a1d7bcbafb22b43327609c1d174d92e3db981de010d1f7683ae799c8703f2b`: build, full unit/race, focused runner race and ten slow-callback repetitions all exited 0. `docker-backend-all.txt` records both full lanes (API unit 80.560s, race 224.269s). See `docker-outcomes.txt`, `docker-build-final.txt`, `docker-runner-race.txt` and `docker-runner-repeat.txt`. Unchanged package caches are visible in the logs. `docker-pr-focused.txt` is a passing prior-image focused check, explicitly identified in outcomes; the final full lanes also execute those API tests.
