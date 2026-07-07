import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JiraAdapter } from "../JiraAdapter";
import type { AuthenticationData } from "../IssueAdapter";
import { installRecorder, type Recorder } from "./recorder";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

/**
 * Live Jira Server / Data Center contract suite.
 *
 * Env-gated: the entire suite is skipped unless `JIRA_IT_BASE_URL` is set,
 * so it never runs in CI. To run locally:
 *
 *   JIRA_IT_BASE_URL=https://jira.mycompany.domain \
 *   JIRA_IT_PROJECT_KEY=TITP \
 *   JIRA_IT_PAT=<pat> \
 *   JIRA_IT_USERNAME=<basic-username> \
 *   JIRA_IT_PASSWORD=<basic-password> \
 *   pnpm test:jira-contract
 *
 * Or place those vars in a gitignored `.jira-it.env` at the repo root and
 * run `pnpm test:jira-contract` (the script sources it).
 *
 * The suite drives the REAL `JiraAdapter` against the live instance through
 * every endpoint family in the contract matrix, in both auth schemes (PAT
 * Bearer and Basic username/password). A recording fetch wrapper writes
 * request/response fixtures to `__fixtures__/jira-dc/*.json` (secrets
 * redacted) so Phase C can regenerate unit mocks from recorded reality.
 *
 * Tests create real issues and delete them in teardown.
 */

// Load env from a gitignored .jira-it.env at the monorepo root, if present,
// so `pnpm test:jira-contract` works without exporting vars manually.
function loadEnvFile() {
  const candidates = [
    resolve(__dirname, "../../../../../.jira-it.env"),
    resolve(__dirname, "../../../../.jira-it.env"),
    resolve(process.cwd(), ".jira-it.env"),
  ];
  for (const p of candidates) {
    try {
      const text = readFileSync(p, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2];
        }
      }
      return;
    } catch {
      /* try next */
    }
  }
}
loadEnvFile();

const BASE_URL = process.env.JIRA_IT_BASE_URL;
const PROJECT_KEY = process.env.JIRA_IT_PROJECT_KEY;
const PAT = process.env.JIRA_IT_PAT;
const USERNAME = process.env.JIRA_IT_USERNAME;
const PASSWORD = process.env.JIRA_IT_PASSWORD;

const RUN = !!BASE_URL && !!PROJECT_KEY && (!!PAT || (!!USERNAME && !!PASSWORD));

interface AuthScheme {
  label: string;
  auth: {
    type: "api_key" as const;
    baseUrl: string;
    email?: string;
    apiToken?: string;
    username?: string;
    password?: string;
  };
}

const schemes: AuthScheme[] = [];
if (PAT) {
  schemes.push({
    label: "PAT (Bearer)",
    auth: {
      type: "api_key",
      baseUrl: BASE_URL!,
      apiToken: PAT,
    },
  });
}
if (USERNAME && PASSWORD) {
  schemes.push({
    label: "Basic (username + password)",
    auth: {
      type: "api_key",
      baseUrl: BASE_URL!,
      username: USERNAME,
      password: PASSWORD,
    },
  });
}

