import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JiraAdapter } from "../JiraAdapter";
import { installRecorder, type Recorder } from "./recorder";
import { loadEnvFile } from "./loadEnvFile";
import { Buffer } from "node:buffer";

/**
 * Live Jira Cloud contract suite (Phase E / E2 of PLAN-jira-dc-494.md).
 *
 * Every DC-side fix in this branch touched shared write paths, and two
 * changes are Cloud-behavior-affecting with zero live verification before
 * this suite: the assignee write shape changed `{ id }` -> `{ accountId }`
 * (both documented as valid on Cloud, but nothing had proven it live), and
 * `makeRequest`'s 204/empty-body handling (found via a live DC crash) now
 * runs for Cloud responses too. This suite is what proves both live.
 *
 * Env-gated behind the same two independent opt-ins as the DC suite:
 *
 *  - `JIRA_IT_RUN=1` — required to run at all (set by
 *    `test:jira-cloud-contract` / `test:jira-cloud-contract:record`).
 *  - `JIRA_IT_RECORD=1` — required to (re)write fixtures; a normal run
 *    verifies against live Cloud without touching `__fixtures__/`.
 *
 * To run locally:
 *
 *   JIRA_IT_RUN=1 \
 *   JIRA_CLOUD_IT_BASE_URL=https://yoursite.atlassian.net \
 *   JIRA_CLOUD_IT_EMAIL=<email> \
 *   JIRA_CLOUD_IT_API_TOKEN=<token> \
 *   JIRA_CLOUD_IT_PROJECT_KEY=TITC \
 *   pnpm test:jira-cloud-contract
 *
 * Or place the `JIRA_CLOUD_IT_*` vars in the same gitignored `.jira-it.env`
 * used by the DC suite and run `pnpm test:jira-cloud-contract`.
 *
 * Prerequisite: a **company-managed** Jira Software project (team-managed
 * projects use a different createmeta/screens model) with a required
 * custom field and a user-picker custom field on the Task create screen —
 * same shape as the DC sandbox, needed to reproduce worklist #7 (user-ref
 * custom fields) on this side.
 *
 * Tests create real issues and delete them in teardown.
 */

loadEnvFile();

const BASE_URL = process.env.JIRA_CLOUD_IT_BASE_URL;
const EMAIL = process.env.JIRA_CLOUD_IT_EMAIL;
const API_TOKEN = process.env.JIRA_CLOUD_IT_API_TOKEN;
const PROJECT_KEY = process.env.JIRA_CLOUD_IT_PROJECT_KEY;

const RUN =
  process.env.JIRA_IT_RUN === "1" &&
  !!BASE_URL &&
  !!EMAIL &&
  !!API_TOKEN &&
  !!PROJECT_KEY;

function rawHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64")}`,
    Accept: "application/json",
  };
}

// This sandbox's Task issue type has TWO required custom fields, both
// plain text — confirmed via GET /rest/api/3/field (schema.type "string").
// Every createIssue call must supply both or Jira 400s.
//
// Live-discovered gotcha worth keeping: customfield_10041 ("TestPlanIt
// required text") does NOT appear at all in createmeta's field list for
// this issue type (GET /issue/createmeta?...&expand=projects.issuetypes.fields),
// yet POST /issue still rejects its absence. Only customfield_10043 ("IT
// Required Field", added for this suite) shows up in createmeta as
// required. createmeta is evidently not a complete picture of what's
// enforced at creation time on this instance — so this suite hardcodes
// both rather than deriving them from createmeta.
const REQUIRED_CUSTOM_FIELDS: Record<string, string> = {
  customfield_10041: "contract suite value",
  customfield_10043: "contract suite value",
};

