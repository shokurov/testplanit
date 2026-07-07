# Handoff: Jira Server / Data Center support (issue #494) — iteration 4

**TL;DR:** Three iterations done, **and this time the live contract suite
is actually green**: 29/29 against jira.rapidsoft.ru, in **both** auth
schemes, including the two new production-credential-shape tests. Getting
there found and fixed two more real bugs that no amount of mocking had
ever caught (details below): `loadEnvFile()` silently failed to load any
`.jira-it.env` var on a CRLF-terminated file (so the very first live run
skipped with 0 tests instead of running), and `JiraAdapter.makeRequest`
crashed with `SyntaxError: Unexpected end of JSON input` on Jira's 204
No Content responses — which `updateIssue` always hits, since nothing
before this session had ever driven a real transition end-to-end. Both
are fixed. `pnpm test`, `tsc --noEmit`, and `pnpm lint` are all clean.
The only Definition-of-Done gate still open is the Cloud assignee-shape
re-check (no Cloud sandbox available) and the deliberately-deferred
`resolveJiraConnection` dedup — see "What to do". Full iteration-2 audit
with file/line references:
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
5. **Iteration 3 (2026-07-07, this session, part 1 — no network).**
   Executed the audit's worklist in priority order, D3 option **(a)**
   for the auth blocker (dedicated Username/Password fields +
   `IntegrationManager` plumbing, not option (b)'s
   email/apiToken-repurposing heuristic — see D3 discussion in
   `PLAN-jira-dc-494.md`, which is genuinely ambiguous between
   "email+PAT" and "username-in-email+password-in-apiToken" without new
   fields). Worklist #1/#7/#8/#9/#10 fixed; lint fixed; D4 persistence
   added; dead legacy fields dropped. **Not attempted:** the
   `resolveJiraConnection` dedup (cleanup item, deliberately deferred —
   see rationale below). **Not verified live:** the coding session had
   no network access to `jira.rapidsoft.ru`, so every change was only
   unit-tested with mocks.
6. **Iteration 3, part 2 (2026-07-07, same session, network access
   restored).** Ran the live contract suite for real for the first
   time against all of part 1's changes. Found and fixed two bugs part
   1's mocks couldn't have caught:
   - `loadEnvFile()` in `jira-dc.contract.test.ts` split its `.env` text
     on `"\n"` only. On a CRLF file (the actual `.jira-it.env` on this
     machine), every line keeps a trailing `\r`; JS regex `.` treats
     `\r` as a line terminator, so `(.*)$` without `/m` can never reach
     end-of-string and the whole per-line match silently fails — for
     every line, not just one. No env vars ever got set, `RUN` was
     `false`, and the suite quietly reported "0 tests" instead of an
     error. Fixed by splitting on `/\r?\n/`.
   - Once the suite actually ran, `#9`'s rewritten transition test (the
     first thing in this codebase's history to drive `updateIssue`
     against a live instance) hit `SyntaxError: Unexpected end of JSON
     input` in `JiraAdapter.makeRequest`. Root cause: Jira's
     `PUT /issue/{id}` (and the transition-execute POST) return `204 No
     Content`, and `makeRequest` unconditionally called
     `response.json()` on every ok response. Every existing mock in
     `JiraAdapter.test.ts` supplied a JSON body for these calls, so
     nothing had ever exercised the empty-body case — a live 204 would
     have crashed `updateIssue` in **production**, on Cloud or DC alike,
     even though the underlying Jira transition would have already
     succeeded. Fixed with a `status === 204` short-circuit plus a
     `SyntaxError` fallback in `makeRequest`, kept backward-compatible
     with every existing test mock (verified: full unit suite still
     green).
   Result: **29/29 contract tests green in both auth schemes**,
   including the two new production-credential-shape / user-picker-write
   tests from part 1. Full unit suite, `tsc --noEmit`, and `eslint` all
   re-verified clean after these two fixes.

