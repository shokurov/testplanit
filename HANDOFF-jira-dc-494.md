# Handoff: Jira Server / Data Center support (issue #494) — iteration 4: Cloud regression

**TL;DR:** The Data Center side is done and **independently verified**:
iteration 3 closed the entire 10-item worklist, the live DC contract
suite is green (29/29, both auth schemes — confirmed by the author
twice and reproduced once more during the 2026-07-07 review), unit
suite / `tsc` / `pnpm lint` are clean. The last functional unknown is
now **Cloud-side**: the fix touched every shared write path and changed
Cloud's assignee write shape (`{ id }` → `{ accountId }`), verified
live only against DC. This iteration's mission is **Phase E of
`PLAN-jira-dc-494.md`: set up a Jira Cloud sandbox, build a Cloud
contract suite, and run the full two-deployment regression** — that
regression is the merge gate. Before touching Cloud: fix the
contract-suite gating footgun (see step 1 — it bit us during review).

Work continues on branch `fix/jira-datacenter-494` in this repo
(internal review PR: https://github.com/shokurov/testplanit/pull/1).
`PLAN-jira-dc-494.md` (same directory) is the authority for design
(D1–D4) and test strategy (Phases A–E; Phase E is new). Merge into
**our `main`** only when the Definition of Done below is met; then open
a fresh, clean PR upstream (TestPlanIt/testplanit) referencing issue
#494 only. Do not reopen or reference the closed upstream PR #495.

## Background — how we got here

1. **The bug (upstream issue TestPlanIt/testplanit#494).** The Jira
   integration was hardcoded for Atlassian Cloud: every call used
   `/rest/api/3` (DC only ships v2), API-key auth was always
   `Basic email:apiToken` (a DC PAT must be `Bearer`), users were
   addressed by `accountId` (DC uses `name`/`key`). Result: HTTP 404/401
   against any self-hosted Jira, contradicting the documented DC support.
2. **Iteration 1 (upstream PR #495 — closed deliberately).** First
   implementation treated DC v2 as "v3 at a different URL" and guessed
   the auth scheme from form-field shapes. Code review verified 10
   defects: DC auth and most DC write paths were broken despite green
   mock-based unit tests — the mocks encoded the same wrong assumptions
   as the code. The review produced `PLAN-jira-dc-494.md` and the
   10-item worklist.
3. **Iteration 2 (commits `6491b366`…`c0871773`).** Phase A (env-gated
   live contract suite + recorder against https://jira.rapidsoft.ru)
   and most of Phase B (endpoint dialect fixes: `/project` bare array,
   new createmeta, plain-string descriptions/comments, `?username=`
   user search, `startAt` accepted, login-page-redirect detection).
4. **Iteration-2 audit (2026-07-06).** Verdict: not ready — the auth
   blocker remained (the *documented* DC Basic flow resolved to Bearer
   and 401'd; the contract suite's Basic tests used a credential shape
   production couldn't produce), plus 4 more worklist items, all
   cleanup items, and a latent CI lint failure. Full audit with
   file/line references:
   https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588
5. **Iteration 3 (2026-07-07, commits `9b124cf4`, `a25b971d`,
   `502d8880`).** Closed out the audit worklist:
   - **Auth blocker via D3 option (a):** dedicated Username/Password
     fields on `IntegrationConfigForm`, forwarded through
     `IntegrationManager.getAdapter`; docs rewritten to match.
   - **#7:** `mapCustomFieldUserRefs` wires `userRefField` into
     `createIssue`/`updateIssue` for reporter, assignee, and user-picker
     custom fields. Side effect: Cloud assignee shape is now
     `{ accountId }` instead of `{ id }` (both documented as valid —
     the thing Phase E must confirm live).
   - **#8:** `searchIssues` synthesizes `nextPageToken` from `startAt`
     on DC — `SyncService.performProjectImport` can advance past page 1.
   - **#10:** explicit "Jira Cloud requires an email + API token" error
     instead of an opaque 401 for a bare token on Cloud (symptom fix;
     stricter form-level requirement still an open option).
   - **D4:** successful test-connection persists
     `deploymentType`/`authScheme` into `integration.settings`,
     fill-missing-only. Legacy `apiEmail`/`apiToken` fields dropped.
     Lint fixed (`**/__contract__/**` in eslint ignores).
   - **Two live-discovered bugs fixed** that mocks couldn't catch:
     `loadEnvFile()`'s CRLF splitting (suite silently reported "0
     tests"), and `makeRequest` crashing on Jira's `204 No Content`
     (PUT /issue, transition POST) — a latent **production** bug that
     would have hit Cloud too. Both now have regression tests.
   - **Phase C mostly done:** the recorder's overwrite bug fixed
     (fixtures now namespaced per-test); 184 fixture files across 29
     per-test directories; `createIssue`/`updateIssue` DC mocks
     tightened against recorded reality + a dedicated 204 regression
     test. Contract suite extended: production-credential-shape auth
     test, `#5b` user-picker write, `#9` real transition + revert,
     `#10b` page-2 pagination.
6. **Iteration-3 verification (2026-07-07, review session).** All of
   iteration 3's claims re-checked against the code — **all confirmed**
   (form/manager plumbing, `mapCustomFieldUserRefs`, cursor synthesis,
   D4 merge precedence, 204 handling, docs). Independently reproduced:
   unit tests 719/719 green in the integration scope, eslint 0 errors,
   and — accidentally — the **live DC suite 29/29 in both schemes**: a
   scoped local vitest run auto-loaded `.jira-it.env` and drove the
   live instance, which also silently re-recorded all 184 fixtures.
   That incident is why step 1 below exists. (A `tsc` run on the review
   machine showed 12 errors in 4 files untouched by the branch — local
   fallout of Windows' broken `zenstack generate`, not a branch issue;
   see Environment.)

## Where things stand (branch head `502d8880`)

Trust these — unit-tested, lint/tsc clean, live-verified on DC in both
auth schemes, and independently re-verified in review:
- All 10 worklist items. The documented DC Basic flow (dedicated
  Username/Password fields) authenticates end-to-end through the same
  `authData` shape `IntegrationManager.getAdapter` builds.
- Detection architecture (`serverInfo` probe, hostname fallback,
  `redirect:"manual"` login-page handling), D4 persistence
  (fill-missing-only), the 204/empty-body fix, the recorder and the 184
  per-test fixtures (secret-scanned clean, twice).

Open items, in this iteration's priority order — details in "What to
do": ~~the contract-suite gating footgun~~ (done, step 1); ~~E1 Cloud
sandbox~~ (done, step 2); ~~E2 Cloud contract suite~~ (done, step 3);
~~Phase C's remaining 4 mock tightenings~~ (done, step 5); **E3 full
regression** (step 4, the merge gate — not started); the
`resolveJiraConnection` dedup; smaller quality items.

**Iteration-4 progress so far (2026-07-08, this session):**
- **Step 1 done:** suite now requires `JIRA_IT_RUN=1` (set by
  `test:jira-contract`/`test:jira-contract:record`, both via `cross-env`
  for Windows compatibility); fixture writes require a separate
  `JIRA_IT_RECORD=1`. Verified: `pnpm test:jira-contract` still 29/29 live
  against DC with zero fixture diffs (record flag unset); a broad
  `vitest run lib/integrations` sweep with `.jira-it.env` present now
  shows `jira-dc.contract.test.ts (29 tests | 29 skipped)` instead of
  silently driving the live instance — this is the exact scenario that
  bit the iteration-3 review.
- **Step 5 done:** `addComment`, `searchUsers`, `getProjects`,
  `getIssueTypes` DC mocks added to `JiraAdapter.test.ts`, request-shape
  + recorded-response-body tightened the same way `createIssue`/
  `updateIssue` were (fixture paths cited in each test's comment).
- **Step 2 (E1) done.** Company-managed Cloud project `TITP` (same key
  as the DC sandbox — different site, no collision) with a required
  text custom field (`customfield_10043`, "IT Required Field") and a
  user-picker field (`customfield_10044`, "IT User Picker") on the Task
  create screen. First attempt landed a **team-managed** project by
  default (Atlassian's quick-start wizard defaults to team-managed
  unless you explicitly pick company-managed) — caught live via
  `GET /project/{key}` (`style: "next-gen"`, `simplified: true`) before
  any suite code was written against it, recreated correctly
  (`style: "classic"`).
- **Step 3 (E2) done.** New `jira-cloud.contract.test.ts`, 16/16 green
  live against the `TITP` Cloud sandbox. Confirms live, for the first
  time: assignee `{ accountId }` write lands (`#6d` — the actual point
  of this phase), transitions/`updateIssue` survive Cloud's 204/empty
  responses (`#9`), and the bare-token guard error fires correctly
  (`#2`, worklist #10). `loadEnvFile()` extracted to a shared module;
  `recorder.ts` now takes a `fixturesSubdir` param instead of a
  hardcoded `"jira-dc"`. 78 fixture files recorded, secret-scanned
  clean. Full `lib/integrations` suite: 638 passed / 48 skipped (32 DC +
  16 Cloud contract tests correctly skipped without `JIRA_IT_RUN`), 0
  failures.
  - **Live-discovered gotcha:** the `TITP` Cloud project has a *second*
    required custom field (`customfield_10041`, pre-existing on the
    site, not added for this suite) that does not appear at all in
    `createmeta`'s field list for the Task issue type — yet `POST
    /issue` still 400s without it. Confirmed via `GET /rest/api/3/field`
    (which does show its schema) vs. `createmeta` (which omits it
    entirely). `createmeta` is not a complete picture of what Jira Cloud
    enforces at creation time; the suite hardcodes both required fields
    rather than deriving them from `createmeta`. Noted in the test file;
    not an adapter bug (the adapter doesn't try to auto-discover
    required fields), but worth knowing if the product's own
    create-issue form ever relies on `createmeta` to decide what to
    prompt for.
- **Next: step 4 (E3), the merge gate.** Not started. Needs: DC suite
  re-run (should stay 29/29 — no DC-side code changed since), Cloud
  suite re-run, full unit suite (have it, see above), `tsc --noEmit` +
  `pnpm lint` clean (blocked on this machine by the Windows zenstack
  gotcha below — needs either the documented workaround or a CI/Linux
  run), and a manual test-connection through the real UI against both
  deployments (needs a working local dev server, which also needs
  zenstack generated correctly).

## What to do (order matters)

1. ~~**Gate the live suite behind explicit opt-ins**~~ **DONE.** Suite
   runs only with `JIRA_IT_RUN=1` (`test:jira-contract` sets it via
   `cross-env`; bare `pnpm test`/`test:unit` never run live, env file or
   not). Fixtures are (re)written only with `JIRA_IT_RECORD=1`, via a new
   `test:jira-contract:record` script — a normal contract run verifies
   without touching `__fixtures__/`. Verified live: 29/29 with no fixture
   diff; a broad `lib/integrations` sweep now skips the suite instead of
   driving it. This working tree had no accidentally re-recorded fixtures
   to discard (that was specific to the iteration-3 review machine).
2. ~~**E1 — Cloud sandbox.**~~ **DONE.** Company-managed project `TITP`
   on a free Cloud site, required text field (`customfield_10043`) +
   user-picker field (`customfield_10044`) on the Task create screen.
   Credentials in the gitignored `.jira-it.env`
   (`JIRA_CLOUD_IT_BASE_URL`/`EMAIL`/`API_TOKEN`/`PROJECT_KEY`). No
   second user set up — the `#6d`/`#6e` tests assign to self instead;
   fine for what they verify (the write shape lands), but note if a
   future pass wants to test assigning to *someone other than* the
   reporter specifically.
3. ~~**E2 — Cloud contract suite.**~~ **DONE.** New
   `__contract__/jira-cloud.contract.test.ts`, 16/16 green live. All
   three point-of-phase rows confirmed on real Cloud:
   - **assignee `{ accountId }` write lands and the issue is really
     assigned** (`#6d`) — iteration 3's only unverified behavior change;
   - **transitions/updateIssue survive Cloud's 204/empty responses**
     (`#9`) — the live-DC-discovered production bug, confirmed on Cloud;
   - **bare-token → explicit error message** (`#2`, worklist #10's fix,
     now exercised against real Cloud, not just unit-tested).
   Fixtures under `__fixtures__/jira-cloud/`; harness shared with the DC
   suite via `loadEnvFile.ts` and `recorder.ts`'s `fixturesSubdir` param.
4. **E3 — full regression (the merge gate).** Not started. One pass,
   all of: DC suite re-run (both schemes, stays 29/29) + Cloud suite
   green + full unit suite + `tsc --noEmit` + `pnpm lint` clean + one
   manual test-connection through the real UI against each deployment
   (exercises route + D4 persistence + form fields, which the contract
   suites bypass). The `tsc`/manual-UI parts need a working local
   zenstack-generated client — see the Windows gotcha below; judge
   `tsc` by CI/Linux if that isn't fixed locally first.
5. ~~**Finish Phase C's remaining mocks.**~~ **DONE.** `addComment`,
   `searchUsers`, `getProjects`, `getIssueTypes` DC tests added to
   `JiraAdapter.test.ts`, asserting request shape (URL/method/body) and
   using response bodies drawn from the recorded fixtures under
   `__fixtures__/jira-dc/jira-dc-live-contract-pat-bearer-{3,4,8,11}-*/`
   — same treatment `createIssue`/`updateIssue` already got. Full
   `lib/integrations` suite: 638 passed / 32 skipped, 0 failures.
6. **Cleanup: extract `resolveJiraConnection`.**
   `JiraAdapter.performAuthentication` and the route's
   `testJiraConnection` still carry two divergent ~60-line copies of
   the probe/detect/re-auth state machine. Deliberately deferred twice;
   after E3 there are live baselines on **both** sides of the state
   machine, so the refactor finally has a full safety net. Re-run both
   suites after, and hand-test the `deploymentType`/`authScheme`
   overrides once (no suite exercises them).
7. **204 audit (opportunistic).** The `makeRequest` fix is general, but
   it was found by accident. With both live instances available, walk
   the endpoint matrix once asking "does this endpoint ever return
   204/empty?" per row.
8. **Optional / explicitly open:** stricter form-level "email required
   for Cloud" (the #10 symptom fix may be enough — decide, don't
   drift); D2 auth-scheme selector UI (D3(a)'s dedicated fields largely
   obviated it); sweeping the remaining `deployment === "server"`
   ternaries into D1 dialect functions.

## Definition of Done (gate for merging to our main)

- [x] Live DC contract suite green, both auth schemes, production
      credential shapes (29/29 — author twice, review once).
- [x] Documented DC Basic flow works exactly as documented.
- [x] All 10 worklist items fixed.
- [x] **Contract suite gated behind `JIRA_IT_RUN`/`JIRA_IT_RECORD`
      opt-ins** (step 1).
- [x] **Cloud contract suite green against the E1 sandbox** — assignee
      `{ accountId }`, 204 handling, and the bare-token error confirmed
      live on Cloud (16/16, steps 2–3).
- [ ] **Full regression pass (E3)** — both suites + unit + tsc + lint +
      manual UI test-connection against both deployments (step 4).
- [x] DC unit mocks regenerated from fixtures — `createIssue`/
      `updateIssue` (+204 regression test) plus `addComment`/
      `searchUsers`/`getProjects`/`getIssueTypes` (step 5).
- [ ] Cleanup: one detection state machine (step 6). Rest of the
      cleanup list is done (dead helper wired in, D4 persisted, legacy
      fields dropped).
- [x] No secrets in fixtures (re-scanned after every fixture-touching
      commit; keep doing that — including for the new
      `__fixtures__/jira-cloud/`).
- [x] Docs match actual behavior.

## Upstreaming (after our main)

- Fresh branch off upstream main, cherry-pick/squash into a clean
  series (suggested: 1. dialect module + tests, 2. adapter/route fixes,
  3. form/manager plumbing + docs, 4. contract-suite harness).
- Fresh PR with its own description; reference issue #494 only — not
  the closed upstream PR #495 and not our internal PR #1.
- Note in the PR that behavior was validated against a live Jira DC
  10.x instance **and a live Jira Cloud site**, with unit fixtures
  recorded from them.

## Environment / access / gotchas

- **Live DC instance:** https://jira.rapidsoft.ru (Jira DC 10.3.13).
  Sandbox project key, PAT, and Basic username/password via
  egors@upbonus.io. The sandbox project has a required custom field and
  a user-picker custom field. Tests create real issues; teardown
  deletes them — double-check cleanup after aborted runs.
- **Cloud sandbox:** https://testplanit-integration.atlassian.net,
  project `TITP` (company-managed). Credentials via egors@upbonus.io —
  already in `.jira-it.env` as `JIRA_CLOUD_IT_*`. No second user; `#6d`/
  `#6e` assign to self.
- **Running the contract suites:** env vars live in a gitignored
  `.jira-it.env` at the repo root (DC: `JIRA_IT_BASE_URL`,
  `JIRA_IT_PROJECT_KEY`, `JIRA_IT_PAT`, `JIRA_IT_USERNAME`,
  `JIRA_IT_PASSWORD`; Cloud: `JIRA_CLOUD_IT_BASE_URL`/`EMAIL`/
  `API_TOKEN`/`PROJECT_KEY`), then `pnpm test:jira-contract` /
  `pnpm test:jira-cloud-contract` to verify (no fixture writes) or the
  `:record` variant of either to deliberately re-record (review the
  fixture diff before committing). All four scripts set `JIRA_IT_RUN=1`
  via `cross-env`; only the `:record` variants also set
  `JIRA_IT_RECORD=1`.
- **Step 1 landed (2026-07-07):** a bare `pnpm test`/`test:unit`, or any
  scoped vitest run, no longer touches the live instance even with
  `.jira-it.env` present — `JIRA_IT_RUN=1` is required and only the two
  scripts above set it. Broad local sweeps are safe again.
- **`.jira-it.env` must be LF** (handled either way now, but keep
  `loadEnvFile()` splitting on `/\r?\n/` — a CRLF file used to make the
  suite silently report "0 tests").
- **Windows dev machines:** `pnpm install`'s postinstall runs
  `NODE_OPTIONS='...' zenstack generate` — Unix-only syntax, so the
  Prisma/ZenStack client silently doesn't get generated: route-level
  tests 500 with `Cannot read properties of undefined (reading
  'JIRA')`, and a *partially* completed generate leaves ~12 implicit-any
  `tsc` errors in unrelated files (`enhanceWithAudit.ts`,
  `shared-dataset`/`column-usage`/`automation-candidates` routes). Fix:
  `$env:NODE_OPTIONS='--max-old-space-size=12288'; npx zenstack
  generate` — retries needed, it EMFILE-flakes on Windows. Linux CI is
  unaffected. Judge `tsc` cleanliness by CI or a Linux machine, not a
  Windows checkout with a half-generated client.
- **Audit trail:** iteration-2 audit:
  https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588
  · iteration-3 report:
  https://github.com/shokurov/testplanit/pull/1#issuecomment-4904663463
- **Plan:** `PLAN-jira-dc-494.md` — D1–D4 design decisions, the
  12-family endpoint contract matrix, Phases A–E (Phase E defines this
  iteration; the Phase A amendment defines step 1's gating).
- The unrelated `PLAN.md` in the same directory (milestones #8/#9) — do
  not touch.