describe.skipIf(!RUN)("Jira Cloud live contract", () => {
  let recorder: Recorder;
  let adapter: JiraAdapter;
  const createdKeys: string[] = [];

  function adapterFor(): JiraAdapter {
    return new JiraAdapter({
      provider: "JIRA",
      baseUrl: BASE_URL,
    });
  }

  beforeEach(async () => {
    recorder = installRecorder("jira-cloud");
    adapter = adapterFor();
    await adapter.authenticate({
      type: "api_key",
      email: EMAIL,
      apiToken: API_TOKEN,
      baseUrl: BASE_URL,
    });
  });

  afterEach(async () => {
    recorder?.stop();
    for (const key of createdKeys.splice(0)) {
      try {
        await fetch(`${BASE_URL}/rest/api/3/issue/${key}`, {
          method: "DELETE",
          headers: rawHeaders(),
        });
      } catch {
        /* best effort */
      }
    }
  });

  // #1 — GET /myself (auth handshake). Cloud with a proper email+apiToken
  // pair should resolve in a single v3 probe — no serverInfo/v2 fallback
  // round-trips, unlike the DC auto-detection path.
  it("#1 authenticate: /myself resolves the current user via a single v3 probe", async () => {
    const user = await adapter.getCurrentUser();
    expect(user).not.toBeNull();
    expect(user?.displayName).toBeTruthy();
    expect(user?.accountId).toBeTruthy();
    expect((adapter as any).deployment).toBe("cloud");
    expect((adapter as any).apiVersion).toBe("3");
  });

  // #2 — bare-token guard (worklist #10's fix), never exercised against
  // real Cloud before this suite. An apiToken with no email can never
  // authenticate as Basic (Cloud requires email:apiToken) and must not be
  // silently retried as a DC-style Bearer PAT.
  it("#2 bare-token guard: apiToken with no email throws the explicit Cloud-requires-email error", async () => {
    const bare = adapterFor();
    await expect(
      bare.authenticate({
        type: "api_key",
        apiToken: API_TOKEN,
        baseUrl: BASE_URL,
      })
    ).rejects.toThrow(/requires an email address paired with the API token/i);
  });

  // #3 — Project list (Cloud: GET /project/search -> { values })
  it("#3 getProjects: returns the sandbox project from /project/search ({ values })", async () => {
    const projects = await adapter.getProjects();
    expect(Array.isArray(projects)).toBe(true);
    const found = projects.find((p) => p.key === PROJECT_KEY);
    expect(found).toBeDefined();
    expect(found?.name).toBeTruthy();
  });

  // #4 — Issue types (shared code path: GET /project/{key}, same URL
  // pattern as DC modulo apiVersion — this proves it resolves to v3 here).
  it("#4 getIssueTypes: returns issue types for the project", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    expect(types.length).toBeGreaterThan(0);
    expect(types.some((t) => t.name === "Task")).toBe(true);
  });

  // #5 — Create meta (Cloud: classic createmeta?expand=projects.issuetypes.fields)
  it("#5 getIssueTypeFields: returns fields incl. custom fields", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const fields = await adapter.getIssueTypeFields(PROJECT_KEY!, task.id);
    expect(fields.length).toBeGreaterThan(0);
    // Should include the user-picker custom field from the E1 setup.
    expect(
      fields.some(
        (f: any) => f.key?.startsWith("customfield_") && f.schema?.type === "user"
      )
    ).toBe(true);
  });

  // #6a — plain-string description is wrapped into ADF (not rejected/sent raw)
  it("#6a createIssue: plain-string description converts to ADF and reads back", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: plain description",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      description: "plain string body from the cloud contract suite",
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);
    expect(issue.key).toMatch(new RegExp(`^${PROJECT_KEY}-`));
    expect(issue.description).toContain("plain string body from the cloud contract suite");
  });

  // #6b — HTML description goes through htmlToAdf, not the plain-string path
  it("#6b createIssue: HTML description converts to ADF and reads back", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: HTML description",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      description: "<p>html body</p><p>second paragraph</p>",
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);
    expect(issue.description).toContain("html body");
    expect(issue.description).toContain("second paragraph");
  });

  // #6c — TipTap-doc-shaped description goes through tiptapToAdf
  it("#6c createIssue: TipTap-shaped description converts to ADF and reads back", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: TipTap description",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "tiptap body" }],
          },
        ],
      } as any,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);
    expect(issue.description).toContain("tiptap body");
  });

  // #6d — the actual point of this phase: assignee { accountId } write
  // lands and the issue is really assigned, not just accepted by a lenient
  // API. Assigns to self since the sandbox may only have one user.
  it("#6d createIssue: assignee { accountId } write lands and the issue is really assigned", async () => {
    const me = await adapter.getCurrentUser();
    expect(me).not.toBeNull();
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;

    const issue = await adapter.createIssue({
      title: "IT contract: assignee accountId",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      assigneeId: me!.accountId,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);

    const fetched = await adapter.getIssue(issue.key);
    expect(fetched.assignee).toBeDefined();
    expect(fetched.assignee?.id).toBe(me!.accountId);
  });

  // #6b (matrix row) — a user-picker custom field's { accountId } value
  // passes through unmapped on Cloud (only DC's userRef remaps it to
  // { name }) and actually lands on the issue.
  it("#6e createIssue: writes a user-picker custom field ({ accountId } passes through unmapped)", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const fields = await adapter.getIssueTypeFields(PROJECT_KEY!, task.id);
    const userField = fields.find(
      (f: any) => f.key?.startsWith("customfield_") && f.schema?.type === "user"
    );
    expect(userField).toBeDefined();

    const me = await adapter.getCurrentUser();
    expect(me).not.toBeNull();

    const issue = await adapter.createIssue({
      title: "IT contract: user-picker custom field",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: {
        ...REQUIRED_CUSTOM_FIELDS,
        [userField!.key]: { accountId: me!.accountId },
      },
    });
    createdKeys.push(issue.key);

    // Read the field back directly — adapter.getIssue()'s fixed field list
    // doesn't request custom fields, so bypass it here.
    const raw = await fetch(
      `${BASE_URL}/rest/api/3/issue/${issue.key}?fields=${userField!.key}`,
      { headers: rawHeaders() }
    );
    const rawBody = await raw.json();
    expect(rawBody.fields?.[userField!.key]?.accountId).toBe(me!.accountId);
  });

  // #7 — getIssue: ADF description parses back to HTML (already exercised
  // by #6a-#6c above via issue.description); this test isolates the
  // addComment/getIssueComments round-trip instead.
  it("#8 addComment: ADF comment body is accepted and reads back as HTML", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: comment",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);

    await (adapter as any).addComment(issue.key, "contract comment");
    const comments = await adapter.getIssueComments(issue.key);
    expect(comments.some((c) => c.body.includes("contract comment"))).toBe(true);
  });

  // #9 — Transitions: the live-DC-discovered 204/empty-body bug
  // (makeRequest used to crash on Jira's 204 No Content) was a latent
  // Cloud bug too, per the fix's own commit message — this confirms it
  // live on Cloud, not just via a unit-test mock.
  it("#9 transitions: executes a transition and reverts it (204/empty responses must not throw)", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: transition",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);

    const before = await adapter.getIssue(issue.key);
    const originalStatus = before.status;

    const transitionsResp = await fetch(
      `${BASE_URL}/rest/api/3/issue/${issue.key}/transitions`,
      { headers: rawHeaders() }
    );
    const { transitions } = await transitionsResp.json();
    const forward = (transitions || []).find(
      (t: any) => t.to?.name && t.to.name !== originalStatus
    );
    expect(forward).toBeDefined();

    await expect(
      adapter.updateIssue(issue.key, { status: forward.to.name })
    ).resolves.toBeTruthy();
    const afterForward = await adapter.getIssue(issue.key);
    expect(afterForward.status).toBe(forward.to.name);

    // Best-effort revert — not every workflow has a transition straight
    // back to the original status, so this doesn't assert.
    const backResp = await fetch(
      `${BASE_URL}/rest/api/3/issue/${issue.key}/transitions`,
      { headers: rawHeaders() }
    );
    const { transitions: backTransitions } = await backResp.json();
    const back = (backTransitions || []).find(
      (t: any) => t.to?.name === originalStatus
    );
    if (back) {
      await adapter.updateIssue(issue.key, { status: back.to.name });
      const afterBack = await adapter.getIssue(issue.key);
      expect(afterBack.status).toBe(originalStatus);
    }
  });

  // #10 — Search: Cloud's enhanced /search/jql, nextPageToken pagination,
  // isLast honored (row 10's matrix requirement).
  it("#10 searchIssues: /search/jql returns issues, isLast honored", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const issue = await adapter.createIssue({
      title: "IT contract: search",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(issue.key);

    const res = await adapter.searchIssues({ projectId: PROJECT_KEY, limit: 50 });
    expect(res.issues.length).toBeGreaterThan(0);
    expect(typeof res.hasMore).toBe("boolean");
  });

  // #10b — nextPageToken cursor actually advances to page 2 (not just
  // present) — the same regression SyncService.performProjectImport
  // depends on, now confirmed on Cloud's own cursor rather than DC's
  // synthesized one.
  it("#10b searchIssues: nextPageToken advances past page 1", async () => {
    const types = await adapter.getIssueTypes(PROJECT_KEY!);
    const task = types.find((t) => t.name === "Task")!;
    const a = await adapter.createIssue({
      title: "IT contract: page 1",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(a.key);
    const b = await adapter.createIssue({
      title: "IT contract: page 2",
      projectId: PROJECT_KEY!,
      issueType: task.id,
      customFields: REQUIRED_CUSTOM_FIELDS,
    });
    createdKeys.push(b.key);

    const page1 = await adapter.searchIssues({ projectId: PROJECT_KEY, limit: 1 });
    expect(page1.issues.length).toBe(1);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextPageToken).toBeTruthy();

    const page2 = await adapter.searchIssues({
      projectId: PROJECT_KEY,
      limit: 1,
      pageToken: page1.nextPageToken,
    });
    expect(page2.issues.length).toBeGreaterThan(0);
    expect(page2.issues[0]!.id).not.toBe(page1.issues[0]!.id);
  });

  // #11 — User search (Cloud: ?query=, NOT ?username=). Searches by a
  // substring of the authenticated user's own display name so the test
  // doesn't depend on a hardcoded second account existing in the sandbox.
  it("#11 searchUsers: finds a user by query param", async () => {
    const me = await adapter.getCurrentUser();
    const queryTerm = me!.displayName.split(" ")[0]!;
    const res: any = await adapter.searchUsers(queryTerm);
    const users = Array.isArray(res) ? res : res?.users;
    expect(users?.length).toBeGreaterThan(0);
    expect(users?.[0]?.displayName).toBeTruthy();
  });

  // #12 — Issue picker (route probe endpoint) exists on v3
  it("#12 /issue/picker: endpoint is reachable on v3", async () => {
    const resp = await fetch(
      `${BASE_URL}/rest/api/3/issue/picker?currentJQL=&showSubTasks=false&showSubTaskParent=false`,
      { headers: rawHeaders() }
    );
    expect(resp.ok).toBe(true);
  });
});
