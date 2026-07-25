# Jira Data Center Plugin MVP — Design

**Date:** 2026-07-11
**Status:** Approved
**Target:** Jira Data Center 10.3 LTS (verified against 10.3.13)

## Goal

Give Jira Data Center users the same read-only TestPlanIt issue panel that Jira Cloud
users get from the Forge app: linked test cases, test runs, and exploratory sessions
with statuses, expandable rows, and click-through links into TestPlanIt. Plus an admin
settings page (instance URL + API key + Test Connection) inside Jira administration.

The TestPlanIt backend is **not modified**. The plugin talks to the existing
integration endpoints using the existing `X-Forge-Api-Key` authentication:

- `GET {instance}/version.json` — reachability check
- `GET {instance}/api/integrations/jira/test-connection` — API key validation
- `GET {instance}/api/integrations/jira/test-info?issueKey=&issueId=` — panel data

## Out of scope (MVP)

- AI test-case generation, import, and generate-token flows (`GenerateTestCasesFlow`).
  Planned for a later iteration; this design keeps that port cheap (see Bridge).
- Atlassian Marketplace listing / Data Center approval. Distribution is a JAR
  installed via UPM.
- Jira 9.x support. Target is Jira 10.3 LTS only (Platform 7, jakarta namespace).
- Localizing the React panel strings. The shared React UI stays English (parity with
  the Forge app today); plugin-level strings (panel title, admin page chrome) ship
  as i18n `.properties` in English and Russian.

## Decisions already made

| Decision | Choice |
|---|---|
| Approach | Native P2 plugin + reuse of the React panel (approach A; velocity-only and iframe approaches rejected) |
| Plugin language | Java 17 (Jira 10.3 runtime; no Kotlin) |
| Dev loop | Local `atlas-run` instance; final verification by installing the JAR on jira.rapidsoft.ru (Jira DC 10.3.13) |
| Future AI port | Planned — architecture must keep it cheap |
| Backend changes | None |

### Why approach A

- Velocity/AUI rewrite (approach B) would require rewriting the panel UI now and the
  AI flow later — a dead end given "AI planned later".
- Thin plugin + iframe hosted by TestPlanIt (approach C) requires backend changes
  (panel page, token handshake, frame-ancestors CSP), losing the "zero backend
  changes" property.
- Approach A is the only one that simultaneously: keeps the backend untouched, gives
  UI parity with Cloud, and leaves a cheap path for the AI flow (implement three more
  bridge methods; the generation streaming already goes browser → TestPlanIt
  directly and needs no plugin involvement).

## Repository layout

```
jira-dc-plugin/                  # new top-level directory (sibling of forge-app)
├── pom.xml                      # AMPS (jira-maven-plugin), Jira 10.3.13, Java 17
├── src/main/java/io/testplanit/jira/
│   ├── rest/                    # JAX-RS resources: PanelResource, SettingsResource
│   ├── settings/                # PluginSettings-backed settings service
│   ├── client/                  # HTTP client for TestPlanIt (java.net.http)
│   └── web/                     # web-panel context provider, admin servlet
├── src/main/resources/
│   ├── atlassian-plugin.xml
│   ├── i18n/testplanit.properties, testplanit_ru.properties
│   ├── templates/               # velocity: panel container, admin page shell
│   └── frontend/                # built JS/CSS bundles (gitignored)
└── frontend/                    # pnpm workspace package: DC bridge, entries, webpack

packages/jira-panel-ui/          # new shared pnpm package: React panel components
                                 # extracted from forge-app/src/frontend/app.jsx
```

Workspace changes: add `jira-dc-plugin/frontend` to `pnpm-workspace.yaml`
(`packages/*` already covers `jira-panel-ui`). The Maven project itself is not a pnpm
package.

### Shared package extraction

`forge-app/src/frontend/app.jsx` (1835 lines) is split. Moving to
`packages/jira-panel-ui`: `StatusBadge`, `DynamicIcon`, `TestCaseRow`, `SessionRow`,
`TestRunRow`, `flattenFolders`, `formatDuration`, `formatElapsedTime`, `app.css`, and
a React context that carries the bridge. Staying in forge-app:
`GenerateTestCasesFlow` and Forge entry points. The Forge app's behavior must not
change — same bundles, same UX.

## Plugin modules (atlassian-plugin.xml)

- **web-panel** at `atl.jira.view.issue.right.context`: velocity template renders
  `<div id="testplanit-panel" data-issue-key="…" data-issue-id="…">` and pulls in the
  panel web-resource. The panel is always visible (parity with Forge); the frontend
  renders a "not configured" state when setup is missing.
- **rest** module at `/rest/testplanit/1.0`:

  | Endpoint | Access | Behavior |
  |---|---|---|
  | `GET /panel?issueKey=&issueId=` | logged-in user with BROWSE permission on the issue (via `PermissionManager`); nonexistent or non-browsable issue → 404 (existence not leaked) | proxy to `test-info` |
  | `GET /settings` | Jira admin (`ADMINISTER`) | returns `{instanceUrl, apiKeySet}` — the key itself is never returned |
  | `PUT /settings` | Jira admin | saves URL; saves key only when provided non-empty |
  | `POST /settings/test` | Jira admin | proxies `version.json` + `test-connection` with the submitted values |
  | `DELETE /settings` | Jira admin | clears both values |

