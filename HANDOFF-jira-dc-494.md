# Handoff: Jira Server / Data Center support (issue #494) — iteration 3

**TL;DR:** Two iterations done, one to go. The endpoint-dialect fixes
(Phase A/B) are real and validated against a live Jira Data Center
instance, but the **authentication story is still broken for the
documented DC Basic flow**, four more worklist items are open, none of
the cleanup items were done, and `pnpm lint` fails on the new
`__contract__` files. Full audit with file/line references:
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

## Where things stand (branch head `c0871773`)

Trust these:
- Detection architecture (`serverInfo` probe + hostname fallback,
  `redirect:"manual"` v3 probe), the `jiraDeployment.ts` helper module,
  the contract-suite harness and recorder, the endpoint fixes for
  worklist items #2–#6, and the docs skeleton.
- Fixtures are secret-clean (Authorization headers redacted; the 40-hex
  string in `call-001.json` is Jira's `scmInfo` build hash).

Do NOT trust these:
- **"24/24 green in both auth schemes."** True but misleading: the
  Basic-scheme contract tests drive the adapter through
  `{ username, password }` — a credential shape that production can
  never produce (the form doesn't collect those fields and
  `IntegrationManager.getAdapter` doesn't forward them). The
  *documented* DC Basic flow (username in the Email field, password in
  the API Token field) still resolves to `Bearer <password>` and 401s.
- The 5 new DC unit tests in `JiraAdapter.test.ts` — hand-written
  mocks, not regenerated from fixtures; they cover auth/search/user
  mapping only. Worklist fixes #2–#6 and #8 have **no unit coverage**;
  only the env-gated contract suite (never run in CI) exercises them.
- `eslint` — the PR claims clean, but `pnpm lint` (`eslint .`, what CI
  runs) fails with 2 parsing errors on `__contract__/*.ts`: they were
  excluded from `tsconfig.json` but not from `eslint.config.mjs`.
  Actions don't run on this fork, so CI never caught it.

## What to do (order matters — most severe first)

1. **Fix DC Basic auth for the documented flow (worklist #1 + D2/D3).
   This is the blocker** — it's the exact failure reported in the
   upstream issue. Decide and implement one of the plan's D3 options:
   - (a) *preferred:* add `username`/`password` fields to
     `IntegrationConfigForm` (shown for Server/DC), forward them in
     `IntegrationManager.getAdapter`'s authData
     (`testplanit/lib/integrations/IntegrationManager.ts:155-159`
     currently forwards only `email`/`apiToken`/`personalAccessToken`),
     and update the docs; or
   - (b) make `resolveAuthScheme`
     (`testplanit/lib/integrations/adapters/jiraDeployment.ts:118`)
     honor the documented Email+APIToken→Basic convention on server.
   Either way, add a contract test that authenticates through the
   **production credential shape**, not `{username, password}`.
2. **Return a DC pagination cursor (worklist #8).** The adapter accepts
   `pageToken` as `startAt` but returns `nextPageToken: undefined` for
   DC responses, so `SyncService.performProjectImport`
   (`testplanit/lib/integrations/services/SyncService.ts:991`) can never
   advance past page 1 (with a full first page it re-reads page 1 until
   `IMPORT_MAX_PAGES`). Return e.g. `String(startAt + issues.length)`
   when `hasMore`. Add a page-2 contract test.
3. **Map user-picker custom fields (worklist #7, D1 `userRef`).**
   `createIssue`/`updateIssue` still pass custom fields through
   untouched, so a user-picker value goes out as `{accountId}` on DC.
   Route reporter, assignee, AND user-picker custom fields through one
   `userRef` mapper. Add a contract test that *writes* such a field —
   the sandbox project already has one configured (contract test #5
   proves it exists but never writes it).
4. **Require email unless deployment is server (worklist #10).** The
   form made email unconditionally optional
   (`IntegrationConfigForm.tsx:97`); a bare Cloud token now becomes
   Bearer and fails with an opaque 401.
5. **Fix lint:** add `**/__contract__/**` to `eslint.config.mjs`
   ignores (or `allowDefaultProject`). Verify with `pnpm lint`.
6. **Cleanup pass (all four items from the plan, none done yet):**
   - Extract `resolveJiraConnection` into `jiraDeployment.ts` and
     consume it from both `JiraAdapter.performAuthentication` and the
     test-connection route — they still carry two divergent ~60-line
     copies of the probe/detect/re-auth state machine.
   - Wire in or delete the dead `userRefField` helper (step 3 above
     likely wires it in).
   - **D4:** on successful test-connection, persist detected
     `deploymentType` and resolved `authScheme` into
     `integration.settings` (the route already does a
     `prisma.integration.update` — extend it; never *flip* a working
     integration, only fill missing keys).
   - Drop the write-only legacy `apiEmail`/`apiToken` fields on
     `JiraAdapter`.
   - While there: the plan's D1 prescribes dialect functions
     (`searchPath`, `projectListRequest`, `userSearchParams`,
     `createMetaPath`, `toJiraContent`, `userRef`) instead of the ~10
     `deployment === "server"` ternaries currently scattered through
     `JiraAdapter`. Consolidate at least the ones you touch.
7. **Phase C — regenerate DC unit mocks from recorded fixtures.**
   Mocks must assert request shape (method, path, params, body) against
   the recorded contract, not stub 200s. Only 7 fixture files exist for
   ~24+ calls — finish recording while you have live access. Existing
   Cloud tests stay as-is.
8. **Contract-suite gaps to close while at it:** test #9 ("transitions")
   never executes a transition (only reads status) — make it actually
   transition and revert; `adapterFor(scheme)` ignores its argument
   (cosmetic).

## Definition of Done (gate for merging to our main — unchanged)

- [ ] Live contract suite green against jira.rapidsoft.ru in **both**
      auth schemes, driven through **production credential shapes**.
- [ ] The documented DC Basic flow works exactly as the docs describe
      it (docs and code must agree — update whichever is wrong).
- [ ] All 10 worklist items fixed; cleanup items done (one detection
      state machine, no dead helpers, detection persisted, no legacy
      fields).
- [ ] DC unit tests regenerated from fixtures; full vitest suite green;
      existing Cloud tests untouched and green; `tsc --noEmit` AND
      `pnpm lint` clean (lint currently fails — see step 5).
- [ ] No secrets in fixtures (grep for the PAT/password before commit).
- [ ] Docs verified against actual behavior.

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
  minimum `npx prisma generate`. Linux CI is unaffected.
- **Audit trail:** iteration-2 audit with exact file/line references:
  https://github.com/shokurov/testplanit/pull/1#issuecomment-4893705588
- **Plan:** `PLAN-jira-dc-494.md` (same directory) — D1–D4 design
  decisions and the 12-family endpoint contract matrix.
- The unrelated `PLAN.md` in the same directory (milestones #8/#9) — do
  not touch.
