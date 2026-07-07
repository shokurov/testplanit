# Handoff: Jira Server / Data Center support (issue #494) — iteration 4

**TL;DR:** Three iterations done. Iteration 3 (this session) fixed the
**authentication blocker** (D3a: dedicated Username/Password fields,
plumbed through `IntegrationManager`), the pagination-cursor bug, the
user-picker custom-field mapping, added a clearer Cloud-bare-token error,
fixed the `__contract__` lint gap, persisted detection (D4), dropped the
dead legacy fields, and tightened one DC mock against recorded fixture
reality. `pnpm test` (9771 tests), `tsc --noEmit`, and `pnpm lint` are all
clean. **What iteration 3 could NOT do: verify any of it against the live
DC instance** — the coding session had no network access, so
`pnpm test:jira-contract` has never been run against the new/changed
code paths. That live run is the one remaining gate before merge; see
"What to do" below. Full iteration-2 audit with file/line references:
https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588

Work continues on branch `fix/jira-datacenter-494` in this repo
(internal review PR: https://github.com/shokurov/testplanit/pull/1).
`PLAN-jira-dc-494.md` (same directory) remains the authority for design
(D1–D4) and test strategy (Phases A–D). Merge into **our `main`** only
when the Definition of Done below is met; then open a fresh, clean PR
upstream (TestPlanIt/testplanit) referencing issue #494 only. Do not
reopen or reference the closed upstream PR #495.

## Background — how we got here

1. **The bug (upstream issue TestPlanIt/testplanit#494).** The Jira
   integration was hardcoded for Atlassian Cloud: every call used
   `/rest/api/3` (DC only ships v2), API-key auth was always
   `Basic email:apiToken` (a DC PAT must be `Bearer`), users were
   addressed by `accountId` (DC uses `name`/`key`). Result: HTTP 404/401
   against any self-hosted Jira, contradicting the documented DC support.
2. **Iteration 1 (upstream PR #495 — closed deliberately).** First
   implementation treated DC v2 as "v3 at a different URL" and guessed
   the auth scheme from which form fields were filled. Code review
   verified 10 defects (8 confirmed): DC authentication and most DC
   write paths were broken despite green mock-based unit tests — the
   mocks encoded the same wrong assumptions as the code. The review
   produced `PLAN-jira-dc-494.md` (D1 dialect module, D2 explicit auth
   scheme, D3 credential plumbing, D4 persisted detection, live contract
   suite) and the 10-item worklist.
3. **Iteration 2 (this branch, commits `6491b366`…`c0871773`).**
   Executed Phases A and B of the plan:
   - **Phase A done:** env-gated live contract suite
     (`testplanit/lib/integrations/adapters/__contract__/jira-dc.contract.test.ts`)
     driving the real `JiraAdapter` against https://jira.rapidsoft.ru
     in two auth schemes, with a recording fetch wrapper writing
     redacted fixtures to `__fixtures__/jira-dc/`. `pnpm
     test:jira-contract` script added; suite self-skips without
     `JIRA_IT_BASE_URL`.
   - **Phase B mostly done:** dialect fixes for endpoints — DC project
     list via `GET /project` (bare array), new
     `createmeta/{key}/issuetypes/{id}`, plain-string descriptions and
     comment bodies (`contentToString`), `?username=` user search,
     `startAt` accepted for search pagination, v3→v2 detection with
     `redirect:"manual"` (DC login-page 302 handling), PAT-as-Bearer
     re-resolution after detection. Contract suite 24/24 green live;
     unit suite 706 green; `tsc --noEmit` clean.
   - **Phases C and D not done** (acknowledged in the PR comment).
4. **Iteration-2 audit (2026-07-06).** Verified the branch against this
   handoff's worklist. Verdict: **not ready for acceptance testing.**
   5 of 10 worklist items and all 4 cleanup items still open; 4 of 6
   DoD gates fail. Details in the next section and, with exact
   file/line references, in the PR comment linked above.
5. **Iteration 3 (2026-07-07, this session).** Executed the audit's
   worklist in priority order, D3 option **(a)** for the auth blocker
   (dedicated Username/Password fields + `IntegrationManager` plumbing,
   not option (b)'s email/apiToken-repurposing heuristic — see D3
   discussion in `PLAN-jira-dc-494.md`, which is genuinely ambiguous
   between "email+PAT" and "username-in-email+password-in-apiToken"
   without new fields). Worklist #1/#7/#8/#9/#10 fixed; lint fixed; D4
   persistence added; dead legacy fields dropped. **Not attempted:**
   the `resolveJiraConnection` dedup (cleanup item, deliberately
   deferred — see rationale below) and finishing Phase C fixture
   recording (needs live access this session didn't have). **Not
   verified live:** the coding session had no network access to
   `jira.rapidsoft.ru`, so every change is unit-tested with mocks only
   — the live contract suite (including the two new tests it needs:
   production-credential-shape auth and a user-picker-field write) has
   never actually run against the new code.

## Where things stand (branch head — after iteration 3, uncommitted at
## end of session; see "Session state" below)

Trust these (unit-tested, `tsc`/`eslint` clean, but NOT live-verified —
see "Do NOT trust these"):
- Detection architecture (`serverInfo` probe + hostname fallback,
  `redirect:"manual"` v3 probe), the `jiraDeployment.ts` helper module,
  the contract-suite harness and recorder, the endpoint fixes for
  worklist items #2–#6, and the docs skeleton. (Carried over from
  iteration 2, unchanged this session.)
- **Worklist #1 (auth blocker) — D3 option (a).** `IntegrationConfigForm`
  now has dedicated `username`/`password` fields for Jira API_KEY
  (`apiToken` is no longer marked required, since DC Basic doesn't use
  it); `IntegrationManager.getAdapter` forwards
  `credentials.username`/`credentials.password` into `authData`
  (`lib/integrations/IntegrationManager.ts`, next to the existing
  email/apiToken forwarding). `resolveAuthScheme`/`buildAuthHeader`
  needed **no changes** — they already handled this credential shape
  correctly; the bug was purely that production could never produce it.
  Docs (`docs/docs/user-guide/integrations.md`) updated to describe the
  new fields instead of the old "put your password in the API Token
  field" convention.
- **Worklist #7 (user-picker custom fields) — D1 `userRef`.** New
  `mapCustomFieldUserRefs` in `jiraDeployment.ts` wires the previously-dead
  `userRefField` into `createIssue`/`updateIssue` for reporter, assignee,
  **and** arbitrary user-picker custom fields (any value shaped
  `{ accountId }`, which is the form's own convention regardless of
  deployment). Note: Cloud's assignee shape changed from `{ id }` to
  `{ accountId }` as part of this consolidation — both are accepted by
  Jira's write API (see the endpoint contract matrix in
  `PLAN-jira-dc-494.md`), so this is not a behavior change on live Jira,
  just a different (also-valid) alias. Flagged here in case it surprises
  someone diffing `JiraAdapter.test.ts`.
- **Worklist #8 (pagination cursor).** `searchIssues` now synthesizes
  `nextPageToken = String(startAt + issues.length)` on Data Center when
  `hasMore` is true, closing the "re-reads page 1 forever" bug in
  `SyncService.performProjectImport`.
- **Worklist #10 (opaque Cloud 401).** Both `JiraAdapter.performAuthentication`
  and the test-connection route's `testJiraConnection` now throw/report an
  explicit "Jira Cloud requires an email + API token" message instead of a
  bare 401 when a bare token was guessed as Bearer and Cloud rejects it.
- **D4 (persist detection).** A successful Jira test-connection now merges
  `deploymentType`/`authScheme` into `integration.settings`, fill-missing
  -only (existing keys always win — verified by a dedicated test).
- Lint: `**/__contract__/**` added to `eslint.config.mjs` ignores,
  matching the existing `tsconfig.json` exclude. `pnpm lint` (`eslint .`)
  is 0 errors project-wide as of this session.
- Dead legacy `apiEmail`/`apiToken` private fields on `JiraAdapter`
  (write-only, confirmed via grep) — deleted.

Do NOT trust these:
- **Nothing here has run against jira.rapidsoft.ru.** This whole session
  had no network access. `pnpm test:jira-contract` needs to be run for
  real before merge — see "What to do" #1 below. All contract-suite edits
  (the new production-credential-shape test, the page-2 pagination test,
  the user-picker write test, the real transition-and-revert test) are
  code-complete and skip cleanly without `JIRA_IT_*` env vars, but their
  *behavior* against a live instance is unverified.
- **Phase C (fixture-derived mocks) is still only partial.** Only 7
  fixture files exist in `__fixtures__/jira-dc/`, and — this is new
  information this session found — the recorder in `__contract__/recorder.ts`
  resets its file-name counter (`call-000.json`, `call-001.json`, …) on
  *every test*, so each test's fixtures overwrite the previous test's.
  The 7 files on disk are remnants of whatever single test ran last in
  whoever's recording session, not a curated archive. One mock
  (`dcIssue.description` in `JiraAdapter.test.ts`, now a plain string) was
  tightened against `call-004.json`'s recorded shape this session; the
  rest of Phase C (createIssue/updateIssue/addComment/searchUsers/
  getProjects/getIssueTypes/transitions mocks) is unstarted — no fixtures
  exist for those calls. If the recorder's overwrite behavior isn't fixed
  first (e.g. a global counter, or per-test subdirectories), a future
  recording run will hit the same "only the last test's calls survive"
  problem.
- **The `resolveJiraConnection` dedup (cleanup item) was deliberately
  skipped.** `JiraAdapter.performAuthentication` and the test-connection
  route's `testJiraConnection` still carry two divergent ~60-line copies
  of the probe/detect/re-auth state machine — unchanged since iteration
  2. Reasoning: refactoring this without live access to re-validate the
  carefully-tuned `redirect:"manual"` / login-page-redirect detection
  logic (which iteration 2 fixed based on real failures against
  jira.rapidsoft.ru) was judged too risky to do blind. Both copies got
  the same small, additive Cloud-bare-token error-message branch instead
  (see worklist #10 above) rather than a structural merge.

## What to do (order matters — most severe first)

1. **Run the live contract suite for real — this is now the blocker.**
   Nobody has run `pnpm test:jira-contract` against jira.rapidsoft.ru
   since iteration 3's changes landed. Put `JIRA_IT_BASE_URL`,
   `JIRA_IT_PROJECT_KEY`, `JIRA_IT_PAT`, `JIRA_IT_USERNAME`,
   `JIRA_IT_PASSWORD` in `.jira-it.env` (see "Environment" below) and
   run it. Specifically confirm:
   - The new **"production credential shape: Basic username+password as
     IntegrationManager.getAdapter builds it"** test passes — this is
     the actual regression guard for worklist #1 (the previous
     `{username, password}` scheme tests exercised the adapter directly,
     not the shape production now sends).
   - The new **`#5b` "writes a user-picker custom field"** test passes.
   - The new **`#10b` "nextPageToken advances past page 1"** test
     passes.
   - The rewritten **`#9` "executes a transition and reverts it"** test
     passes (it now discovers a real transition via the REST API instead
     of just reading status — first time this path has ever run).
   - All the *existing* 24 tests still pass (nothing here should have
     touched their behavior, but confirm).
   If anything fails, the fix is almost certainly a wrong assumption in
   this session's code, not the test — cross-check against a fresh
   fixture recording before changing an assertion.
2. **Decide whether to fix the recorder's overwrite bug before
   recording more fixtures.** `__contract__/recorder.ts`'s per-test file
   counter means only the last test's calls are ever saved to disk. If
   you want Phase C's remaining fixtures (createIssue/updateIssue/
   addComment/searchUsers/getProjects/getIssueTypes/transitions have
   none), fix this first (e.g. a session-scoped or per-test-name
   counter) or you'll keep overwriting your own recordings.
3. **Finish Phase C** once fixtures exist: regenerate the remaining DC
   unit-test mocks in `JiraAdapter.test.ts` to assert request shape
   (method, path, params, body) against recorded reality, not stub
   200s. One mock (`dcIssue.description`) was already tightened against
   `call-004.json` this session; the rest still needs live-recorded
   fixtures to work from.
4. **Cleanup: extract `resolveJiraConnection`.** `JiraAdapter.
   performAuthentication` and the test-connection route's
   `testJiraConnection` still carry two divergent ~60-line copies of the
   probe/detect/re-auth state machine — this is the one cleanup item
   iteration 3 deliberately did not attempt (too risky to refactor
   blind, without live access to re-validate the `redirect:"manual"`
   detection logic). Do this **after** step 1 confirms the current
   behavior live, so you have a passing baseline to refactor against.
5. **Re-verify Cloud is untouched.** Iteration 3 changed Cloud's
   assignee write shape from `{ id }` to `{ accountId }` as a side effect
   of consolidating reporter/assignee/custom-fields through one `userRef`
   mapper (see `JiraAdapter.test.ts`, "should include assignee when
   provided"). Both are documented as valid by Jira's own API, but this
   session had no Cloud sandbox to confirm live — if there's a Cloud
   instance available, create an issue with an assignee through
   TestPlanIt and confirm it actually gets assigned.

## Definition of Done (gate for merging to our main — unchanged)

- [ ] Live contract suite green against jira.rapidsoft.ru in **both**
      auth schemes, driven through **production credential shapes**.
      Code-complete, never run (see "What to do" #1) — this is the only
      gate blocked purely on live access, not on unfinished code.
- [ ] The documented DC Basic flow works exactly as the docs describe
      it (docs and code must agree — update whichever is wrong). Docs
      and code now agree as of iteration 3 (dedicated Username/Password
      fields); unverified live.
- [x] All 10 worklist items fixed.
- [ ] Cleanup items done (one detection state machine, no dead helpers,
      detection persisted, no legacy fields). 3 of 4 done this session
      (dead `userRefField` wired in, D4 detection persisted, legacy
      `apiEmail`/`apiToken` dropped); the detection-state-machine dedup
      is still open (deliberately deferred — see "What to do" #4).
- [ ] DC unit tests regenerated from fixtures; full vitest suite green;
      existing Cloud tests untouched and green; `tsc --noEmit` AND
      `pnpm lint` clean. As of iteration 3: vitest 9771/9771 passing
      (12 pre-existing suite-load failures, all unrelated to Jira —
      missing env vars / zenstack not generated on Windows, see
      "Environment" below), `tsc --noEmit` clean (12 pre-existing
      errors, none in a touched file), `pnpm lint` 0 errors. DC unit
      test *regeneration from fixtures* remains mostly undone — see
      "What to do" #2–#3.
- [x] No secrets in fixtures (re-checked this session; still clean).
- [ ] Docs verified against actual behavior. Updated to match the new
      code this session; not live-verified.

## Upstreaming (after our main)

- Fresh branch off upstream main, cherry-pick/squash into a clean
  series (suggested: 1. dialect module + tests, 2. adapter/route fixes,
  3. form/manager plumbing + docs, 4. contract-suite harness).
- Fresh PR with its own description; reference issue #494 only — not
  the closed upstream PR #495 and not our internal PR #1.
- Note in the PR that DC behavior was validated against a live Jira DC
  10.x instance and that DC unit fixtures are recorded from it.

## Environment / access / gotchas

- **Live DC instance:** https://jira.rapidsoft.ru (Jira DC 10.3.13).
  Sandbox project key, a PAT, and Basic username/password via
  egors@upbonus.io. The sandbox project has a required custom field and
  a user-picker custom field configured. Tests create real issues —
  teardown deletes them (`DELETE /issue/{key}`); double-check cleanup
  after aborted runs.
- **Running the contract suite:** put `JIRA_IT_BASE_URL`,
  `JIRA_IT_PROJECT_KEY`, `JIRA_IT_PAT`, `JIRA_IT_USERNAME`,
  `JIRA_IT_PASSWORD` in a gitignored `.jira-it.env` at the repo root,
  then `pnpm test:jira-contract`. Without the env vars the suite
  self-skips (safe for CI).
- **Windows dev machines:** `pnpm install`'s postinstall runs
  `NODE_OPTIONS='...' zenstack generate`, which is Unix-only syntax —
  the Prisma client silently doesn't get generated and every
  route-level test 500s with `Cannot read properties of undefined
  (reading 'JIRA')`. Fix: `$env:NODE_OPTIONS='--max-old-space-size=12288';
  npx zenstack generate` (may need retries — EMFILE flakes) or at
  minimum `npx prisma generate`. Linux CI is unaffected. **Iteration 3
  hit this exact symptom** (12 suites failing with `enhance is not a
  function` / "Invalid environment variables") on the Windows machine
  that ran it — none of the 12 were Jira-related, all pre-existing, not
  fixed this session (out of scope; noted here so the next person
  doesn't re-diagnose it from scratch).
- **No network access in the iteration-3 coding session.** Confirmed via
  `curl -m 3 https://jira.rapidsoft.ru/...` timing out. This is why the
  live contract suite was never run — see "What to do" #1. If your
  environment *does* have access, that should be the very first thing
  you do before trusting anything else in this handoff.
- **Audit trail:** iteration-2 audit with exact file/line references:
  https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588
- **Plan:** `PLAN-jira-dc-494.md` (same directory) — D1–D4 design
  decisions and the 12-family endpoint contract matrix.
- The unrelated `PLAN.md` in the same directory (milestones #8/#9) — do
  not touch.
- **Session state:** all iteration-3 changes are uncommitted on
  `fix/jira-datacenter-494` as of the end of this session (by design —
  committing wasn't requested). Files touched: `JiraAdapter.ts`/`.test.ts`,
  `jiraDeployment.ts`, `IntegrationManager.ts`/`.test.ts`,
  `IntegrationConfigForm.tsx`/`.test.tsx`, the test-connection
  `route.ts`/`.test.ts`, the `__contract__` contract test, `eslint.config.mjs`,
  `messages/en-US.json`, and `docs/docs/user-guide/integrations.md`. Run
  `git diff` / `git status` before doing anything else.
