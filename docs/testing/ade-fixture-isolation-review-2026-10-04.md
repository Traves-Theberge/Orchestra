# Fixture account isolation review

PR #173 was merged at the user's explicit direction before its review repairs.
This follow-up accepts review comment 4179771475.

Inspected T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`,
`apps/server/src/terminal/Manager.ts` and adjacent tests: normal user terminals
inherit the user's environment, with provider-instance environment resolution
and fail-closed errors. Inspected Orca
`3284b4c70c901402831bb4ccc5576ea083d2e5ae`,
`src/main/daemon/terminal-host-session-create.ts`: the execution owner forwards
explicit environment and removal instructions to subprocess creation.
Neither inspected boundary claims that changing HOME isolates inherited secrets.
Neither reference app was run; no reference source was copied.

Orchestra deliberately uses an operating-system environment allowlist for owned
fixtures, unlike a normal signed-in terminal. GitHub config and Git global config
are fixture-owned; system Git configuration and interactive credential prompts
are disabled. Managed desktop sidecars retain these explicit isolation settings.
The optional current-provider audit mode remains an explicitly selected mode.

`node --test apps/desktop/scripts/fixture-environment.test.mjs` passes with a
real Node child: injected GitHub, Unsandbox, arbitrary future credentials and
Git/Node overrides do not reach the child; account paths belong to the fixture.
Syntax checks pass for both launchers. This does not establish native backend
or provider E2E reliability; Smart App Control still blocks unsigned backend
execution on this machine. Selecting a real repository can still select its
local repository configuration and is outside the synthetic fixture guarantee.
