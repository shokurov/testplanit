# Revised Plan: Jira Server / Data Center support (issue #494, PR #495)

**Status:** revision of the original plan after code review of PR #495
(branch `fix/jira-datacenter-494`, head `3e8f45db` at time of writing).
The original plan's architecture stands; this revision fixes its two
load-bearing simplifications and replaces the mock-first test strategy
with a live-instance contract suite.

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

---

## Backward compatibility

Unchanged from the original plan: Cloud `email`+`apiToken` → Basic,
`/rest/api/3`, OAuth via the `api.atlassian.com` gateway; default to
Cloud when detection is unreachable; no DB schema change
(`settings.deploymentType`/`authScheme` are JSON settings keys).
Addition: persisted detection (D4) must never *flip* an integration
that is currently working — only fill in missing keys.

## Out of scope (unchanged)

- DC OAuth (Atlassian 3LO is Cloud-only).
- Webhook signature differences between Cloud and DC.
- Cloud-side contract recording (no Cloud sandbox available).