## Where things stand (after iteration 3, parts 1 and 2 — see "Session
## state" for what's committed)

Trust these — unit-tested, `tsc`/`eslint` clean, AND live-verified
against jira.rapidsoft.ru (both auth schemes) unless noted otherwise:
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
- **The live contract suite is now actually green: 29/29, both auth
  schemes, against jira.rapidsoft.ru** — including the new
  production-credential-shape auth test, `#5b` (user-picker field
  write), `#9` (real transition + revert), and `#10b` (page-2
  pagination). Confirmed by running it twice in a row. Getting here
  required two more fixes, both live-discovered (see part 2 above):
  `loadEnvFile()`'s CRLF-splitting bug, and `makeRequest`'s crash on
  Jira's 204 No Content responses (a real, previously-latent production
  bug in `updateIssue`/transitions, not DC-specific — see below).

Do NOT trust these:
- **Phase C (fixture-derived mocks) is still only partial.** The recorder
  in `__contract__/recorder.ts` resets its file-name counter
  (`call-000.json`, `call-001.json`, …) on *every test*, so each test's
  fixtures overwrite the previous test's — running the suite this
  session left 18 files on disk (`call-000` through `call-017`), all
  from whichever test happened to run last (the second scheme's `#9`),
  not a curated archive. Usefully, that happens to now include real
  recordings of `PUT /issue/{id}` and `POST .../transitions` both
  returning **204 No Content** (`call-009`, `call-013`, `call-015`) —
  direct live evidence for the `makeRequest` bug described above — plus
  `GET .../transitions` (call-012/014) and a plain `GET .../search`
  (call-007/008). Still no recordings of `createIssue`'s or
  `addComment`'s request bodies, `searchUsers`, `getProjects`, or
  `getIssueTypes`. `dcIssue.description` in `JiraAdapter.test.ts` was
  tightened against a recorded shape this session (now a plain string,
  not ADF); the rest of Phase C's mock regeneration is unstarted. If the
  recorder's overwrite behavior isn't fixed (e.g. a global counter, or
  per-test subdirectories), a future recording run will keep landing on
  "only the last test's calls survive."
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

1. **Decide whether to fix the recorder's overwrite bug before
   recording more fixtures.** `__contract__/recorder.ts`'s per-test file
   counter means only the last test's calls are ever saved to disk. If
   you want Phase C's remaining fixtures (createIssue/updateIssue/
   addComment/searchUsers/getProjects/getIssueTypes/transitions have
   none), fix this first (e.g. a session-scoped or per-test-name
   counter) or you'll keep overwriting your own recordings.
2. **Finish Phase C** once fixtures exist: regenerate the remaining DC
   unit-test mocks in `JiraAdapter.test.ts` to assert request shape
   (method, path, params, body) against recorded reality, not stub
   200s. Two mocks were already tightened against real recordings this
   session (`dcIssue.description`, and — more importantly —
   `makeRequest`'s 204-handling, found by the live suite rather than a
   fixture); the rest of Phase C still needs live-recorded fixtures to
   work from.