describe.skipIf(!RUN)("Jira DC live contract", () => {
  let recorder: Recorder;
  const createdKeys: string[] = [];

  beforeEach(() => {
    recorder = installRecorder();
  });

  afterEach(async () => {
    recorder?.stop();
    // Cleanup: delete any issues created during the test.
    for (const key of createdKeys.splice(0)) {
      try {
        await fetch(`${BASE_URL}/rest/api/2/issue/${key}`, {
          method: "DELETE",
          headers: PAT
            ? { Authorization: `Bearer ${PAT}` }
            : {
                Authorization: `Basic ${Buffer.from(
                  `${USERNAME}:${PASSWORD}`
                ).toString("base64")}`,
              },
        });
      } catch {
        /* best effort */
      }
    }
  });

  // Helper: build an adapter for the live base URL. Auth scheme is applied
  // separately via adapter.authenticate(scheme.auth), so construction needs
  // nothing scheme-specific.
  function adapterFor(): JiraAdapter {
    return new JiraAdapter({
      provider: "JIRA",
      baseUrl: BASE_URL,
    });
  }

  // Regression guard for the bug reported upstream: IntegrationManager.
  // getAdapter used to forward only email/apiToken/personalAccessToken from
  // a saved integration's `credentials`, so a Basic username+password
  // integration could never reach the adapter in production even though the
  // adapter and test-connection route both already accepted that shape. This
  // builds `authData` the exact way IntegrationManager.getAdapter does (see
  // lib/integrations/IntegrationManager.ts) from a DB-shaped `credentials`
  // object — not the `{ username, password }` shorthand the scheme table
  // below hands the adapter directly — and drives the live instance through
  // it end to end.
  if (USERNAME && PASSWORD) {
    it("production credential shape: Basic username+password as IntegrationManager.getAdapter builds it", async () => {
      const credentials: Record<string, string> = {
        username: USERNAME,
        password: PASSWORD,
      };
      const authData: AuthenticationData = { type: "api_key" };
      if (credentials.email) authData.email = credentials.email;
      if (credentials.apiToken) authData.apiToken = credentials.apiToken;
      if (credentials.username) authData.username = credentials.username;
      if (credentials.password) authData.password = credentials.password;
      authData.baseUrl = BASE_URL;

      const prodAdapter = adapterFor();
      await prodAdapter.authenticate(authData);

      const user = await prodAdapter.getCurrentUser();
      expect(user).not.toBeNull();
      expect(user?.displayName).toBeTruthy();
    });
  }

  // Raw-fetch auth header for a scheme, used by tests that probe the REST
  // API directly (transitions discovery, /issue/picker) instead of through
  // the adapter.
  function headersForScheme(scheme: AuthScheme): Record<string, string> {
    if (scheme.auth.apiToken) {
      return {
        Authorization: `Bearer ${scheme.auth.apiToken}`,
        Accept: "application/json",
      };
    }
    return {
      Authorization: `Basic ${Buffer.from(
        `${scheme.auth.username}:${scheme.auth.password}`
      ).toString("base64")}`,
      Accept: "application/json",
    };
  }

  for (const scheme of schemes) {
    describe(`${scheme.label}`, () => {
      let adapter: JiraAdapter;

      beforeEach(async () => {
        adapter = adapterFor();
        await adapter.authenticate(scheme.auth);
      });

      // #1 — GET /myself (auth handshake)
      it("#1 authenticate: /myself resolves the current user", async () => {
        const user = await adapter.getCurrentUser();
        expect(user).not.toBeNull();
        expect(user?.displayName).toBeTruthy();
        // DC returns name/key, not accountId.
        expect(user?.accountId).toBeTruthy();
      });

      // #3 — Project list (DC: GET /project → bare array, NOT /project/search)
      it("#3 getProjects: returns the sandbox project from /project (bare array)", async () => {
        const projects = await adapter.getProjects();
        expect(Array.isArray(projects)).toBe(true);
        const found = projects.find((p) => p.key === PROJECT_KEY);
        expect(found).toBeDefined();
        expect(found?.name).toBeTruthy();
      });

      // #4 — Issue types
      it("#4 getIssueTypes: returns issue types for the project", async () => {
        const types = await adapter.getIssueTypes(PROJECT_KEY!);
        expect(types.length).toBeGreaterThan(0);
        expect(types.some((t) => t.name === "Task")).toBe(true);
      });

      // #5 — Create meta (DC: /createmeta/{key}/issuetypes/{id}, paginated {values})
      it("#5 getIssueTypeFields: returns fields incl. custom fields", async () => {
        const types = await adapter.getIssueTypes(PROJECT_KEY!);
        const task = types.find((t) => t.name === "Task")!;
        const fields = await adapter.getIssueTypeFields(
          PROJECT_KEY!,
          task.id
        );
        expect(fields.length).toBeGreaterThan(0);
        // Should include the user-picker custom field.
        expect(
          fields.some(
            (f: any) =>
              f.key?.startsWith("customfield_") &&
              f.schema?.type === "user"
          )
        ).toBe(true);
      });

      // #5b — Write a user-picker custom field (worklist #7, D1 userRef).
      // Test #5 proves the sandbox has one configured but never writes to
      // it; this closes that gap. If mapCustomFieldUserRefs sent the wrong
      // shape ({ accountId } instead of { name } on DC), Jira rejects the
      // write and createIssue throws before the assertions below run.
      it("#5b createIssue: writes a user-picker custom field ({accountId} -> {name} on DC)", async () => {
        const types = await adapter.getIssueTypes(PROJECT_KEY!);
        const task = types.find((t) => t.name === "Task")!;
        const fields = await adapter.getIssueTypeFields(
          PROJECT_KEY!,
          task.id
        );
        const userField = fields.find(
          (f: any) =>
            f.key?.startsWith("customfield_") && f.schema?.type === "user"
        );
        expect(userField).toBeDefined();

        const me = await adapter.getCurrentUser();
        expect(me).not.toBeNull();

        const issue = await adapter.createIssue({
          title: "IT contract: user-picker custom field",
          projectId: PROJECT_KEY!,
          issueType: task.id,
          customFields: { [userField!.key]: { accountId: me!.accountId } },
        });
        createdKeys.push(issue.key);

        // Read the field back directly — adapter.getIssue()'s fixed field
        // list doesn't request custom fields, so bypass it here.
        const headers = headersForScheme(scheme);
        const raw = await fetch(
          `${BASE_URL}/rest/api/2/issue/${issue.key}?fields=${userField!.key}`,
          { headers }
        );
        const rawBody = await raw.json();
        expect(rawBody.fields?.[userField!.key]).toBeTruthy();
      });

      // #6 — Create issue with a plain-text description (DC: string, NOT ADF)
      it("#6 createIssue: creates with a plain-text description (not ADF)", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: create plain",
          projectId: PROJECT_KEY!,
          issueType: "3", // Task
          description: "plain string body from contract suite",
        });
        expect(issue.key).toBeDefined();
        expect(issue.key).toMatch(new RegExp(`^${PROJECT_KEY}-`));
        createdKeys.push(issue.key);
        // Description should round-trip as readable text.
        expect(issue.description).toContain("plain string body");
      });

      // #6b — Adapter converts ADF to plain string for DC (not rejected)
      it("#6b createIssue: ADF description is converted to plain string on DC", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: ADF->string conversion",
          projectId: PROJECT_KEY!,
          issueType: "3",
          description: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "ADF body" }],
              },
            ],
          } as any,
        });
        expect(issue.key).toBeDefined();
        createdKeys.push(issue.key);
        // Description should round-trip as readable text extracted from ADF.
        expect(issue.description).toContain("ADF body");
      });

      // #7 — getIssue maps DC user fields by name/key
      it("#7 getIssue: maps assignee/reporter by name (not accountId)", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: getIssue",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(issue.key);
        const fetched = await adapter.getIssue(issue.key);
        expect(fetched.title).toBe("IT contract: getIssue");
        // Reporter must be present; on DC it maps to name/key.
        expect(fetched.reporter).toBeDefined();
        expect(fetched.reporter?.name).toBeTruthy();
      });

      // #8 — addComment with plain string (DC: string, NOT ADF)
      it("#8 addComment: plain-string comment is accepted", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: comment",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(issue.key);
        // addComment is protected on the adapter; drive it via the
        // IssueAdapter interface path through updateIssue? It's not on the
        // public interface. We call it via any-cast for the contract test.
        await (adapter as any).addComment(issue.key, "contract comment");
        const comments = await adapter.getIssueComments(issue.key);
        expect(comments.some((c) => c.body.includes("contract comment"))).toBe(true);
      });

      // #9 — Transitions
      it("#9 transitions: executes a transition and reverts it", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: transition",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(issue.key);

        const headers = headersForScheme(scheme);
        const before = await adapter.getIssue(issue.key);
        const originalStatus = before.status;

        // transitionIssue() is private; the public path is updateIssue with
        // a target status name. Discover an actual available transition via
        // the raw REST endpoint rather than guessing a status name.
        const transitionsResp = await fetch(
          `${BASE_URL}/rest/api/2/issue/${issue.key}/transitions`,
          { headers }
        );
        const { transitions } = await transitionsResp.json();
        const forward = (transitions || []).find(
          (t: any) => t.to?.name && t.to.name !== originalStatus
        );
        expect(forward).toBeDefined();

        await adapter.updateIssue(issue.key, { status: forward.to.name });
        const afterForward = await adapter.getIssue(issue.key);
        expect(afterForward.status).toBe(forward.to.name);

        // Best-effort revert — not every workflow has a transition straight
        // back to the original status, so this doesn't assert.
        const backResp = await fetch(
          `${BASE_URL}/rest/api/2/issue/${issue.key}/transitions`,
          { headers }
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

      // #10 — Search with startAt pagination (DC: startAt/total, NOT nextPageToken)
      it("#10 searchIssues: returns issues with startAt/total pagination", async () => {
        const issue = await adapter.createIssue({
          title: "IT contract: search",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(issue.key);
        const res = await adapter.searchIssues({
          projectId: PROJECT_KEY,
          limit: 50,
        });
        expect(res.issues.length).toBeGreaterThan(0);
        // hasMore must be computable from startAt+issues.length < total.
        expect(typeof res.hasMore).toBe("boolean");
        expect(typeof res.total).toBe("number");
      });

      // #10b — Pagination cursor (worklist #8): DC's classic /search has no
      // cursor of its own, so the adapter must synthesize a nextPageToken
      // from startAt, or SyncService.performProjectImport can never advance
      // past page 1 (see JiraAdapter.searchIssues and the unit tests in
      // JiraAdapter.test.ts for the mocked version of this regression).
      it("#10b searchIssues: nextPageToken advances past page 1", async () => {
        const a = await adapter.createIssue({
          title: "IT contract: page 1",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(a.key);
        const b = await adapter.createIssue({
          title: "IT contract: page 2",
          projectId: PROJECT_KEY!,
          issueType: "3",
        });
        createdKeys.push(b.key);

        const page1 = await adapter.searchIssues({
          projectId: PROJECT_KEY,
          limit: 1,
        });
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

      // #11 — User search (DC: ?username=, NOT ?query=)
      it("#11 searchUsers: finds a user by username param", async () => {
        const res: any = await (adapter as any).searchUsers?.("testplanit");
        const users = Array.isArray(res) ? res : res?.users;
        expect(users?.length).toBeGreaterThan(0);
        expect(users?.[0]?.displayName).toBeTruthy();
      });

      // #12 — Issue picker (route probe endpoint) exists on v2
      it("#12 /issue/picker: endpoint is reachable on v2", async () => {
        const resp = await fetch(
          `${BASE_URL}/rest/api/2/issue/picker?currentJQL=&showSubTasks=false&showSubTaskParent=false`,
          {
            headers: PAT
              ? { Authorization: `Bearer ${PAT}` }
              : {
                  Authorization: `Basic ${Buffer.from(
                    `${USERNAME}:${PASSWORD}`
                  ).toString("base64")}`,
                },
          }
        );
        expect(resp.ok).toBe(true);
      });
    });
  }
});