- **web-item + servlet** under the standard plugin-configuration admin section
  (`admin_plugins_menu`): page shell with a root div loading the settings entry of
  the same bundle (mirrors the Forge webpack multi-entry setup).
- **web-resource**: built JS/CSS; panel resources scoped to the issue-view context.
- **i18n**: `testplanit.properties` + `testplanit_ru.properties` for plugin-level
  strings (panel title, admin item/page titles).

Settings storage: `PluginSettingsFactory` global settings, keys
`io.testplanit.jira:instanceUrl` and `io.testplanit.jira:apiKey` — the direct
equivalent of the Forge KVS usage.

## Frontend bridge

Bridge contract (React context provided by `jira-panel-ui`):

```
getTestInfo(): Promise<TestInfo>     // panel data
openUrl(url): void                   // open TestPlanIt in a new tab/window
getIssueContext(): { issueKey, issueId }
getTheme(): 'light' | 'dark'
```

- **Forge implementation** (in forge-app, unchanged behavior): `invoke('getTestInfo')`,
  `router.open()`, `view.getContext()`, Forge theme events.
- **DC implementation** (in `jira-dc-plugin/frontend`):
  `fetch(AJS.contextPath() + '/rest/testplanit/1.0/panel?…')`, `window.open()`,
  issue key/id from the container div's data attributes, theme from the document's
  `data-color-mode` attribute. Dark theme is best-effort; light theme must match
  Cloud rendering.

Future AI port = move `GenerateTestCasesFlow` into the shared package and add three
bridge methods (`getGenerationContext`, `importTestCases`, `getGenerateToken`). The
LLM streaming already goes directly browser → TestPlanIt with a short-lived token and
`Access-Control-Allow-Origin: *` on the TestPlanIt side, so it works from a DC page
without plugin changes.

## Security

- Panel REST requires an authenticated user **and** issue BROWSE permission —
  stricter than the Forge resolver (which accepted any issueKey from any panel call).
- Settings REST requires `ADMINISTER`.
- The API key is stored in PluginSettings as plaintext (parity with Forge KVS;
  standard DC practice for server-to-server keys) and is never returned by REST.
- Outbound requests honor JVM proxy settings (`ProxySelector.getDefault()`), use a
  10-second timeout (matching `SERVER_INFO_TIMEOUT_MS` in the main app), and only
  ever target the admin-configured instance URL.
- No new headers or auth models on the TestPlanIt side; the plugin sends
  `X-Forge-Api-Key` exactly like the Forge resolver does. The read-only panel flow
  does not forward user identity (the Forge `getTestInfo` doesn't either).

## Build

Two-step, no node-in-Maven coupling for MVP:

1. `pnpm --filter @testplanit/jira-dc-frontend build` (the package in
   `jira-dc-plugin/frontend/`) → webpack emits bundles into
   `jira-dc-plugin/src/main/resources/frontend/` (gitignored).
2. `mvn package` (or `atlas-package`) in `jira-dc-plugin/` → plugin JAR.

A root-level npm script `build:jira-dc` chains both. CI gets a job that runs the
chain and the Java + frontend tests. Dev loop: `atlas-run` for a local Jira 10.3
with a timebomb license; reinstall via UPM or QuickReload.

## Error handling (panel parity with Forge)

| Condition | Panel behavior |
|---|---|
| Not configured | setup hint with steps (admin-oriented) |
| TestPlanIt unreachable / 5xx | human-readable error + retry button |
| 401/403 from TestPlanIt | "API key invalid — contact your Jira admin" |
| No linked data | empty state inviting the user to link from TestPlanIt |
| Plugin REST 401 (session expired) / 404 (issue not visible) | error state; no data leak |

Settings page: URL validation before save (http/https, parseable), test-connection
result shown verbatim (success message includes the TestPlanIt version, mirroring
Forge).

## Testing

- **Java (JUnit 5)**: settings service round-trip; REST guards (anonymous → 401,
  non-admin on settings → 403, no BROWSE on issue → 404); TestPlanIt client
  against a mock HTTP server (WireMock) including timeout and non-2xx paths.
- **Frontend**: `jira-panel-ui` component tests with the repo's existing framework
  (vitest); smoke tests for both bridge implementations (Forge bridge mocked, DC
  bridge against a stubbed `fetch`).
- **Manual**: checklist on `atlas-run` (configure → panel states → links → error
  states), then final install of the JAR on jira.rapidsoft.ru (10.3.13) against a
  real TestPlanIt instance.

## Success criteria

1. The JAR installs via UPM on Jira DC 10.3 with no errors in `atlassian-jira.log`.
2. An admin configures URL + key; Test Connection succeeds against a real instance.
3. On an issue with linked cases/runs/sessions the panel shows the same data as the
   Cloud version; links open TestPlanIt in a new tab.
4. forge-app builds and behaves exactly as before the shared-package extraction.
5. Java and frontend unit tests pass locally and in CI.