3. **Cleanup: extract `resolveJiraConnection`.** `JiraAdapter.
   performAuthentication` and the test-connection route's
   `testJiraConnection` still carry two divergent ~60-line copies of the
   probe/detect/re-auth state machine — the one cleanup item not done
   yet. The live contract suite is now green, so you have a real
   passing baseline to refactor against (re-run it after the extraction
   to confirm detection still works — both auth schemes, and ideally
   also force `deploymentType: "server"`/`"cloud"` overrides once by
   hand since the suite doesn't currently exercise those).
4. **Re-verify Cloud is untouched.** Iteration 3 changed Cloud's
   assignee write shape from `{ id }` to `{ accountId }` as a side effect
   of consolidating reporter/assignee/custom-fields through one `userRef`
   mapper (see `JiraAdapter.test.ts`, "should include assignee when
   provided"). Both are documented as valid by Jira's own API, and the
   live *Data Center* suite exercises the equivalent `userRef` path, but
   there's no Cloud sandbox to confirm the Cloud-specific shape live —
   if one becomes available, create an issue with an assignee through
   TestPlanIt and confirm it actually gets assigned.
5. **Consider auditing other `makeRequest` call sites for the same
   204 assumption class of bug.** The fix in `makeRequest` is general
   (any empty-body ok response), so it covers everything routed through
   it. But it was found by accident (the first live `updateIssue` call
   in this codebase's history) rather than by systematic review — worth
   a deliberate pass over the endpoint contract matrix in
   `PLAN-jira-dc-494.md` asking "does this Jira endpoint ever return
   204?" for each row, now that there's a live instance to check against.

## Definition of Done (gate for merging to our main — unchanged)

- [x] Live contract suite green against jira.rapidsoft.ru in **both**
      auth schemes, driven through **production credential shapes**.
      **Confirmed 2026-07-07: 29/29, both schemes, run twice.** Getting
      here required fixing two live-discovered bugs — see part 2 above
      and "Environment" below.
- [x] The documented DC Basic flow works exactly as the docs describe
      it. Confirmed live via the "production credential shape: Basic
      username+password as IntegrationManager.getAdapter builds it" test.
- [x] All 10 worklist items fixed.
- [ ] Cleanup items done (one detection state machine, no dead helpers,
      detection persisted, no legacy fields). 3 of 4 done (dead
      `userRefField` wired in, D4 detection persisted, legacy
      `apiEmail`/`apiToken` dropped); the detection-state-machine dedup
      is still open — no longer blocked on live access (the suite is
      green now), just not done — see "What to do" #3.
- [x] Full vitest suite green (contract suite included); existing Cloud
      tests untouched and green; `tsc --noEmit` AND `pnpm lint` clean.
      12 pre-existing suite-load failures unrelated to Jira (missing env
      vars / zenstack not generated on Windows, see "Environment"
      below) and 12 pre-existing unrelated `tsc` errors, neither in a
      touched file.
- [ ] DC unit tests regenerated from fixtures. Two mocks tightened
      against reality this session (one from a fixture, one from a live
      failure); the rest is still undone — see "What to do" #1–#2 (blocked
      on the recorder's overwrite bug, not on live access anymore).
- [x] No secrets in fixtures (re-checked this session; still clean).
- [x] Docs verified against actual behavior — confirmed live as of the
      auth fix; no other doc claims changed this session.

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
- **`.jira-it.env` must be LF, not CRLF** (or at least, `loadEnvFile()`
  now handles either — but if you ever touch that function again, keep
  it that way). A Windows editor that defaults to CRLF will silently
  break env loading: `loadEnvFile()` used to split on `"\n"` only, and
  JS regex `.` treats `\r` as a line terminator, so `(.*)$` without `/m`
  could never match a line with a trailing `\r` — the suite reported
  "0 tests" instead of an error. Fixed by splitting on `/\r?\n/`
  instead; noted here because it's the kind of silent failure that
  wastes an hour if you don't know to look for it.
- **Audit trail:** iteration-2 audit with exact file/line references:
  https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588
- **Plan:** `PLAN-jira-dc-494.md` (same directory) — D1–D4 design
  decisions and the 12-family endpoint contract matrix.
- The unrelated `PLAN.md` in the same directory (milestones #8/#9) — do
  not touch.
- **Session state:** part 1 of iteration 3 was committed as `9b124cf4`
  ("Data Center Basic auth plumbing, pagination cursor, user-picker
  fields (iteration 3)"). Part 2's two live-discovered fixes
  (`loadEnvFile` CRLF splitting in `jira-dc.contract.test.ts`, and the
  `makeRequest` 204 handling in `JiraAdapter.ts`) — check `git status`
  for whether they've landed in a follow-up commit yet.
