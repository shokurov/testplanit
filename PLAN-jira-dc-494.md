# Revised Plan: Jira Server / Data Center support (issue #494, PR #495)

**Status:** second revision. The first revision (after code review of
PR #495, head `3e8f45db`) fixed the original plan's two load-bearing
simplifications and replaced the mock-first test strategy with a
live-instance contract suite. Iteration 3 (head `502d8880`) executed
Phases A–C against a live Jira DC instance — the 10-item worklist below
is now closed and the DC contract suite is green (29/29, both auth
schemes).

**This revision adds Phase E: a Jira Cloud sandbox, a Cloud contract
suite, and a full two-deployment regression** — the last functional
unknown is Cloud-side, not DC-side (iteration 3 changed Cloud's
assignee write shape `{ id }` → `{ accountId }` and touched every
shared write path, all verified live on DC only). It also hardens the
contract-suite harness against a live-discovered footgun (Phase A
amendment below).

Review found 10 verified defects (8 confirmed, 2 plausible) plus 3
cleanup items — all listed in the worklist below.

---

## What the original plan got wrong

1. **"v2 = v3 at a different URL."** The plan prescribed replacing every
   `/rest/api/3` literal with `/rest/api/${apiVersion}` and acknowledged
   only two dialect differences (search endpoint, user identity field).
   In reality Jira DC v2 differs in payload formats, endpoint existence,
   query parameters, pagination, and response shapes. Six of the ten
   review findings are dialect mismatches the sweep missed.
2. **"Auth scheme is inferable from field shape."** On DC, a secret in
   the API Token field is inherently ambiguous — password or PAT — and
   no heuristic resolves it for both user populations. The plan's rule
   (`email empty + apiToken → bearer`) broke email+PAT users; the
   implemented rule (`server + apiToken w/o password → bearer`, commit
   `439381ca`) broke the *documented* username+password flow. The
   explicit scheme control the plan deferred to "later" must be in scope.
3. **Mock-first tests validate the plan against itself.** All DC unit
   tests passed while five DC flows were broken, because mocks were
   written from the same wrong assumptions as the code. Commit
   `3e8f45db` (login-page 302 on unknown v3 paths at jira.rapidsoft.ru)
   is live proof: real instances violate assumptions mocks encode.
4. Smaller gaps: `settings.deploymentType` persistence was "optional"
   (must be mandatory — see D4); `username`/`password` were added to the
   route/adapter but never plumbed through `IntegrationManager` or the
   form (must be plumbed or dropped — see D3).

## What stands from the original plan

`serverInfo`-based detection with hostname fallback; the shared
`jiraDeployment.ts` helper module; API-key `buildUrl` untouched
(baseUrl-direct works for DC); OAuth remains Cloud-only; default to
Cloud when detection is unreachable; no DB schema change. The
`3e8f45db` improvements (v3 probe with `redirect: "manual"`, detection
on any non-OK v3 result) also stand.

---

## Design decisions (revisions)

### D1. Per-deployment dialect module, not scattered ternaries

Extend `jiraDeployment.ts` into the single home for every Cloud/DC
difference, so each concern is decided in exactly one place:

- `searchPath(deployment, params)` — `/rest/api/2/search` vs
  `/rest/api/3/search/jql`, **including the pagination contract**
  (`startAt`/`maxResults`/`total` vs `nextPageToken`).
- `projectListRequest(deployment)` + response normalizer — DC has **no
  `/project/search`**; use `GET /rest/api/2/project` (returns a bare
  array, not `{values}`).
- `userSearchParams(deployment, query)` — DC v2 takes `username=`, not
  `query=` (also for `/user/assignable/search`).
- `createMetaPath(deployment, projectKey, issueTypeId)` — classic
  `createmeta?expand=` was **removed in DC 9.0** (JRASERVER-72181); DC
  uses `/rest/api/2/issue/createmeta/{projectKey}/issuetypes/{id}`.
- `toJiraContent(text, deployment)` — ADF document (Cloud) vs **plain
  string** (DC) for issue descriptions and comment bodies.
- `userRef(idOrUser, deployment)` — one write-side mapping used by
  reporter, assignee, **and user-picker custom fields** (the form emits
  `{ accountId: value }`; on DC the value is a username and the key must
  be `name`). Replaces the inline ternaries in
  `createIssue`/`updateIssue`; the currently-dead `userRefField` helper
  is either wired in here or deleted.
- `resolveJiraConnection(baseUrl, creds, overrides)` — the shared
  probe/detect/re-auth state machine (v3 `/myself` with
  `redirect:"manual"` → non-OK → `serverInfo` → v2 retry), consumed by
  **both** `JiraAdapter.authenticate` and the test-connection route,
  which currently carry two divergent ~60-line copies.

### D2. Explicit auth scheme, resolved once

- Add an auth-scheme selector to the Jira API_KEY form, shown for
  Server/DC: **Personal Access Token (Bearer)** vs **Username +
  password (Basic)**. Until the user picks, test-connection may resolve
  it by trying both schemes.
- `resolveAuthScheme` keeps working as the fallback guess, but a
  resolved scheme is **persisted** (D4) so guessing happens at most
  once per integration, and never silently flips a working scheme.
- Regression guard: the documented DC Basic flow (username in Email,
  password in API Token) must authenticate. This is review finding #1
  and currently fails on the branch.

### D3. Credential plumbing: one shape end-to-end

Decide and implement one of:
- (a) Add `username`/`password` fields to `IntegrationConfigForm` for
  DC Basic, and forward them in `IntegrationManager.getAdapter`'s
  authData (today it forwards only `email`/`apiToken`/
  `personalAccessToken`, so the shape the route/adapter/tests accept is
  unreachable in production); **or**
- (b) Drop `username`/`password` from the route/adapter/tests and
  document the email-field convention.

(a) is preferred — it removes the ambiguity that motivated D2's
heuristics in the first place.

### D4. Persist detection results (mandatory, was "optional")

On a successful test-connection, write detected `deploymentType` and
resolved `authScheme` into `integration.settings` (the route already
does a `prisma.integration.update`; extend it). The adapter constructor
already short-circuits on `settings.deploymentType` — persistence makes
detection a one-time event instead of a 3-round-trip probe chain on
every process cold start / adapter-cache miss.

---

## Endpoint contract matrix

The adapter's complete Jira API surface — 12 families. "100% API
coverage" below means every row, in both columns where applicable.

| # | Family | Cloud (v3) | Server/DC (v2) | Review finding |
|---|--------|-----------|----------------|----------------|
| 1 | `GET /myself` | v3 | v2; v3 probe may 302→login page (use `redirect:"manual"`) | fixed in `3e8f45db` |
| 2 | `GET /rest/api/2/serverInfo` | `deploymentType:"Cloud"` | `"Server"`; may be ACL-blocked | — |
| 3 | Project list | `GET /project/search` → `{values}` | **`GET /project`** → bare array | #2 |
| 4 | `GET /issuetype` | same | same | verify live |
| 5 | Create meta | `createmeta?expand=` | **`createmeta/{key}/issuetypes/{id}`** (DC ≥9) | #6 |
| 6 | Create/update issue | description = **ADF** | description = **plain string** | #3 |
| 7 | `GET /issue/{id}` (+comments) | ADF bodies in response | string/wiki bodies — check `mapJiraIssue` handles both | verify live |
| 8 | `POST /issue/{id}/comment` | body = ADF | body = **string** | #4 |
| 9 | Transitions | same shape | same shape | verify live |
| 10 | Search | `POST/GET /search/jql`, `nextPageToken` | `GET /search`, **`startAt`** paging | #8 |
| 11 | User search | `?query=` | **`?username=`** | #5 |
| 12 | `GET /issue/picker` (route probe) | yes | verify live | — |
| — | User refs in write payloads | `{accountId}` (`{id}` also accepted) | **`{name}`**, incl. custom fields | #7 |

---

## Test strategy: record → fix → replay

### Phase A — live contract suite (temporary dependency, permanent asset)

New `testplanit/lib/integrations/adapters/__contract__/jira-dc.contract.test.ts`
(vitest), gated on env: skip the entire suite unless
`JIRA_IT_BASE_URL` is set (`https://jira.rapidsoft.ru`), with
`JIRA_IT_PAT` and `JIRA_IT_USERNAME`/`JIRA_IT_PASSWORD` for the two
auth schemes. Never runs in CI.

- Drives the **real `JiraAdapter`** (not raw fetch) through every row
  of the matrix, in both auth schemes.
- A recording `fetch` wrapper writes request/response pairs to
  `__fixtures__/jira-dc/*.json` (method, path, params, request body,
  status, response body — secrets redacted).
- **Record the negative shapes too**: ADF description → 400,
  `/project/search` → 404, `?query=` user search → 400, classic
  createmeta → 404, v3 path → 302. These recordings are the regression
  tests for the fixes.
- Live-instance prerequisites: a dedicated sandbox project (suite
  creates real issues; teardown via `DELETE /issue/{key}`), configured
  with a **required custom field** and a **user-picker custom field**
  (findings #6/#7 are not reproducible without them).

**Amendment (post-iteration-3): explicit opt-in gating.** As shipped,
the suite self-enables whenever `.jira-it.env` exists at the repo root —
which means *any* full local vitest run on a dev machine with that file
silently drives the live instance (creates/deletes real issues) and
re-records all fixtures. This actually happened during the iteration-3
review: a scoped unit-test run rewrote all 184 fixture files as a side
effect. Fix before Phase E:

- The suite runs only when `JIRA_IT_RUN=1` is set (the
  `test:jira-contract` script sets it; a bare `pnpm test` never does,
  even with `.jira-it.env` present).
- Fixture **recording** is a second, separate opt-in: `JIRA_IT_RECORD=1`.
  A normal contract run verifies against the live instance without
  touching `__fixtures__/`; re-recording is a deliberate act whose diff
  gets reviewed.

### Phase B — fix against red contract tests

The worklist, most severe first (verification verdicts from review):

1. DC Basic misclassified as Bearer (`resolveAuthScheme`) — D2/D3. CONFIRMED
2. `getProjects` uses `/project/search` + `{values}` parsing — D1. CONFIRMED
3. ADF description in `createIssue`/`updateIssue` — D1 `toJiraContent`. CONFIRMED
4. ADF comment body in `addComment` — D1 `toJiraContent`. CONFIRMED
5. `user/search?query=` on DC — D1 `userSearchParams`. CONFIRMED
6. Classic `createmeta?expand=` removed in DC 9+ — D1 `createMetaPath`. CONFIRMED
7. User-picker custom fields sent as `{accountId}` — D1 `userRef`. CONFIRMED
8. DC search pagination sends `nextPageToken`, ignores `startAt`;
   `hasMore` true with no way to advance — D1 `searchPath`. CONFIRMED
9. `username`/`password` not forwarded by `IntegrationManager` — D3. PLAUSIBLE
10. Email now optional for Cloud too → bare token becomes Bearer → opaque
    401 (email should be required unless deployment is server) — D2. PLAUSIBLE

Cleanup (same pass): deduplicate the route/adapter detection state
machines into `resolveJiraConnection` (D1); wire in or delete the dead
`userRefField`; persist detection (D4); drop the write-only legacy
`apiEmail`/`apiToken` fields in `JiraAdapter`.

Phase B is done when the full contract suite is green against the live
instance in both auth schemes.

### Phase C — fixture-derived unit mocks (what the PR ships)

Regenerate the DC unit-test mocks in `JiraAdapter.test.ts` /
`route.test.ts` from the Phase A fixtures:

- Mocks **assert the request shape** (method, path, params, body schema)
  against the recorded contract — an unexpected request fails the test
  instead of falling through to a stubbed 200.
- Response bodies come from recorded reality, not hand-written guesses.
- Existing Cloud tests stay as-is (no Cloud sandbox to record from).

### Phase D — CI wiring

- PR CI: unit tests only (fixture-backed) — no live dependency.
- `npm run test:jira-contract` — the env-gated live suite, run on
  demand before merging Jira-touching changes.
- Keep the contract suite in-tree after this fix lands: env-gated it
  costs nothing, and it is the only guard against the next dialect
  drift (e.g. Atlassian retiring classic `/search` on Cloud, DC
  gaining v3 endpoints).

### Phase E — Cloud sandbox + Cloud contract suite + full regression

Everything in Phases A–C was validated live against **Data Center
only**. But the fix touched every shared write path, and two changes
are Cloud-behavior-affecting with zero live verification:

- Cloud's assignee write shape changed `{ id }` → `{ accountId }`
  (side effect of the `userRef` consolidation). Both are documented as
  valid; nothing has proven it live.
- `makeRequest`'s new 204/empty-body handling now runs for Cloud
  responses too (it fixed a latent Cloud bug — `updateIssue` would have
  crashed on Cloud's own 204s — but that claim is also only
  unit-tested).

**E1. Cloud sandbox (human setup — one-time).** A free Jira Cloud site
(https://www.atlassian.com/software/jira/free, 10-user limit is fine):

- Company-managed project (the classic kind — team-managed projects
  have a different createmeta/screens model), dedicated to the suite;
  suggested key `TITC`.
- Same shape as the DC sandbox: a **required custom field** and a
  **user-picker custom field** on the Task create screen.
- An API token (id.atlassian.com → Security → API tokens) + the account
  email; note the account's `accountId` (visible in the profile URL).
- Ideally a second user (or app-user) so assignee/user-picker tests can
  assign someone other than the reporter.
- Credentials land in the same gitignored `.jira-it.env`:
  `JIRA_CLOUD_IT_BASE_URL`, `JIRA_CLOUD_IT_EMAIL`,
  `JIRA_CLOUD_IT_API_TOKEN`, `JIRA_CLOUD_IT_PROJECT_KEY`.

**E2. Cloud contract suite.** New
`__contract__/jira-cloud.contract.test.ts`, same harness/recorder
(fixtures to `__fixtures__/jira-cloud/`), gated on the E1 env vars +
`JIRA_IT_RUN=1`, driving the real `JiraAdapter` through the **Cloud
column** of the endpoint matrix:

| # | Family | What must hold on Cloud |
|---|--------|-------------------------|
| 1 | auth `/myself` | v3, Basic email:apiToken, exactly one probe (no detection round-trips) |
| 2 | bare-token guard | apiToken with no email → the explicit "Cloud requires email + API token" error, not an opaque 401 (worklist #10's fix, never exercised live) |
| 3 | project list | `/project/search` → `{values}` parsing |
| 4 | issue types | `/issuetype` / project details |
| 5 | createmeta | classic `createmeta?expand=projects.issuetypes.fields` |
| 6 | createIssue | ADF description accepted (TipTap→ADF, HTML→ADF, plain-string→ADF paths); **assignee `{ accountId }` write lands** — the issue is actually assigned (the open question this phase exists for) |
| 6b | user-picker custom field | `{ accountId }` passes through unmapped and lands |
| 7 | getIssue | ADF description/comment bodies parse back to HTML |
| 8 | addComment | ADF body accepted |
| 9 | transitions | transition executes; **response is 204/empty → `updateIssue` must not throw** (the live-DC-discovered bug, confirmed on Cloud) |
| 10 | search | `/search/jql`, `nextPageToken` cursor advances to page 2, `isLast` honored |
| 11 | user search | `?query=` param |
| 12 | issue/picker | reachable on v3 |

Cleanup discipline same as DC: suite creates real issues, teardown
deletes them.

**E3. Full regression = the merge gate.** One pass, all of:

1. DC contract suite — both auth schemes (re-run, must stay 29/29).
2. Cloud contract suite — all E2 rows green.
3. Full unit suite + `tsc --noEmit` + `pnpm lint` clean.
4. A manual test-connection through the real UI against both
   deployments (exercises the route + D4 persistence + form fields the
   contract suites bypass).

Only after E3 passes does the branch merge to our `main` and the
upstream PR get opened. Phase E also unblocks the deferred
`resolveJiraConnection` dedup: with *both* live baselines green, the
refactor finally has a safety net on the Cloud side of the state
machine too.

---

## Backward compatibility

Unchanged from the original plan: Cloud `email`+`apiToken` → Basic,
`/rest/api/3`, OAuth via the `api.atlassian.com` gateway; default to
Cloud when detection is unreachable; no DB schema change
(`settings.deploymentType`/`authScheme` are JSON settings keys).
Addition: persisted detection (D4) must never *flip* an integration
that is currently working — only fill in missing keys.

## Out of scope

- DC OAuth (Atlassian 3LO is Cloud-only).
- OAuth-path live testing on Cloud (3LO requires an interactive user
  consent flow; the test-connection route's client-config check plus
  existing unit tests remain the coverage there).
- Webhook signature differences between Cloud and DC.
- ~~Cloud-side contract recording (no Cloud sandbox available)~~ —
  now **in scope** as Phase E (sandbox setup is E1).
