# Handoff: Jira Server / Data Center support (issue #494)

**TL;DR:** Upstream PR #495 was closed deliberately — code review verified
10 defects (8 confirmed): DC authentication and most DC write paths are
broken despite green tests. The work continues on branch
`fix/jira-datacenter-494` in this repo (`~/work/testplanit`). Follow
`PLAN-jira-dc-494.md` (same directory) — it is the authority for design
and test strategy. Merge into **our `main`** when the Definition of Done
below is met; only then open a fresh, clean PR upstream
(TestPlanIt/testplanit). Do not reopen or reference PR #495 upstream.

## Where things stand

- Branch `fix/jira-datacenter-494`, head `3e8f45db`. The existing commits
  are a usable starting point — detection architecture, `jiraDeployment.ts`
  helper module, docs skeleton, and the `redirect:"manual"` v3-probe fix
  in `3e8f45db` all survive review.
- Root cause of the defects: the implementation treated DC v2 as "v3 at a
  different URL" and guessed the auth scheme from which form fields were
  filled. Both assumptions are wrong; the plan's D1–D4 sections replace
  them.
- The unit tests on the branch pass but prove nothing for DC: the mocks
  return 200 for requests a real DC answers with 400/404. Do not trust
  them until Phase C regenerates them from recorded fixtures.

## What to do (order matters)

1. **Read `PLAN-jira-dc-494.md`** — especially D1 (dialect module), D2
   (explicit auth scheme), the endpoint contract matrix, and Phases A–D.
2. **Phase A — build the live contract suite first, before touching the
   adapter.** Env-gated vitest suite (skips entirely unless
   `JIRA_IT_BASE_URL` is set) driving the real `JiraAdapter` through all
   12 endpoint families in both auth schemes against
   `https://jira.rapidsoft.ru`, with a recording fetch wrapper writing
   fixtures to `__fixtures__/jira-dc/*.json` (redact tokens/passwords).
   Record the failures too (ADF→400, `/project/search`→404,
   `?query=`→400, classic createmeta→404): the suite must be **red** at
   this point — that redness is the reproduced bug list.
   - Ask egors@upbonus.io for: sandbox project key on jira.rapidsoft.ru,
     a PAT, and a Basic username/password. The sandbox project needs a
     required custom field and a user-picker custom field configured.
   - Tests create real issues — clean up in teardown (`DELETE /issue/{key}`).
3. **Phase B — fix until the contract suite is green.** Worklist, most
   severe first (details and design homes in the plan):
   1. DC Basic (username in Email field, password in API Token field)
      gets sent as `Bearer <password>` — the documented flow 401s. → D2/D3.
   2. `getProjects` calls Cloud-only `/project/search` and parses
      `{values}` — DC needs `GET /project` (bare array). 404 on DC.
   3. Issue descriptions sent as ADF objects — v2 requires plain strings.
      400 on every DC create/update with a description.
   4. Comment bodies sent as ADF — same, 400 on every DC comment.
   5. User search sends `?query=` — DC v2 requires `?username=`.
   6. Classic `createmeta?expand=` — removed in DC 9.0; use
      `/createmeta/{projectKey}/issuetypes/{id}`.
   7. User-picker custom fields pass through as `{accountId}` — DC needs
      `{name}` (reporter/assignee are mapped, custom fields are not).
   8. DC search pagination sends `nextPageToken` (ignored by v2, which
      pages by `startAt`) while still reporting `hasMore: true` — page 2
      unreachable.
   9. `username`/`password` accepted by route/adapter but never forwarded
      by `IntegrationManager.getAdapter` nor collectable in the form —
      plumb end-to-end (preferred) or remove the shape.
   10. Email became optional for Cloud too — a bare token on Cloud turns
       into Bearer and fails with an opaque 401; require email unless
       deployment is server.
   - Implement fixes via the D1 dialect module (`toJiraContent`,
     `userRef`, `searchPath`, `userSearchParams`, `createMetaPath`,
     `projectListRequest`, `resolveJiraConnection`) — no scattered
     `deployment === "server"` ternaries. Cleanup in the same pass:
     dedupe the ~60-line detection state machine copied between
     `JiraAdapter.authenticate` and the test-connection route into
     `resolveJiraConnection`; wire in or delete the dead `userRefField`;
     persist detected `deploymentType`/`authScheme` to
     `integration.settings` on successful test-connection (D4); remove
     the write-only legacy `apiEmail`/`apiToken` fields.
4. **Phase C — regenerate DC unit mocks from the recorded fixtures.**
   Mocks must assert request shape (method, path, params, body) against
   the recorded contract, not stub 200s. Existing Cloud tests stay.
5. **Phase D — CI wiring.** PR CI runs unit tests only;
   `npm run test:jira-contract` runs the live suite on demand. The
   contract suite stays in-tree, env-gated, after the fix lands.

## Definition of Done (gate for merging to our main)

- [ ] Live contract suite green against jira.rapidsoft.ru in **both**
      auth schemes (PAT Bearer, Basic username/password).
- [ ] The documented DC Basic flow works exactly as the docs describe it.
- [ ] All 10 worklist items fixed; cleanup items done (one detection
      state machine, no dead helpers, detection persisted).
- [ ] DC unit tests regenerated from fixtures; full vitest suite green;
      existing Cloud tests untouched and green; `tsc --noEmit` and eslint
      clean.
- [ ] No secrets in fixtures (grep for the PAT/password before commit).
- [ ] Docs verified against actual behavior (the current docs describe a
      Basic flow the current code rejects — whichever changes, they must
      agree).

## Upstreaming (after our main)

- Fresh branch off upstream main, cherry-pick/squash into a clean series
  (suggested: 1. dialect module + tests, 2. adapter/route fixes,
  3. form/manager plumbing + docs, 4. contract-suite harness).
- Fresh PR with its own description; reference issue #494 only, not the
  closed PR #495.
- Note in the PR that DC behavior was validated against a live Jira DC
  10.x instance and that DC unit fixtures are recorded from it.

## Access / contacts

- Live DC instance: https://jira.rapidsoft.ru (credentials and sandbox
  project via egors@upbonus.io).
- Plan: `~/work/testplanit/PLAN-jira-dc-494.md`.
- The unrelated `PLAN.md` in the same directory (milestones #8/#9) — do
  not touch.
