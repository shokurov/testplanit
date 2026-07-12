# TestPlanIt for Jira Data Center

A P2 plugin for Jira Data Center 10.3 LTS that shows TestPlanIt test cases,
test runs, and exploratory sessions on Jira issues, plus an admin settings
page. The Data Center counterpart of the Forge app in `../forge-app`.

## Requirements

- Jira Data Center 10.3.x (Platform 7)
- JDK 21 to build (bytecode targets Java 17 for the Jira 10.3 runtime),
  Maven 3.9+, pnpm (repo workspace)
- A TestPlanIt instance with a Jira integration API key
  (TestPlanIt: Admin > Integrations > Jira > generate API key)

## Build

    pnpm install
    pnpm run build:jira-dc        # from the repo root

The JAR lands in `target/testplanit-jira-dc-<version>.jar`.
Frontend bundles are built into `src/main/resources/frontend/` (gitignored)
by `frontend/` (webpack) and must exist before `mvn package` — the root
script handles the ordering.

`JAVA_HOME` must point at a JDK 21 (with Maven on `PATH`) to build:
`atlassian-spring-scanner-maven-plugin` 6.0.2 is compiled for Java 21 and a
JDK-17 Maven fails its goal with `UnsupportedClassVersionError`. This only
affects the *build*; the plugin's own bytecode still targets Java 17
(`maven.compiler.release=17` in `pom.xml`), which is what the Jira 10.3
runtime actually loads.

## Run a dev Jira

    mvn -f pom.xml com.atlassian.maven.plugins:jira-maven-plugin:9.12.5:run

First boot downloads Jira 10.3.13 and starts it on
http://localhost:2990/jira (admin/admin, timebomb license). QuickReload is
enabled: re-run `pnpm run build:jira-dc` and the rebuilt JAR is picked up.

Note: unlike `mvn package`, `jira:run` additionally needs the legacy
`javax.transaction:jta:1.0.1B` artifact, which 404s from Maven Central,
packages.atlassian.com, and repo.jenkins-ci.org — it's only available from
the Atlassian Plugin SDK's seeded local Maven repository. To boot a local
dev instance, either install the
[Atlassian Plugin SDK](https://developer.atlassian.com/server/framework/atlassian-sdk/)
(which seeds that repo for you) or otherwise place `jta:1.0.1B` in your
local `~/.m2` yourself. Building the JAR and running the Java/frontend unit
tests (`mvn package`, `pnpm run build:jira-dc`) do not need it — only
`jira:run` does. Absent a local dev instance, runtime behavior is verified
by installing the built JAR on a real Jira 10.3 instance (see below).

## Install on a real instance

Administration > Manage apps > Upload app > select the JAR. Then open
**TestPlanIt Settings** in the admin sidebar, enter the TestPlanIt instance
URL and API key, and use **Test Connection** before saving.

## Architecture

- `src/main/java/io/testplanit/jira/` — REST resources (`/rest/testplanit/1.0`),
  PluginSettings-backed settings service, TestPlanIt HTTP client, admin servlet.
- `frontend/` — React bundles reusing `@testplanit/jira-panel-ui` (shared with
  the Forge app) through a small bridge abstraction (`src/dcBridge.js`).
- The plugin talks to TestPlanIt with the same API key header and endpoints as
  the Forge app; no TestPlanIt backend changes are required.
