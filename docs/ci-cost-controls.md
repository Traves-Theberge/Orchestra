# CI cost controls

Desktop smoke verifies relevant pull requests and changes merged to main on Linux. A weekly Monday 07:00 UTC Linux run checks dependency drift. The previous daily Linux/Windows matrix consumed runner minutes even without code changes.

For Windows acceptance, manually run **orchestra-desktop-smoke**, select the branch and enable **native**. This adds Windows to the Linux matrix, including the native backend and Electron smoke checks. It does not publish a release. A Linux pass does not prove Windows acceptance; explicitly request native validation before a release or after platform-specific changes.

Jobs time out after 20 minutes, superseded runs cancel, and diagnostic reports expire after three days. Download needed evidence before expiry. Dependency security and binary protection workflows remain enabled.

Run the cost-policy regression from `apps/desktop` after installing its dependencies:

```sh
node --test scripts/ci-budget.test.mjs
```

The contract verifies the schedule and opt-in native matrix, not actual native execution. Review account billing and observed workflow runtime after deployment; savings depend on development volume. Do not compensate for reduced automatic coverage by dispatching native validation after every merge.

The workflow's existing path filters can leave a required check pending on unrelated PRs. If branch protection is introduced, use an always-running lightweight gate or revise those filters before requiring this check.
