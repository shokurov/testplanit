# Jira Data Center Plugin MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A P2 plugin for Jira DC 10.3 that shows the TestPlanIt read-only issue panel and an admin settings page, reusing the Forge app's React panel via a new shared package, with zero TestPlanIt backend changes.

**Architecture:** Java 17 plugin (AMPS/jira-maven-plugin) exposing `/rest/testplanit/1.0` endpoints that proxy the existing TestPlanIt integration API with `X-Forge-Api-Key`; a web-panel renders a container div hydrated by a React bundle built from `packages/jira-panel-ui` (components extracted from `forge-app/src/frontend/app.jsx`) behind a small "bridge" abstraction with Forge and DC implementations.

**Tech Stack:** Java 17, AMPS (jira-maven-plugin) 9.12.5, platform-public-api 7.0.10 BOM, jakarta.ws.rs (REST v2), atlassian-spring-scanner **5.0.2** (MUST match the platform's runtime scanner — see the constraint below), SAL PluginSettings, JUnit 5 + Mockito; React 19, webpack 5, Babel, Tailwind 4, vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-07-11-jira-dc-plugin-mvp-design.md`

## Global Constraints

- Target **Jira DC 10.3 LTS only** (verify against 10.3.13). REST v2.
- **CORRECTION (verified empirically during Task 1 — supersedes earlier drafts):** On Platform 7 / Jira 10.3, Maven dependency **coordinates** are `jakarta.*` (`jakarta.ws.rs:jakarta.ws.rs-api:2.1.6`, `jakarta.servlet:jakarta.servlet-api:4.0.4`, `jakarta.inject:jakarta.inject-api:1.0.5`) but the Java **packages inside them are still `javax.*`** (`javax.ws.rs`, `javax.servlet`, `javax.inject`). All Java `import` statements use **`javax.*`**; the `jakarta.*` groupIds stay in the POM. (The package rename to `jakarta.*` lands in a later platform, not 10.3.) Atlassian REST security annotations `com.atlassian.annotations.security.*` (`UnrestrictedAccess`, `LicensedOnly`, `AdminOnly`) are confirmed present and used as-is.
- **spring-scanner MUST match the platform runtime = 5.0.2.** Platform 7.0.10 (Jira 10.3) ships spring-scanner runtime **5.0.2** (`platform-deps-7.0.10.pom`); pin `atlassian-spring-scanner-annotation` and `-maven-plugin` to 5.0.2. Using a newer scanner (6.x) is the trap that cost us a live-instance debug cycle: 6.0.2's maven-plugin needs JDK 21 to run AND emits a `META-INF/plugin-components/` index **missing the `component` file**, so the `@Named` beans are never registered, the REST/servlet modules that inject them fail to construct, and the plugin installs but shows **"0 of N modules enabled"**. 5.0.2 emits the correct `component` index and builds on plain **JDK 17** (the Jira 10.3 runtime Java).
- **Java: build and runtime are both Java 17** (`maven.compiler.release=17`). With scanner 5.0.2 no newer JDK is needed for the build.
- **Jira 10.3 BOM needs the Jenkins repo.** `jira-bom` pins `commons-httpclient:3.1-jenkins-3`, hosted only at `https://repo.jenkins-ci.org/public/`. The POM must declare that repository (provided-scope transitive; Jira supplies it at runtime, this plugin never compiles against it).
- **Any `class="..."` attribute in `atlassian-plugin.xml` pointing at a platform (non-`io.testplanit`) class needs its package explicitly listed in the POM's bnd `Import-Package` instructions.** `bnd`'s automatic `Import-Package: *` only scans compiled `.class` bytecode for import statements — an XML string like `<condition class="com.atlassian.jira.plugin.webfragment.conditions.UserLoggedInCondition"/>` is invisible to it. Confirmed live on Jira 10.3.13: omitting this produced `ClassNotFoundException` at module-enable time, and one bad module descriptor disabled the *entire* plugin ("0 of N modules enabled"), not just the module that used the condition.
- **Every class with an `@Inject`-annotated constructor MUST also carry `@Named` on the class, with NO exceptions for module type** — `@Inject` alone is never sufficient; `atlassian-spring-scanner` only generates the `<component-import>` wiring a class's `@ComponentImport` parameters need when the class *itself* is registered as a Spring bean (`@Named`). This applies uniformly whether the class backs a `<rest>` `@Path` resource (constructed via Jersey/HK2, `org.glassfish.hk2` — a DI container entirely separate from the plugin's own Spring context, confirmed via `UnsatisfiedDependencyException`/`org.glassfish.hk2.api...` for `PanelResource`/`SettingsResource`) or a `<servlet>` (constructed via Spring's own generic `createBean()`, through `DefaultSpringContainerAccessor` → `ClassPrefixModuleFactory`, confirmed via `NoSuchBeanDefinitionException`/`org.springframework.beans.factory...` for `AdminServlet`) — two different injection containers, same missing-`@Named` root cause, same fix. A zero-dependency class (like `PingResource`) is unaffected and can mislead you into thinking the wiring is fine — it proves nothing about classes that actually have injected constructor parameters.
  **Trap encountered live:** an early probe of `AdminServlet`'s URL using a limited service account (no Jira product/application access) returned an HTTP 302 redirect to `/login.jsp?permissionViolation=true`, which was misread as "the servlet's own `doGet()` ran and correctly rejected a non-admin" — proof, it seemed, that servlet DI was fine without `@Named`. It wasn't: that redirect is Jira's own Seraph security filter blocking the request *before* the plugin framework ever attempts to instantiate the servlet, so the probe never exercised the servlet's DI at all. Only a real, fully-licensed admin session reaches the point where Spring tries to construct `AdminServlet` — and that's where it failed. **Lesson: a probe from a restricted/limited-permission account can pass clean through a code path it never actually reached; don't treat that as confirmation.**
- **Zero TestPlanIt backend changes.** The plugin calls only: `GET {instance}/version.json`, `GET {instance}/api/integrations/jira/test-connection`, `GET {instance}/api/integrations/jira/test-info?issueKey=&issueId=` — all authenticated with the `X-Forge-Api-Key` header.
- **forge-app behavior must not change** after the shared-package extraction (same bundles, same UX).
- Plugin key everywhere: `io.testplanit.testplanit-jira-dc`. Java base package: `io.testplanit.jira`. PluginSettings keys: `io.testplanit.jira:instanceUrl`, `io.testplanit.jira:apiKey`.
- REST: settings endpoints require Jira **ADMINISTER** permission; panel endpoint requires logged-in user + **BROWSE** on the issue; nonexistent or non-browsable issue → **404** (existence not leaked). The stored API key is **never** returned by any endpoint.
- Outbound HTTP: 10-second timeouts, default JVM proxy selector, only ever the admin-configured instance URL.
- i18n `.properties` in **en + ru** for plugin-level strings; React UI strings stay English (Forge parity).
- Commit after every task (feature branch `feature/jira-dc-plugin`).
- All shell commands below are PowerShell, run from the repo root `C:\Work\open-source\github\shokurov\testplanit` unless a `-f`/`cd` says otherwise.

---

### Task 1: Plugin skeleton that builds, installs, and answers a ping

The riskiest assumptions (AMPS 9.12.5 + Jira 10.3.13, platform BOM, REST v2 annotation scanning, spring-scanner 5.0.2 matching the platform runtime) are validated here before any real code.

**Files:**
- Create: `jira-dc-plugin/pom.xml`
- Create: `jira-dc-plugin/.gitignore`
- Create: `jira-dc-plugin/src/main/resources/atlassian-plugin.xml`
- Create: `jira-dc-plugin/src/main/resources/i18n/testplanit.properties`
- Create: `jira-dc-plugin/src/main/resources/i18n/testplanit_ru.properties`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/rest/PingResource.java`

**Interfaces:**
- Produces: Maven module `io.testplanit:testplanit-jira-dc` with packaging `atlassian-plugin`; `mvn package` emits `jira-dc-plugin/target/testplanit-jira-dc-0.1.0-SNAPSHOT.jar`. REST base path for all later resources: `/rest/testplanit/1.0`.

- [ ] **Step 1: Verify toolchain**

Run: `java -version; mvn -version`
Expected: **JDK 17** (Temurin or similar) and Maven **3.9+**, both on PATH; `mvn -version` must report "Java version: 17". With spring-scanner pinned to 5.0.2, JDK 17 (the Jira 10.3 runtime Java) builds everything — no newer JDK needed.
If missing: install a JDK 17 (`winget install EclipseAdoptium.Temurin.17.JDK`, or a portable Temurin 17 unzipped with `JAVA_HOME` pointed at it) and Maven (`winget install Apache.Maven`, or a portable `apache-maven-3.9.x` on PATH). Set `JAVA_HOME` to the JDK 17 for every Maven invocation in this plan.

- [ ] **Step 2: Create `jira-dc-plugin/.gitignore`**

```gitignore
target/
src/main/resources/frontend/
.classpath
.project
.settings/
```

- [ ] **Step 3: Create `jira-dc-plugin/pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>io.testplanit</groupId>
  <artifactId>testplanit-jira-dc</artifactId>
  <version>0.1.0-SNAPSHOT</version>
  <packaging>atlassian-plugin</packaging>

  <name>TestPlanIt for Jira Data Center</name>
  <description>Shows TestPlanIt test cases, runs, and sessions on Jira issues.</description>

  <properties>
    <jira.version>10.3.13</jira.version>
    <platform.version>7.0.10</platform.version>
    <amps.version>9.12.5</amps.version>
    <!-- MUST match the platform runtime (platform 7.0.10 / Jira 10.3 ships 5.0.2).
         A newer scanner (6.x) builds but emits an index the runtime can't read
         → plugin installs yet 0 of N modules enable. -->
    <spring.scanner.version>5.0.2</spring.scanner.version>
    <atlassian.plugin.key>io.testplanit.testplanit-jira-dc</atlassian.plugin.key>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.atlassian.platform.dependencies</groupId>
        <artifactId>platform-public-api</artifactId>
        <version>${platform.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>com.atlassian.jira</groupId>
      <artifactId>jira-api</artifactId>
      <version>${jira.version}</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.atlassian.plugins.rest</groupId>
      <artifactId>atlassian-rest-v2-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>jakarta.ws.rs</groupId>
      <artifactId>jakarta.ws.rs-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>jakarta.servlet</groupId>
      <artifactId>jakarta.servlet-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>jakarta.inject</groupId>
      <artifactId>jakarta.inject-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.atlassian.sal</groupId>
      <artifactId>sal-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.atlassian.templaterenderer</groupId>
      <artifactId>atlassian-template-renderer-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.atlassian.plugin</groupId>
      <artifactId>atlassian-spring-scanner-annotation</artifactId>
      <version>${spring.scanner.version}</version>
      <scope>provided</scope>
    </dependency>

    <!-- Tests -->
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.4</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>5.15.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-junit-jupiter</artifactId>
      <version>5.15.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.assertj</groupId>
      <artifactId>assertj-core</artifactId>
      <version>3.27.3</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>com.atlassian.maven.plugins</groupId>
        <artifactId>jira-maven-plugin</artifactId>
        <version>${amps.version}</version>
        <extensions>true</extensions>
        <configuration>
          <productVersion>${jira.version}</productVersion>
          <productDataVersion>${jira.version}</productDataVersion>
          <enableQuickReload>true</enableQuickReload>
          <instructions>
            <Atlassian-Plugin-Key>${atlassian.plugin.key}</Atlassian-Plugin-Key>
            <Export-Package/>
            <Import-Package>
              org.springframework.osgi.*;resolution:="optional",
              org.eclipse.gemini.blueprint.*;resolution:="optional",
              *
            </Import-Package>
            <Spring-Context>*</Spring-Context>
          </instructions>
        </configuration>
      </plugin>
      <plugin>
        <groupId>com.atlassian.plugin</groupId>
        <artifactId>atlassian-spring-scanner-maven-plugin</artifactId>
        <version>${spring.scanner.version}</version>
        <executions>
          <execution>
            <goals>
              <goal>atlassian-spring-scanner</goal>
            </goals>
            <phase>process-classes</phase>
          </execution>
        </executions>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
    </plugins>
  </build>

  <repositories>
    <repository>
      <id>atlassian-public</id>
      <url>https://packages.atlassian.com/mvn/maven-external/</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </repository>
    <!-- Jira 10.3's jira-bom pins commons-httpclient:3.1-jenkins-3, published
         ONLY here (not mirrored by Atlassian). Provided-scope transitive of
         jira-api; Jira supplies it at runtime, this plugin never compiles
         against it, but Maven must still resolve the dependency graph. -->
    <repository>
      <id>jenkins-public</id>
      <url>https://repo.jenkins-ci.org/public/</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </repository>
  </repositories>
  <pluginRepositories>
    <pluginRepository>
      <id>atlassian-public</id>
      <url>https://packages.atlassian.com/mvn/maven-external/</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </pluginRepository>
  </pluginRepositories>
</project>
```

- [ ] **Step 4: Create `jira-dc-plugin/src/main/resources/atlassian-plugin.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<atlassian-plugin key="io.testplanit.testplanit-jira-dc" name="TestPlanIt for Jira Data Center" plugins-version="2">
  <plugin-info>
    <description>Shows TestPlanIt test cases, runs, and sessions on Jira issues.</description>
    <version>${project.version}</version>
    <vendor name="TestPlanIt" url="https://testplanit.com"/>
    <param name="atlassian-data-center-status">compatible</param>
    <param name="atlassian-data-center-compatible">true</param>
  </plugin-info>

  <resource type="i18n" name="i18n" location="i18n.testplanit"/>

  <rest key="testplanit-rest" path="/testplanit" version="1.0">
    <description>TestPlanIt REST endpoints (panel data proxy and settings).</description>
  </rest>
</atlassian-plugin>
```

- [ ] **Step 5: Create the i18n properties (en + ru skeleton)**

`jira-dc-plugin/src/main/resources/i18n/testplanit.properties`:

```properties
testplanit.panel.title=TestPlanIt
testplanit.admin.section=TestPlanIt
testplanit.admin.title=TestPlanIt Settings
```

`jira-dc-plugin/src/main/resources/i18n/testplanit_ru.properties` (file must be saved as UTF-8; Jira 10 reads properties as UTF-8):

```properties
testplanit.panel.title=TestPlanIt
testplanit.admin.section=TestPlanIt
testplanit.admin.title=Настройки TestPlanIt
```

- [ ] **Step 6: Create `PingResource.java`**

`jira-dc-plugin/src/main/java/io/testplanit/jira/rest/PingResource.java`:

```java
package io.testplanit.jira.rest;

import com.atlassian.annotations.security.UnrestrictedAccess;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.util.Map;

@Path("/ping")
@UnrestrictedAccess
public class PingResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response ping() {
        return Response.ok(Map.of("status", "ok")).build();
    }
}
```

Platform 7 note: REST v2 resources **must** carry a security annotation from `com.atlassian.annotations.security` (they are rejected otherwise). If `@UnrestrictedAccess` does not resolve, list what this Jira version offers and pick the anonymous-allowing one:

```powershell
cd jira-dc-plugin
mvn dependency:build-classpath "-Dmdep.outputFile=target/cp.txt" -q
# then inspect the atlassian-annotations jar on that classpath:
# jar -tf <path-to-atlassian-annotations-*.jar> | Select-String "security"
```

- [ ] **Step 7: Build**

Run: `mvn -f jira-dc-plugin/pom.xml package`
Expected: `BUILD SUCCESS`; `jira-dc-plugin/target/testplanit-jira-dc-0.1.0-SNAPSHOT.jar` exists. First run downloads a lot from the Atlassian repo — minutes, not seconds.

- [ ] **Step 8: Smoke-run a local Jira and hit the ping**

Run: `mvn -f jira-dc-plugin/pom.xml com.atlassian.maven.plugins:jira-maven-plugin:9.12.5:run`
Expected: first boot downloads Jira 10.3.13 (~2 GB, 10–20 min) and starts it at `http://localhost:2990/jira` with an auto-generated timebomb license and admin account `admin`/`admin`. Wait for `jira started successfully` in the console.

Then in a second shell:

```powershell
Invoke-RestMethod http://localhost:2990/jira/rest/testplanit/1.0/ping
```

Expected: `status : ok`.
If the resource 404s: check `atlassian-jira.log` for the plugin enable message; the usual culprits are the REST security annotation (Step 6 note) or spring-scanner not running (verify `target/classes/META-INF/plugin-components/` is non-empty after `mvn package`).

Keep the Jira instance running for later tasks if RAM allows (QuickReload picks up rebuilt JARs); otherwise Ctrl+C — Task 9 boots it again.

- [ ] **Step 9: Commit**

```powershell
git add jira-dc-plugin
git commit -m "feat(jira-dc): plugin skeleton — AMPS build, REST v2 ping"
```

---

### Task 2: Settings service (PluginSettings) — TDD

**Files:**
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/settings/TestPlanItSettingsService.java`
- Test: `jira-dc-plugin/src/test/java/io/testplanit/jira/settings/TestPlanItSettingsServiceTest.java`

**Interfaces:**
- Consumes: `com.atlassian.sal.api.pluginsettings.PluginSettingsFactory` (host component).
- Produces (used by Tasks 4–5):
  - `String getInstanceUrl()` — normalized URL or `null`
  - `String getApiKey()` — key or `null`
  - `boolean isConfigured()` — both values present
  - `void save(String instanceUrl, String apiKeyOrNull)` — normalizes/validates URL, stores it; stores the key only when non-blank (blank/null keeps the existing key)
  - `void clear()` — removes both
  - `static String normalizeInstanceUrl(String raw)` — trims, requires parseable http/https URL, strips trailing slashes; throws `IllegalArgumentException("Invalid URL format")` otherwise

- [ ] **Step 1: Write the failing tests**

`jira-dc-plugin/src/test/java/io/testplanit/jira/settings/TestPlanItSettingsServiceTest.java`:

```java
package io.testplanit.jira.settings;

import com.atlassian.sal.api.pluginsettings.PluginSettings;
import com.atlassian.sal.api.pluginsettings.PluginSettingsFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;

class TestPlanItSettingsServiceTest {

    private final Map<String, Object> store = new HashMap<>();
    private TestPlanItSettingsService service;

    @BeforeEach
    void setUp() {
        PluginSettings settings = mock(PluginSettings.class);
        when(settings.get(anyString())).thenAnswer(inv -> store.get(inv.getArgument(0, String.class)));
        doAnswer(inv -> store.put(inv.getArgument(0), inv.getArgument(1)))
                .when(settings).put(anyString(), org.mockito.ArgumentMatchers.any());
        doAnswer(inv -> store.remove(inv.getArgument(0, String.class)))
                .when(settings).remove(anyString());

        PluginSettingsFactory factory = mock(PluginSettingsFactory.class);
        when(factory.createGlobalSettings()).thenReturn(settings);
        service = new TestPlanItSettingsService(factory);
    }

    @Test
    void unconfiguredByDefault() {
        assertThat(service.getInstanceUrl()).isNull();
        assertThat(service.getApiKey()).isNull();
        assertThat(service.isConfigured()).isFalse();
    }

    @Test
    void saveNormalizesUrlAndStoresKey() {
        service.save("https://qa.example.com//", "secret-key");
        assertThat(service.getInstanceUrl()).isEqualTo("https://qa.example.com");
        assertThat(service.getApiKey()).isEqualTo("secret-key");
        assertThat(service.isConfigured()).isTrue();
    }

    @Test
    void blankKeyKeepsExistingKey() {
        service.save("https://qa.example.com", "secret-key");
        service.save("https://other.example.com", "  ");
        assertThat(service.getInstanceUrl()).isEqualTo("https://other.example.com");
        assertThat(service.getApiKey()).isEqualTo("secret-key");
    }

    @Test
    void nullKeyKeepsExistingKey() {
        service.save("https://qa.example.com", "secret-key");
        service.save("https://qa.example.com", null);
        assertThat(service.getApiKey()).isEqualTo("secret-key");
    }

    @Test
    void clearRemovesBoth() {
        service.save("https://qa.example.com", "secret-key");
        service.clear();
        assertThat(service.getInstanceUrl()).isNull();
        assertThat(service.getApiKey()).isNull();
        assertThat(service.isConfigured()).isFalse();
    }

    @Test
    void invalidUrlsAreRejected() {
        assertThatThrownBy(() -> service.save("not a url", "k"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid URL format");
        assertThatThrownBy(() -> service.save("ftp://qa.example.com", "k"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.save("", "k"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.save(null, "k"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void normalizeStripsTrailingSlashesAndTrims() {
        assertThat(TestPlanItSettingsService.normalizeInstanceUrl(" https://a.b/// "))
                .isEqualTo("https://a.b");
        assertThat(TestPlanItSettingsService.normalizeInstanceUrl("http://a.b:3000/base"))
                .isEqualTo("http://a.b:3000/base");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: COMPILATION ERROR — `TestPlanItSettingsService` does not exist.

- [ ] **Step 3: Implement the service**

`jira-dc-plugin/src/main/java/io/testplanit/jira/settings/TestPlanItSettingsService.java`:

```java
package io.testplanit.jira.settings;

import com.atlassian.plugin.spring.scanner.annotation.imports.ComponentImport;
import com.atlassian.sal.api.pluginsettings.PluginSettings;
import com.atlassian.sal.api.pluginsettings.PluginSettingsFactory;
import javax.inject.Inject;
import javax.inject.Named;

import java.net.URI;

/**
 * Global plugin settings: the TestPlanIt instance URL and the integration API
 * key. Direct equivalent of the Forge app's KVS usage (same two values, same
 * "blank key keeps the stored one" semantics as the settings UI expects).
 */
@Named
public class TestPlanItSettingsService {

    static final String KEY_INSTANCE_URL = "io.testplanit.jira:instanceUrl";
    static final String KEY_API_KEY = "io.testplanit.jira:apiKey";

    private final PluginSettingsFactory pluginSettingsFactory;

    @Inject
    public TestPlanItSettingsService(@ComponentImport PluginSettingsFactory pluginSettingsFactory) {
        this.pluginSettingsFactory = pluginSettingsFactory;
    }

    public String getInstanceUrl() {
        return (String) settings().get(KEY_INSTANCE_URL);
    }

    public String getApiKey() {
        return (String) settings().get(KEY_API_KEY);
    }

    public boolean isConfigured() {
        return getInstanceUrl() != null && getApiKey() != null;
    }

    public void save(String instanceUrl, String apiKeyOrNull) {
        String normalized = normalizeInstanceUrl(instanceUrl);
        settings().put(KEY_INSTANCE_URL, normalized);
        if (apiKeyOrNull != null && !apiKeyOrNull.isBlank()) {
            settings().put(KEY_API_KEY, apiKeyOrNull.trim());
        }
    }

    public void clear() {
        settings().remove(KEY_INSTANCE_URL);
        settings().remove(KEY_API_KEY);
    }

    static String normalizeInstanceUrl(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Invalid URL format");
        }
        String trimmed = raw.trim();
        URI uri;
        try {
            uri = URI.create(trimmed);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid URL format");
        }
        String scheme = uri.getScheme();
        if (uri.getHost() == null || (!"http".equals(scheme) && !"https".equals(scheme))) {
            throw new IllegalArgumentException("Invalid URL format");
        }
        return trimmed.replaceAll("/+$", "");
    }

    private PluginSettings settings() {
        return pluginSettingsFactory.createGlobalSettings();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: `Tests run: 7, Failures: 0` (all green), BUILD SUCCESS.

- [ ] **Step 5: Commit**

```powershell
git add jira-dc-plugin/src
git commit -m "feat(jira-dc): PluginSettings-backed settings service"
```

---

### Task 3: TestPlanIt HTTP client — TDD

**Files:**
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/client/TestPlanItClient.java`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/client/HttpResult.java`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/client/ConnectionTestResult.java`
- Test: `jira-dc-plugin/src/test/java/io/testplanit/jira/client/TestPlanItClientTest.java`

**Interfaces:**
- Produces (used by Task 4):
  - `record HttpResult(int status, String body)`
  - `record ConnectionTestResult(boolean success, String message)`
  - `HttpResult fetchTestInfo(String baseUrl, String apiKey, String issueKey, String issueId) throws IOException, InterruptedException` — GET `{base}/api/integrations/jira/test-info` with query params (URL-encoded, null params omitted) and `X-Forge-Api-Key`
  - `ConnectionTestResult testConnection(String baseUrl, String apiKey)` — never throws; mirrors the Forge resolver's `testConnection` semantics and messages
- Tests use the JDK's `com.sun.net.httpserver.HttpServer` instead of WireMock (same coverage, zero extra dependencies — deliberate deviation from the spec's "WireMock" mention).

- [ ] **Step 1: Write the failing tests**

`jira-dc-plugin/src/test/java/io/testplanit/jira/client/TestPlanItClientTest.java`:

```java
package io.testplanit.jira.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;

class TestPlanItClientTest {

    private HttpServer server;
    private String baseUrl;
    private final Map<String, String> seenHeaders = new ConcurrentHashMap<>();
    private final Map<String, String> seenQueries = new ConcurrentHashMap<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void respond(String path, int status, String body) {
        server.createContext(path, exchange -> {
            seenHeaders.put(path, String.valueOf(exchange.getRequestHeaders().getFirst("X-Forge-Api-Key")));
            seenQueries.put(path, String.valueOf(exchange.getRequestURI().getRawQuery()));
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
    }

    @Test
    void fetchTestInfoSendsKeyAndEncodedParams() throws Exception {
        respond("/api/integrations/jira/test-info", 200, "{\"testCases\":[]}");
        TestPlanItClient client = new TestPlanItClient();

        HttpResult result = client.fetchTestInfo(baseUrl, "the-key", "DEMO-1", "10001");

        assertThat(result.status()).isEqualTo(200);
        assertThat(result.body()).isEqualTo("{\"testCases\":[]}");
        assertThat(seenHeaders.get("/api/integrations/jira/test-info")).isEqualTo("the-key");
        assertThat(seenQueries.get("/api/integrations/jira/test-info"))
                .contains("issueKey=DEMO-1").contains("issueId=10001");
    }

    @Test
    void fetchTestInfoOmitsNullParams() throws Exception {
        respond("/api/integrations/jira/test-info", 200, "{}");
        TestPlanItClient client = new TestPlanItClient();

        client.fetchTestInfo(baseUrl, "k", "DEMO-2", null);

        assertThat(seenQueries.get("/api/integrations/jira/test-info"))
                .contains("issueKey=DEMO-2").doesNotContain("issueId");
    }

    @Test
    void testConnectionHappyPath() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 200, "{\"ok\":true}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "the-key");

        assertThat(result.success()).isTrue();
        assertThat(result.message()).contains("0.41.3");
        assertThat(seenHeaders.get("/api/integrations/jira/test-connection")).isEqualTo("the-key");
    }

    @Test
    void testConnectionUnreachableInstance() {
        // no /version.json context registered -> 404
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("Could not reach TestPlanIt instance");
    }

    @Test
    void testConnectionInvalidKey() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 401, "{}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "bad");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("API key is invalid or expired");
    }

    @Test
    void testConnectionOtherErrorStatus() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 500, "{}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("status 500");
    }

    @Test
    void testConnectionNetworkErrorIsCaught() {
        TestPlanItClient client = new TestPlanItClient();

        // Port 1 on localhost: connection refused.
        ConnectionTestResult result = client.testConnection("http://127.0.0.1:1", "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("Connection failed");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: COMPILATION ERROR — client classes do not exist.

- [ ] **Step 3: Implement the records and the client**

`jira-dc-plugin/src/main/java/io/testplanit/jira/client/HttpResult.java`:

```java
package io.testplanit.jira.client;

public record HttpResult(int status, String body) {
    public boolean isOk() {
        return status >= 200 && status < 300;
    }
}
```

`jira-dc-plugin/src/main/java/io/testplanit/jira/client/ConnectionTestResult.java`:

```java
package io.testplanit.jira.client;

public record ConnectionTestResult(boolean success, String message) {
}
```

`jira-dc-plugin/src/main/java/io/testplanit/jira/client/TestPlanItClient.java`:

```java
package io.testplanit.jira.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javax.inject.Named;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Server-side HTTP client for the TestPlanIt integration API. Mirrors the
 * Forge resolver's calls: same endpoints, same X-Forge-Api-Key header, same
 * user-facing connection-test messages. 10s timeouts; default JVM proxy.
 */
@Named
public class TestPlanItClient {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public HttpResult fetchTestInfo(String baseUrl, String apiKey, String issueKey, String issueId)
            throws IOException, InterruptedException {
        List<String> params = new ArrayList<>();
        if (issueKey != null) {
            params.add("issueKey=" + URLEncoder.encode(issueKey, StandardCharsets.UTF_8));
        }
        if (issueId != null) {
            params.add("issueId=" + URLEncoder.encode(issueId, StandardCharsets.UTF_8));
        }
        String url = baseUrl + "/api/integrations/jira/test-info?" + String.join("&", params);
        return get(url, apiKey);
    }

    public ConnectionTestResult testConnection(String baseUrl, String apiKey) {
        try {
            HttpResult version = get(baseUrl + "/version.json", null);
            if (!version.isOk()) {
                return new ConnectionTestResult(false,
                        "Could not reach TestPlanIt instance (status " + version.status()
                                + "). Please check the URL.");
            }
            String versionLabel = "instance";
            try {
                JsonNode node = MAPPER.readTree(version.body());
                if (node.hasNonNull("version")) {
                    versionLabel = node.get("version").asText();
                }
            } catch (IOException ignored) {
                // non-JSON version.json — keep the generic label
            }

            HttpResult test = get(baseUrl + "/api/integrations/jira/test-connection", apiKey);
            if (test.status() == 401 || test.status() == 403) {
                return new ConnectionTestResult(false,
                        "Instance is reachable but the API key is invalid or expired. "
                                + "Please check your key in Admin > Integrations > Jira.");
            }
            if (!test.isOk()) {
                return new ConnectionTestResult(false,
                        "Connection test returned status " + test.status()
                                + ". Please ensure your TestPlanIt instance is v0.15.4 or later.");
            }
            return new ConnectionTestResult(true,
                    "Successfully connected to TestPlanIt " + versionLabel + " — API key is valid.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new ConnectionTestResult(false, "Connection failed: interrupted");
        } catch (Exception e) {
            return new ConnectionTestResult(false, "Connection failed: " + e.getMessage());
        }
    }

    private HttpResult get(String url, String apiKeyOrNull) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(TIMEOUT)
                .header("Accept", "application/json")
                .GET();
        if (apiKeyOrNull != null) {
            builder.header("X-Forge-Api-Key", apiKeyOrNull);
        }
        HttpResponse<String> response = httpClient.send(builder.build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new HttpResult(response.statusCode(), response.body());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: all tests green (7 from Task 2 + 7 new), BUILD SUCCESS.

- [ ] **Step 5: Commit**

```powershell
git add jira-dc-plugin/src
git commit -m "feat(jira-dc): TestPlanIt HTTP client with Forge-parity connection test"
```

---

### Task 4: REST resources — panel proxy and settings — TDD

**Files:**
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/rest/PanelResource.java`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/rest/SettingsResource.java`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/rest/SettingsPayload.java`
- Test: `jira-dc-plugin/src/test/java/io/testplanit/jira/rest/PanelResourceTest.java`
- Test: `jira-dc-plugin/src/test/java/io/testplanit/jira/rest/SettingsResourceTest.java`

**Interfaces:**
- Consumes: `TestPlanItSettingsService` (Task 2), `TestPlanItClient`/`HttpResult`/`ConnectionTestResult` (Task 3), Jira host components `JiraAuthenticationContext`, `IssueManager`, `PermissionManager`, `GlobalPermissionManager`.
- Produces (consumed by the DC frontend in Task 7):
  - `GET /rest/testplanit/1.0/panel?issueKey=&issueId=` → 200 `{issueKey, issueId, instanceUrl, testCases, sessions, testRuns}`; 200 `{notConfigured:true, error}` when unconfigured; 400 missing params; 401 anonymous; 404 unknown/non-browsable issue; 502 `{error}` when TestPlanIt is unreachable or non-2xx.
  - `GET /rest/testplanit/1.0/settings` → 200 `{instanceUrl, apiKeySet}` (admin only; 401/403 otherwise)
  - `PUT /rest/testplanit/1.0/settings` body `{instanceUrl, apiKey?}` → 200 `{success:true}`; 400 `{success:false, error:"Invalid URL format"}`; blank/absent `apiKey` keeps the stored key
  - `POST /rest/testplanit/1.0/settings/test` body `{instanceUrl, apiKey?}` → 200 `{success, message}` (blank key falls back to the stored key)
  - `DELETE /rest/testplanit/1.0/settings` → 200 `{success:true}`
- All resources are constructor-injected (`@Inject` + `@ComponentImport` for host components) — unit tests construct them directly with Mockito mocks.

- [ ] **Step 1: Write the failing PanelResource tests**

`jira-dc-plugin/src/test/java/io/testplanit/jira/rest/PanelResourceTest.java`:

```java
package io.testplanit.jira.rest;

import com.atlassian.jira.issue.IssueManager;
import com.atlassian.jira.issue.MutableIssue;
import com.atlassian.jira.permission.ProjectPermissions;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.security.PermissionManager;
import com.atlassian.jira.user.ApplicationUser;
import io.testplanit.jira.client.HttpResult;
import io.testplanit.jira.client.TestPlanItClient;
import io.testplanit.jira.settings.TestPlanItSettingsService;
import javax.ws.rs.core.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PanelResourceTest {

    @Mock JiraAuthenticationContext authContext;
    @Mock IssueManager issueManager;
    @Mock PermissionManager permissionManager;
    @Mock TestPlanItSettingsService settings;
    @Mock TestPlanItClient client;
    @Mock ApplicationUser user;
    @Mock MutableIssue issue;

    PanelResource resource;

    @BeforeEach
    void setUp() {
        resource = new PanelResource(authContext, issueManager, permissionManager, settings, client);
        lenient().when(authContext.getLoggedInUser()).thenReturn(user);
        lenient().when(issueManager.getIssueObject("DEMO-1")).thenReturn(issue);
        lenient().when(permissionManager.hasPermission(eq(ProjectPermissions.BROWSE_PROJECTS), eq(issue), any(ApplicationUser.class)))
                .thenReturn(true);
    }

    @Test
    void anonymousGets401() {
        when(authContext.getLoggedInUser()).thenReturn(null);
        Response response = resource.get("DEMO-1", null);
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void missingParamsGet400() {
        Response response = resource.get(null, null);
        assertThat(response.getStatus()).isEqualTo(400);
    }

    @Test
    void unknownIssueGets404() {
        when(issueManager.getIssueObject("NOPE-1")).thenReturn(null);
        Response response = resource.get("NOPE-1", null);
        assertThat(response.getStatus()).isEqualTo(404);
    }

    @Test
    void nonBrowsableIssueGets404() {
        when(permissionManager.hasPermission(eq(ProjectPermissions.BROWSE_PROJECTS), eq(issue), any(ApplicationUser.class)))
                .thenReturn(false);
        Response response = resource.get("DEMO-1", null);
        assertThat(response.getStatus()).isEqualTo(404);
    }

    @Test
    void unconfiguredReturnsNotConfiguredPayload() {
        when(settings.isConfigured()).thenReturn(false);
        Response response = resource.get("DEMO-1", null);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getEntity().toString())
                .contains("\"notConfigured\":true").contains("error");
    }

    @Test
    void successMergesIssueContextIntoBody() throws Exception {
        when(settings.isConfigured()).thenReturn(true);
        when(settings.getInstanceUrl()).thenReturn("https://tp.example.com");
        when(settings.getApiKey()).thenReturn("k");
        when(issue.getKey()).thenReturn("DEMO-1");
        when(issue.getId()).thenReturn(10001L);
        when(client.fetchTestInfo("https://tp.example.com", "k", "DEMO-1", "10001"))
                .thenReturn(new HttpResult(200, "{\"testCases\":[{\"id\":1}],\"sessions\":[],\"testRuns\":[]}"));

        Response response = resource.get("DEMO-1", null);

        assertThat(response.getStatus()).isEqualTo(200);
        String body = response.getEntity().toString();
        assertThat(body).contains("\"issueKey\":\"DEMO-1\"");
        assertThat(body).contains("\"issueId\":\"10001\"");
        assertThat(body).contains("\"instanceUrl\":\"https://tp.example.com\"");
        assertThat(body).contains("\"testCases\":[{\"id\":1}]");
    }

    @Test
    void upstreamErrorGets502() throws Exception {
        when(settings.isConfigured()).thenReturn(true);
        when(settings.getInstanceUrl()).thenReturn("https://tp.example.com");
        when(settings.getApiKey()).thenReturn("k");
        when(issue.getKey()).thenReturn("DEMO-1");
        when(issue.getId()).thenReturn(10001L);
        when(client.fetchTestInfo(any(), any(), any(), any()))
                .thenReturn(new HttpResult(500, "boom"));

        Response response = resource.get("DEMO-1", null);

        assertThat(response.getStatus()).isEqualTo(502);
        assertThat(response.getEntity().toString()).contains("Failed to fetch test info: 500");
    }

    @Test
    void upstreamAuthFailureGetsApiKeyMessage() throws Exception {
        when(settings.isConfigured()).thenReturn(true);
        when(settings.getInstanceUrl()).thenReturn("https://tp.example.com");
        when(settings.getApiKey()).thenReturn("k");
        when(issue.getKey()).thenReturn("DEMO-1");
        when(issue.getId()).thenReturn(10001L);
        when(client.fetchTestInfo(any(), any(), any(), any()))
                .thenReturn(new HttpResult(401, "{}"));

        Response response = resource.get("DEMO-1", null);

        assertThat(response.getStatus()).isEqualTo(502);
        assertThat(response.getEntity().toString()).contains("API key is invalid or expired");
    }

    @Test
    void ioExceptionGets502() throws Exception {
        when(settings.isConfigured()).thenReturn(true);
        when(settings.getInstanceUrl()).thenReturn("https://tp.example.com");
        when(settings.getApiKey()).thenReturn("k");
        when(issue.getKey()).thenReturn("DEMO-1");
        when(issue.getId()).thenReturn(10001L);
        when(client.fetchTestInfo(any(), any(), any(), any()))
                .thenThrow(new java.io.IOException("connect timed out"));

        Response response = resource.get("DEMO-1", null);

        assertThat(response.getStatus()).isEqualTo(502);
        assertThat(response.getEntity().toString()).contains("connect timed out");
    }

    @Test
    void issueIdLookupIsUsedWhenKeyAbsent() throws Exception {
        MutableIssue byId = mock(MutableIssue.class);
        when(issueManager.getIssueObject(10002L)).thenReturn(byId);
        when(permissionManager.hasPermission(eq(ProjectPermissions.BROWSE_PROJECTS), eq(byId), any(ApplicationUser.class)))
                .thenReturn(true);
        when(settings.isConfigured()).thenReturn(false);

        Response response = resource.get(null, "10002");

        assertThat(response.getStatus()).isEqualTo(200); // notConfigured payload
    }
}
```

- [ ] **Step 2: Write the failing SettingsResource tests**

`jira-dc-plugin/src/test/java/io/testplanit/jira/rest/SettingsResourceTest.java`:

```java
package io.testplanit.jira.rest;

import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import io.testplanit.jira.client.ConnectionTestResult;
import io.testplanit.jira.client.TestPlanItClient;
import io.testplanit.jira.settings.TestPlanItSettingsService;
import javax.ws.rs.core.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SettingsResourceTest {

    @Mock JiraAuthenticationContext authContext;
    @Mock GlobalPermissionManager globalPermissionManager;
    @Mock TestPlanItSettingsService settings;
    @Mock TestPlanItClient client;
    @Mock ApplicationUser admin;

    SettingsResource resource;

    @BeforeEach
    void setUp() {
        resource = new SettingsResource(authContext, globalPermissionManager, settings, client);
        lenient().when(authContext.getLoggedInUser()).thenReturn(admin);
        lenient().when(globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, admin))
                .thenReturn(true);
    }

    @Test
    void anonymousGets401() {
        when(authContext.getLoggedInUser()).thenReturn(null);
        assertThat(resource.get().getStatus()).isEqualTo(401);
    }

    @Test
    void nonAdminGets403() {
        when(globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, admin)).thenReturn(false);
        assertThat(resource.get().getStatus()).isEqualTo(403);
        SettingsPayload payload = new SettingsPayload();
        payload.instanceUrl = "https://tp.example.com";
        assertThat(resource.put(payload).getStatus()).isEqualTo(403);
        assertThat(resource.test(payload).getStatus()).isEqualTo(403);
        assertThat(resource.delete().getStatus()).isEqualTo(403);
    }

    @Test
    void getNeverReturnsTheKey() {
        when(settings.getInstanceUrl()).thenReturn("https://tp.example.com");
        when(settings.getApiKey()).thenReturn("super-secret");

        Response response = resource.get();

        assertThat(response.getStatus()).isEqualTo(200);
        String body = response.getEntity().toString();
        assertThat(body).contains("\"instanceUrl\":\"https://tp.example.com\"");
        assertThat(body).contains("\"apiKeySet\":true");
        assertThat(body).doesNotContain("super-secret");
    }

    @Test
    void putSavesAndReportsSuccess() {
        SettingsPayload payload = new SettingsPayload();
        payload.instanceUrl = "https://tp.example.com/";
        payload.apiKey = "new-key";

        Response response = resource.put(payload);

        assertThat(response.getStatus()).isEqualTo(200);
        verify(settings).save("https://tp.example.com/", "new-key");
    }

    @Test
    void putInvalidUrlGets400() {
        doThrow(new IllegalArgumentException("Invalid URL format"))
                .when(settings).save("nope", null);
        SettingsPayload payload = new SettingsPayload();
        payload.instanceUrl = "nope";

        Response response = resource.put(payload);

        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(response.getEntity().toString()).contains("Invalid URL format");
    }

    @Test
    void testUsesStoredKeyWhenBlank() {
        when(settings.getApiKey()).thenReturn("stored-key");
        when(client.testConnection("https://tp.example.com", "stored-key"))
                .thenReturn(new ConnectionTestResult(true, "ok"));
        SettingsPayload payload = new SettingsPayload();
        payload.instanceUrl = "https://tp.example.com";
        payload.apiKey = "  ";

        Response response = resource.test(payload);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getEntity().toString()).contains("\"success\":true");
    }

    @Test
    void deleteClears() {
        Response response = resource.delete();
        assertThat(response.getStatus()).isEqualTo(200);
        verify(settings).clear();
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: COMPILATION ERROR — `PanelResource`, `SettingsResource`, `SettingsPayload` do not exist.

- [ ] **Step 4: Implement the payload DTO and both resources**

`jira-dc-plugin/src/main/java/io/testplanit/jira/rest/SettingsPayload.java`:

```java
package io.testplanit.jira.rest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Request body for PUT /settings and POST /settings/test. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SettingsPayload {
    public String instanceUrl;
    public String apiKey;
}
```

`jira-dc-plugin/src/main/java/io/testplanit/jira/rest/PanelResource.java`:

```java
package io.testplanit.jira.rest;

import com.atlassian.annotations.security.LicensedOnly;
import com.atlassian.jira.issue.Issue;
import com.atlassian.jira.issue.IssueManager;
import com.atlassian.jira.permission.ProjectPermissions;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.security.PermissionManager;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.plugin.spring.scanner.annotation.imports.ComponentImport;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.testplanit.jira.client.HttpResult;
import io.testplanit.jira.client.TestPlanItClient;
import io.testplanit.jira.settings.TestPlanItSettingsService;
import javax.inject.Inject;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

/**
 * Read-only proxy for the issue panel. Auth model: logged-in Jira user with
 * BROWSE permission on the issue; the TestPlanIt call itself is authenticated
 * with the admin-configured API key. Unknown and non-browsable issues both
 * return 404 so issue existence is not leaked.
 */
@Path("/panel")
@LicensedOnly
public class PanelResource {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JiraAuthenticationContext authContext;
    private final IssueManager issueManager;
    private final PermissionManager permissionManager;
    private final TestPlanItSettingsService settings;
    private final TestPlanItClient client;

    @Inject
    public PanelResource(@ComponentImport JiraAuthenticationContext authContext,
                         @ComponentImport IssueManager issueManager,
                         @ComponentImport PermissionManager permissionManager,
                         TestPlanItSettingsService settings,
                         TestPlanItClient client) {
        this.authContext = authContext;
        this.issueManager = issueManager;
        this.permissionManager = permissionManager;
        this.settings = settings;
        this.client = client;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response get(@QueryParam("issueKey") String issueKey, @QueryParam("issueId") String issueId) {
        ApplicationUser user = authContext.getLoggedInUser();
        if (user == null) {
            return error(401, "Authentication required");
        }
        if (isBlank(issueKey) && isBlank(issueId)) {
            return error(400, "issueKey or issueId is required");
        }

        Issue issue = resolveIssue(issueKey, issueId);
        if (issue == null
                || !permissionManager.hasPermission(ProjectPermissions.BROWSE_PROJECTS, issue, user)) {
            return error(404, "Issue not found");
        }

        if (!settings.isConfigured()) {
            ObjectNode body = MAPPER.createObjectNode();
            body.put("notConfigured", true);
            body.put("error", "TestPlanIt is not configured. Ask a Jira administrator to set the "
                    + "instance URL and API key under Administration > Manage apps > TestPlanIt Settings.");
            return Response.ok(body.toString()).build();
        }

        try {
            HttpResult result = client.fetchTestInfo(
                    settings.getInstanceUrl(), settings.getApiKey(),
                    issue.getKey(), String.valueOf(issue.getId()));
            if (result.status() == 401 || result.status() == 403) {
                return error(502, "TestPlanIt API key is invalid or expired — contact your Jira administrator.");
            }
            if (!result.isOk()) {
                return error(502, "Failed to fetch test info: " + result.status());
            }
            ObjectNode body = (ObjectNode) MAPPER.readTree(result.body());
            body.put("issueKey", issue.getKey());
            body.put("issueId", String.valueOf(issue.getId()));
            body.put("instanceUrl", settings.getInstanceUrl());
            return Response.ok(body.toString()).build();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error(502, "Request interrupted");
        } catch (Exception e) {
            return error(502, e.getMessage() == null ? "Upstream request failed" : e.getMessage());
        }
    }

    private Issue resolveIssue(String issueKey, String issueId) {
        if (!isBlank(issueKey)) {
            return issueManager.getIssueObject(issueKey);
        }
        try {
            return issueManager.getIssueObject(Long.parseLong(issueId.trim()));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static Response error(int status, String message) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("error", message);
        return Response.status(status).entity(body.toString())
                .type(MediaType.APPLICATION_JSON).build();
    }
}
```

`jira-dc-plugin/src/main/java/io/testplanit/jira/rest/SettingsResource.java`:

```java
package io.testplanit.jira.rest;

import com.atlassian.annotations.security.LicensedOnly;
import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.plugin.spring.scanner.annotation.imports.ComponentImport;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.testplanit.jira.client.ConnectionTestResult;
import io.testplanit.jira.client.TestPlanItClient;
import io.testplanit.jira.settings.TestPlanItSettingsService;
import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.DELETE;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

/**
 * Admin-only settings endpoints. The stored API key is write-only: GET
 * exposes only whether a key is set. The @LicensedOnly platform annotation is
 * the coarse gate; the authoritative ADMINISTER check is done per request so
 * it is unit-testable.
 */
@Path("/settings")
@LicensedOnly
public class SettingsResource {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JiraAuthenticationContext authContext;
    private final GlobalPermissionManager globalPermissionManager;
    private final TestPlanItSettingsService settings;
    private final TestPlanItClient client;

    @Inject
    public SettingsResource(@ComponentImport JiraAuthenticationContext authContext,
                            @ComponentImport GlobalPermissionManager globalPermissionManager,
                            TestPlanItSettingsService settings,
                            TestPlanItClient client) {
        this.authContext = authContext;
        this.globalPermissionManager = globalPermissionManager;
        this.settings = settings;
        this.client = client;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response get() {
        Response guard = requireAdmin();
        if (guard != null) return guard;

        ObjectNode body = MAPPER.createObjectNode();
        String url = settings.getInstanceUrl();
        body.put("instanceUrl", url == null ? "" : url);
        body.put("apiKeySet", settings.getApiKey() != null);
        return Response.ok(body.toString()).build();
    }

    @PUT
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response put(SettingsPayload payload) {
        Response guard = requireAdmin();
        if (guard != null) return guard;

        try {
            settings.save(payload == null ? null : payload.instanceUrl,
                    payload == null ? null : payload.apiKey);
        } catch (IllegalArgumentException e) {
            return failure(400, e.getMessage());
        }
        return success();
    }

    @POST
    @Path("/test")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response test(SettingsPayload payload) {
        Response guard = requireAdmin();
        if (guard != null) return guard;

        String url = payload == null ? null : payload.instanceUrl;
        if (url == null || url.isBlank()) {
            return failure(400, "Instance URL is required");
        }
        String key = payload.apiKey == null || payload.apiKey.isBlank()
                ? settings.getApiKey()
                : payload.apiKey.trim();
        if (key == null) {
            return failure(400, "API Key is required");
        }

        String normalized;
        try {
            normalized = TestPlanItSettingsService.normalizeInstanceUrl(url);
        } catch (IllegalArgumentException e) {
            return failure(400, e.getMessage());
        }

        ConnectionTestResult result = client.testConnection(normalized, key);
        ObjectNode body = MAPPER.createObjectNode();
        body.put("success", result.success());
        body.put("message", result.message());
        return Response.ok(body.toString()).build();
    }

    @DELETE
    @Produces(MediaType.APPLICATION_JSON)
    public Response delete() {
        Response guard = requireAdmin();
        if (guard != null) return guard;

        settings.clear();
        return success();
    }

    private Response requireAdmin() {
        ApplicationUser user = authContext.getLoggedInUser();
        if (user == null) {
            return failure(401, "Authentication required");
        }
        if (!globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, user)) {
            return failure(403, "Jira administrator permission required");
        }
        return null;
    }

    private static Response success() {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("success", true);
        return Response.ok(body.toString()).build();
    }

    private static Response failure(int status, String message) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("success", false);
        body.put("error", message);
        return Response.status(status).entity(body.toString())
                .type(MediaType.APPLICATION_JSON).build();
    }
}
```

Note: if `@LicensedOnly` does not resolve on this platform version, use the annotation discovered in Task 1 Step 6's fallback (any authenticated-access annotation works — the in-method checks are authoritative).

- [ ] **Step 5: Run tests to verify they pass**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: all tests green (Tasks 2–4), BUILD SUCCESS.

- [ ] **Step 6: Rebuild the JAR to confirm OSGi/scanner still process the new classes**

Run: `mvn -f jira-dc-plugin/pom.xml package`
Expected: BUILD SUCCESS.

- [ ] **Step 7: Commit**

```powershell
git add jira-dc-plugin/src
git commit -m "feat(jira-dc): panel proxy and admin settings REST resources"
```

---

### Task 5: Web modules — issue panel container, admin page shell, i18n

No React yet (that's Tasks 6–7): this task delivers the velocity container the bundle will hydrate, and the admin servlet page.

**Files:**
- Modify: `jira-dc-plugin/src/main/resources/atlassian-plugin.xml`
- Create: `jira-dc-plugin/src/main/resources/templates/panel.vm`
- Create: `jira-dc-plugin/src/main/resources/templates/admin.vm`
- Create: `jira-dc-plugin/src/main/java/io/testplanit/jira/web/AdminServlet.java`
- Test: `jira-dc-plugin/src/test/java/io/testplanit/jira/web/AdminServletTest.java`
- Modify: `jira-dc-plugin/src/main/resources/i18n/testplanit.properties` (+ `_ru`)

**Interfaces:**
- Consumes: nothing from earlier tasks (servlet checks permissions itself).
- Produces (consumed by Task 7's bundles):
  - Panel container: `<div id="testplanit-panel" data-issue-key data-issue-id data-base-url>` on the issue view
  - Settings container: `<div id="testplanit-settings-root" data-base-url>` at `/plugins/servlet/testplanit/admin`
  - Web-resource keys `io.testplanit.testplanit-jira-dc:panel-resources` (files `frontend/panel.js`, `frontend/panel.css`) and `...:settings-resources` (`frontend/settings.js`, `frontend/settings.css`)

- [ ] **Step 1: Write the failing AdminServlet tests**

`jira-dc-plugin/src/test/java/io/testplanit/jira/web/AdminServletTest.java`:

```java
package io.testplanit.jira.web;

import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.sal.api.auth.LoginUriProvider;
import com.atlassian.templaterenderer.TemplateRenderer;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.URI;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminServletTest {

    @Mock JiraAuthenticationContext authContext;
    @Mock GlobalPermissionManager globalPermissionManager;
    @Mock LoginUriProvider loginUriProvider;
    @Mock TemplateRenderer templateRenderer;
    @Mock HttpServletRequest request;
    @Mock HttpServletResponse response;
    @Mock ApplicationUser admin;

    AdminServlet servlet;

    @BeforeEach
    void setUp() throws Exception {
        servlet = new AdminServlet(authContext, globalPermissionManager, loginUriProvider, templateRenderer);
        lenient().when(request.getRequestURL()).thenReturn(new StringBuffer("http://jira/plugins/servlet/testplanit/admin"));
        lenient().when(request.getContextPath()).thenReturn("/jira");
        lenient().when(response.getWriter()).thenReturn(new PrintWriter(new StringWriter()));
    }

    @Test
    void anonymousIsRedirectedToLogin() throws Exception {
        when(authContext.getLoggedInUser()).thenReturn(null);
        when(loginUriProvider.getLoginUri(any(URI.class)))
                .thenReturn(URI.create("http://jira/login.jsp?next=x"));

        servlet.doGet(request, response);

        verify(response).sendRedirect("http://jira/login.jsp?next=x");
        verify(templateRenderer, never()).render(any(), anyMap(), any());
    }

    @Test
    void nonAdminGets403() throws Exception {
        when(authContext.getLoggedInUser()).thenReturn(admin);
        when(globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, admin)).thenReturn(false);

        servlet.doGet(request, response);

        verify(response).sendError(HttpServletResponse.SC_FORBIDDEN);
        verify(templateRenderer, never()).render(any(), anyMap(), any());
    }

    @Test
    void adminGetsRenderedTemplate() throws Exception {
        when(authContext.getLoggedInUser()).thenReturn(admin);
        when(globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, admin)).thenReturn(true);

        servlet.doGet(request, response);

        verify(response).setContentType("text/html;charset=UTF-8");
        verify(templateRenderer).render(eq("templates/admin.vm"), anyMap(), any());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: COMPILATION ERROR — `AdminServlet` does not exist.

- [ ] **Step 3: Implement `AdminServlet`**

`jira-dc-plugin/src/main/java/io/testplanit/jira/web/AdminServlet.java`:

```java
package io.testplanit.jira.web;

import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.plugin.spring.scanner.annotation.imports.ComponentImport;
import com.atlassian.sal.api.auth.LoginUriProvider;
import com.atlassian.templaterenderer.TemplateRenderer;
import javax.inject.Inject;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.net.URI;
import java.util.Map;

/**
 * Renders the admin settings page shell (a root div the settings bundle
 * hydrates). Access: logged-in Jira administrators; anonymous users are sent
 * to login, non-admins get 403. The REST layer re-checks ADMINISTER on every
 * call, so this page is presentation-only.
 */
public class AdminServlet extends HttpServlet {

    private final transient JiraAuthenticationContext authContext;
    private final transient GlobalPermissionManager globalPermissionManager;
    private final transient LoginUriProvider loginUriProvider;
    private final transient TemplateRenderer templateRenderer;

    @Inject
    public AdminServlet(@ComponentImport JiraAuthenticationContext authContext,
                        @ComponentImport GlobalPermissionManager globalPermissionManager,
                        @ComponentImport LoginUriProvider loginUriProvider,
                        @ComponentImport TemplateRenderer templateRenderer) {
        this.authContext = authContext;
        this.globalPermissionManager = globalPermissionManager;
        this.loginUriProvider = loginUriProvider;
        this.templateRenderer = templateRenderer;
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        ApplicationUser user = authContext.getLoggedInUser();
        if (user == null) {
            response.sendRedirect(loginUriProvider.getLoginUri(URI.create(request.getRequestURL().toString())).toASCIIString());
            return;
        }
        if (!globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, user)) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN);
            return;
        }
        response.setContentType("text/html;charset=UTF-8");
        templateRenderer.render("templates/admin.vm",
                Map.of("contextPath", request.getContextPath()),
                response.getWriter());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `mvn -f jira-dc-plugin/pom.xml test`
Expected: all green, BUILD SUCCESS.

- [ ] **Step 5: Create the velocity templates**

`jira-dc-plugin/src/main/resources/templates/panel.vm`:

```vm
$webResourceManager.requireResource("io.testplanit.testplanit-jira-dc:panel-resources")
<div id="testplanit-panel"
     data-issue-key="$issue.key"
     data-issue-id="$issue.id"
     data-base-url="$requestContext.baseUrl"></div>
```

`jira-dc-plugin/src/main/resources/templates/admin.vm`:

```vm
<html>
<head>
    <title>TestPlanIt</title>
    <meta name="decorator" content="atl.admin"/>
    $webResourceManager.requireResource("io.testplanit.testplanit-jira-dc:settings-resources")
</head>
<body>
<div id="testplanit-settings-root" data-base-url="$contextPath"></div>
</body>
</html>
```

Note: `$webResourceManager`, `$issue`, and `$requestContext` are provided by Jira in web-panel velocity contexts. In the servlet-rendered `admin.vm`, `$webResourceManager` is also available via the template renderer's default context; if it turns out empty at runtime, fall back to plain tags in `admin.vm`:
`<script src="$contextPath/download/resources/io.testplanit.testplanit-jira-dc:settings-resources/settings.js"></script>` (and the analogous `<link>` for `settings.css`).

- [ ] **Step 6: Register the modules in `atlassian-plugin.xml`**

Add inside `<atlassian-plugin>`, after the `<rest>` element:

```xml
  <web-resource key="panel-resources" name="TestPlanIt Panel Resources">
    <resource type="download" name="panel.js" location="frontend/panel.js"/>
    <resource type="download" name="panel.css" location="frontend/panel.css"/>
  </web-resource>

  <web-resource key="settings-resources" name="TestPlanIt Settings Resources">
    <resource type="download" name="settings.js" location="frontend/settings.js"/>
    <resource type="download" name="settings.css" location="frontend/settings.css"/>
  </web-resource>

  <web-panel key="testplanit-panel" location="atl.jira.view.issue.right.context" weight="60">
    <label key="testplanit.panel.title"/>
    <resource name="view" type="velocity" location="templates/panel.vm"/>
    <condition class="com.atlassian.jira.plugin.webfragment.conditions.UserLoggedInCondition"/>
  </web-panel>

  <web-section key="testplanit-admin-section" location="admin_plugins_menu" weight="900">
    <label key="testplanit.admin.section"/>
  </web-section>

  <web-item key="testplanit-admin-link" section="admin_plugins_menu/testplanit-admin-section" weight="10">
    <label key="testplanit.admin.title"/>
    <link linkId="testplanit-admin-link">/plugins/servlet/testplanit/admin</link>
  </web-item>

  <servlet key="testplanit-admin-servlet" class="io.testplanit.jira.web.AdminServlet">
    <url-pattern>/testplanit/admin</url-pattern>
  </servlet>
```

- [ ] **Step 7: Extend the i18n files**

Append to `testplanit.properties`:

```properties
testplanit.panel.description=View TestPlanIt test cases, runs, and results directly in Jira issues
```

Append to `testplanit_ru.properties`:

```properties
testplanit.panel.description=Просмотр тест-кейсов, прогонов и результатов TestPlanIt прямо в задачах Jira
```

- [ ] **Step 8: Build and verify on the running Jira**

Run: `mvn -f jira-dc-plugin/pom.xml package`
Expected: BUILD SUCCESS (missing `frontend/*.js` files are fine — web-resources resolve lazily at request time; the panel just renders an empty div until Task 7).

If the Task 1 Jira instance is still running with QuickReload, it picks the new JAR up; otherwise start it again (`...jira-maven-plugin:9.12.5:run`) and:
1. Open any issue (create project + issue via the Jira UI if none exist) → the right column shows a **TestPlanIt** panel (empty body) — inspect DOM for `<div id="testplanit-panel" data-issue-key=...>`.
2. Open **Administration → Manage apps** → sidebar shows **TestPlanIt → TestPlanIt Settings** → page renders with the (empty) `testplanit-settings-root` div.
3. Log out → the issue view no longer shows the panel (UserLoggedInCondition), and `/plugins/servlet/testplanit/admin` redirects to login.

- [ ] **Step 9: Commit**

```powershell
git add jira-dc-plugin/src
git commit -m "feat(jira-dc): issue web-panel, admin servlet page, i18n en/ru"
```

---

### Task 6: Extract `packages/jira-panel-ui` shared package; refactor forge-app onto it

The panel components leave `forge-app/src/frontend/app.jsx` (1981 lines) for a shared workspace package. Forge behavior must not change. Line numbers below refer to the file as of commit `2c6f23c2`.

**Files:**
- Create: `packages/jira-panel-ui/package.json`
- Create: `packages/jira-panel-ui/vitest.config.mts`
- Create: `packages/jira-panel-ui/src/index.js`
- Create: `packages/jira-panel-ui/src/bridge.jsx`
- Create: `packages/jira-panel-ui/src/urls.js`
- Create: `packages/jira-panel-ui/src/formatters.js`
- Create: `packages/jira-panel-ui/src/components/StatusBadge.jsx`
- Create: `packages/jira-panel-ui/src/components/DynamicIcon.jsx`
- Create: `packages/jira-panel-ui/src/components/TestCaseRow.jsx`
- Create: `packages/jira-panel-ui/src/components/SessionRow.jsx`
- Create: `packages/jira-panel-ui/src/components/TestRunRow.jsx`
- Create: `packages/jira-panel-ui/src/components/PanelSections.jsx`
- Create: `packages/jira-panel-ui/src/theme.css`
- Test: `packages/jira-panel-ui/src/urls.test.js`
- Test: `packages/jira-panel-ui/src/formatters.test.js`
- Test: `packages/jira-panel-ui/src/components/TestCaseRow.test.jsx`
- Test: `packages/jira-panel-ui/src/components/PanelSections.test.jsx`
- Modify: `forge-app/src/frontend/app.jsx` (shrinks to App + GenerateTestCasesFlow + Forge entry)
- Create: `forge-app/src/frontend/forgeBridge.js`
- Modify: `forge-app/src/frontend/app.css` (imports shared theme, adds `@source`)
- Modify: `forge-app/webpack.config.js` (babel include for the shared package)
- Modify: `forge-app/package.json` (add workspace dep)

**Interfaces:**
- Produces (consumed by forge-app now and Task 7's DC frontend):
  - `createBridge` contract (plain object): `{ getTestInfo(): Promise<object>, openUrl(url: string): void, getIssueContext(): {issueKey: string|null, issueId: string|null}, getTheme(): 'light'|'dark' }`
  - `<PanelBridgeProvider bridge={bridge}>` React context provider + `usePanelBridge()` hook
  - `<PanelSections testData onOpenTestCase(id, projectId) onOpenSession(id, projectId) onOpenTestRun(id, projectId, opts?) onOpenHome() actions emptyActions />` — the sections/empty/footer UI (no loading/error/config states — those stay per-host)
  - `TestCaseRow({testCase, onOpen, onOpenTestRun})`, `SessionRow({session, onOpen})`, `TestRunRow({testRun, onOpen})`, `StatusBadge`, `DynamicIcon`
  - `buildTestCaseUrl(instanceUrl, testCaseId, projectId)`, `buildSessionUrl(instanceUrl, sessionId, projectId)`, `buildTestRunUrl(instanceUrl, testRunId, projectId, {selectedCaseId}?)`
  - `formatDuration(seconds)`, `formatElapsedTime(totalSeconds)`, `flattenFolders(folders)`
  - CSS: `@testplanit/jira-panel-ui/src/theme.css` (the `@theme` block, custom properties, and utility classes formerly in `app.css` — everything except `@import 'tailwindcss'`)
- Intentional behavior fix (both platforms): the test-run link inside TestCaseRow's expanded history currently references an out-of-scope `instanceUrl` and a direct `router` import (`app.jsx:296-313`) and throws on click; it becomes a working `onOpenTestRun` callback. Everything else must render identically.

- [ ] **Step 1: Create the package scaffolding**

`packages/jira-panel-ui/package.json`:

```json
{
  "name": "@testplanit/jira-panel-ui",
  "version": "0.1.0",
  "private": true,
  "description": "Shared React components for the TestPlanIt Jira issue panel (Forge + Data Center)",
  "main": "src/index.js",
  "scripts": {
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "dependencies": {
    "date-fns": "^4.4.0",
    "lucide-react": "^1.21.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@vitejs/plugin-react": "^5.1.0",
    "jsdom": "^25.0.1",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "vitest": "^4.1.9"
  }
}
```

(The tests below use only built-in vitest assertions — no jest-dom matchers needed. Align dependency versions with what `testplanit/package.json` already resolves where possible.)

`packages/jira-panel-ui/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 2: Move the leaf pieces (formatters, urls, bridge, badge, icon)**

`packages/jira-panel-ui/src/formatters.js` — move `formatDuration` (app.jsx:120-138), `formatElapsedTime` (app.jsx:141-154), and `flattenFolders` (app.jsx:11-27) verbatim; export all three:

```js
export const flattenFolders = (folders) => { /* app.jsx:11-27 body unchanged */ };
export const formatDuration = (seconds) => { /* app.jsx:120-138 body unchanged */ };
export const formatElapsedTime = (totalSeconds) => { /* app.jsx:141-154 body unchanged */ };
```

`packages/jira-panel-ui/src/urls.js` — new, centralizes the URL construction currently inlined in App (app.jsx:1405-1407, 1452-1454, 1499-1501, and the history link 298):

```js
// Locale-neutral TestPlanIt URLs — the app's middleware handles locale detection.
export const buildTestCaseUrl = (instanceUrl, testCaseId, projectId) =>
  projectId
    ? `${instanceUrl}/projects/repository/${projectId}/${testCaseId}`
    : `${instanceUrl}/test-cases/${testCaseId}`;

export const buildSessionUrl = (instanceUrl, sessionId, projectId) =>
  projectId
    ? `${instanceUrl}/projects/sessions/${projectId}/${sessionId}`
    : `${instanceUrl}/sessions/${sessionId}`;

export const buildTestRunUrl = (instanceUrl, testRunId, projectId, opts = {}) => {
  const base = projectId
    ? `${instanceUrl}/projects/runs/${projectId}/${testRunId}`
    : `${instanceUrl}/test-runs/${testRunId}`;
  return opts.selectedCaseId
    ? `${base}?selectedCase=${opts.selectedCaseId}&view=status`
    : base;
};
```

`packages/jira-panel-ui/src/bridge.jsx`:

```jsx
import React, { createContext, useContext } from 'react';

// Host-platform seam. Forge implements this with @forge/bridge, the Jira DC
// plugin with fetch against its own REST module. The shared components only
// ever see this object.
export const PanelBridgeContext = createContext(null);

export const PanelBridgeProvider = ({ bridge, children }) => (
  <PanelBridgeContext.Provider value={bridge}>{children}</PanelBridgeContext.Provider>
);

export const usePanelBridge = () => {
  const bridge = useContext(PanelBridgeContext);
  if (!bridge) {
    throw new Error('PanelBridgeProvider is missing');
  }
  return bridge;
};
```

`packages/jira-panel-ui/src/components/StatusBadge.jsx` — move app.jsx:29-51 verbatim, prepend:

```jsx
import React from 'react';
import { DynamicIcon } from './DynamicIcon';

export const StatusBadge = ({ status, statusColor, icon, className = "", width = "w-20" }) => {
  /* app.jsx:31-50 body unchanged */
};
```

`packages/jira-panel-ui/src/components/DynamicIcon.jsx` — move app.jsx:53-118 (the `DynamicIcon` component with its `toPascalCase` helper and `LucideIcons` import) verbatim, with `import * as LucideIcons from 'lucide-react';` at top and `export const DynamicIcon = ...`.

- [ ] **Step 3: Move the three row components**

`packages/jira-panel-ui/src/components/TestCaseRow.jsx` — move app.jsx:157-381 with these exact changes:

Header:

```jsx
import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { DynamicIcon } from './DynamicIcon';
import { formatDuration } from '../formatters';

export const TestCaseRow = ({ testCase, onOpen, onOpenTestRun }) => {
```

Replace the expanded-history test-run button's `onClick` (app.jsx:296-313 — the broken `instanceUrl`/`router` closure) with:

```jsx
onClick={() => onOpenTestRun?.(result.testRunId, testCase.projectId, { selectedCaseId: testCase.id })}
```

Everything else byte-identical.

`packages/jira-panel-ui/src/components/SessionRow.jsx` — move app.jsx:384-520 verbatim with header:

```jsx
import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { StatusBadge } from './StatusBadge';
import { formatElapsedTime } from '../formatters';

export const SessionRow = ({ session, onOpen }) => {
```

`packages/jira-panel-ui/src/components/TestRunRow.jsx` — move app.jsx:522-610 verbatim with header:

```jsx
import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { StatusBadge } from './StatusBadge';

export const TestRunRow = ({ testRun, onOpen }) => {
```

- [ ] **Step 4: Create `PanelSections` from App's render**

`packages/jira-panel-ui/src/components/PanelSections.jsx` — new component assembled from app.jsx:1330-1342 (section state) and app.jsx:1839-1973 (empty state + three sections + footer):

```jsx
import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { TestCaseRow } from './TestCaseRow';
import { SessionRow } from './SessionRow';
import { TestRunRow } from './TestRunRow';

// The read-only panel body: three collapsible sections, empty state, footer.
// Host-specific chrome (loading, errors, configuration, AI generation) stays
// in the host app; `actions`/`emptyActions` are its slots in the layout.
export const PanelSections = ({
  testData,
  onOpenTestCase,
  onOpenSession,
  onOpenTestRun,
  onOpenHome,
  actions = null,
  emptyActions = null,
}) => {
  const [sectionsExpanded, setSectionsExpanded] = useState({
    testCases: true,
    testRuns: true,
    sessions: true,
  });

  const toggleSection = (section) => {
    setSectionsExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const hasTestCases = testData?.testCases?.length > 0;
  const hasSessions = testData?.sessions?.length > 0;
  const hasTestRuns = testData?.testRuns?.length > 0;

  if (!hasTestCases && !hasSessions && !hasTestRuns) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="bg-card rounded-lg p-6 text-center border border-border">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-muted-foreground mb-4">No tests linked to this issue yet</p>
          <div className="flex flex-col items-center gap-2">
            {emptyActions}
            <button
              className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
              onClick={onOpenHome}
            >
              Link tests in TestPlanIt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 testplanit-bg">
      {hasTestCases && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testCases')}
          >
            <DynamicIcon name={sectionsExpanded.testCases ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Test Cases ({testData.testCases.length})
          </button>
          {sectionsExpanded.testCases && (
            <div>
              {testData.testCases.map((testCase, index) => (
                <TestCaseRow
                  key={testCase.id || index}
                  testCase={testCase}
                  onOpen={onOpenTestCase}
                  onOpenTestRun={onOpenTestRun}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {hasTestRuns && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testRuns')}
          >
            <DynamicIcon name={sectionsExpanded.testRuns ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Test Runs ({testData.testRuns.length})
          </button>
          {sectionsExpanded.testRuns && (
            <div>
              {testData.testRuns.map((testRun, index) => (
                <TestRunRow key={testRun.id || index} testRun={testRun} onOpen={onOpenTestRun} />
              ))}
            </div>
          )}
        </div>
      )}

      {hasSessions && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('sessions')}
          >
            <DynamicIcon name={sectionsExpanded.sessions ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Sessions ({testData.sessions.length})
          </button>
          {sectionsExpanded.sessions && (
            <div>
              {testData.sessions.map((session, index) => (
                <SessionRow key={session.id || index} session={session} onOpen={onOpenSession} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4 flex items-center justify-between gap-2">
        <button
          className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
          onClick={onOpenHome}
        >
          Open TestPlanIt →
        </button>
        {actions}
      </div>
    </div>
  );
};
```

Note the one intentional mapping: `TestRunRow`'s title `onOpen` receives `onOpenTestRun` — its signature `(testRunId, projectId)` is compatible with `(testRunId, projectId, opts?)` (opts simply absent).

- [ ] **Step 5: Move the stylesheet and create the index**

`packages/jira-panel-ui/src/theme.css` — everything from `forge-app/src/frontend/app.css` **except** line 1 (`@import 'tailwindcss';`), unchanged (the `@theme` block, `:root` custom properties, dark-scheme media query, `body`/utility classes to end of file).

`packages/jira-panel-ui/src/index.js`:

```js
export { PanelBridgeProvider, usePanelBridge, PanelBridgeContext } from './bridge.jsx';
export { PanelSections } from './components/PanelSections.jsx';
export { TestCaseRow } from './components/TestCaseRow.jsx';
export { SessionRow } from './components/SessionRow.jsx';
export { TestRunRow } from './components/TestRunRow.jsx';
export { StatusBadge } from './components/StatusBadge.jsx';
export { DynamicIcon } from './components/DynamicIcon.jsx';
export { buildTestCaseUrl, buildSessionUrl, buildTestRunUrl } from './urls.js';
export { flattenFolders, formatDuration, formatElapsedTime } from './formatters.js';
```

- [ ] **Step 6: Write the package tests**

`packages/jira-panel-ui/src/urls.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildSessionUrl, buildTestCaseUrl, buildTestRunUrl } from './urls';

const base = 'https://tp.example.com';

describe('url builders', () => {
  it('builds project-scoped and fallback test case urls', () => {
    expect(buildTestCaseUrl(base, 5, 2)).toBe(`${base}/projects/repository/2/5`);
    expect(buildTestCaseUrl(base, 5, null)).toBe(`${base}/test-cases/5`);
  });

  it('builds session urls', () => {
    expect(buildSessionUrl(base, 7, 2)).toBe(`${base}/projects/sessions/2/7`);
    expect(buildSessionUrl(base, 7, undefined)).toBe(`${base}/sessions/7`);
  });

  it('builds run urls with optional selected case', () => {
    expect(buildTestRunUrl(base, 9, 2)).toBe(`${base}/projects/runs/2/9`);
    expect(buildTestRunUrl(base, 9, 2, { selectedCaseId: 5 }))
      .toBe(`${base}/projects/runs/2/9?selectedCase=5&view=status`);
    expect(buildTestRunUrl(base, 9, null)).toBe(`${base}/test-runs/9`);
  });
});
```

`packages/jira-panel-ui/src/formatters.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { formatDuration, formatElapsedTime, flattenFolders } from './formatters';

describe('formatDuration', () => {
  it('returns null for empty/zero', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });
  it('formats compound durations', () => {
    expect(formatDuration(60)).toBe('1 minute');
    expect(formatDuration(3661)).toBe('1 hour, 1 minute');
    expect(formatDuration(90061)).toBe('1 day, 1 hour, 1 minute');
  });
});

describe('formatElapsedTime', () => {
  it('handles zero', () => {
    expect(formatElapsedTime(0)).toBe('No time recorded');
  });
  it('formats h/m/s', () => {
    expect(formatElapsedTime(3725)).toBe('1 hour, 2 minutes, 5 seconds');
  });
});

describe('flattenFolders', () => {
  it('orders children under parents with depth', () => {
    const flat = flattenFolders([
      { id: 1, parentId: null, name: 'root-a' },
      { id: 2, parentId: 1, name: 'child' },
      { id: 3, parentId: null, name: 'root-b' },
    ]);
    expect(flat).toEqual([
      { id: 1, name: 'root-a', depth: 0 },
      { id: 2, name: 'child', depth: 1 },
      { id: 3, name: 'root-b', depth: 0 },
    ]);
  });
});
```

`packages/jira-panel-ui/src/components/TestCaseRow.test.jsx` (regression test for the fixed history link):

```jsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { TestCaseRow } from './TestCaseRow';

const testCase = {
  id: 5,
  projectId: 2,
  name: 'Login works',
  status: 'Ready',
  statusColor: '#10b981',
  resultHistory: [
    {
      testRunId: 9,
      testRunName: 'Sprint 12 run',
      status: 'Passed',
      statusColor: '#10b981',
      executedAt: new Date().toISOString(),
      executedBy: { name: 'QA' },
    },
  ],
};

describe('TestCaseRow', () => {
  it('opens the case via onOpen', () => {
    const onOpen = vi.fn();
    render(<TestCaseRow testCase={testCase} onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle('Login works'));
    expect(onOpen).toHaveBeenCalledWith(5, 2);
  });

  it('opens a history test run via onOpenTestRun with the selected case', () => {
    const onOpenTestRun = vi.fn();
    render(<TestCaseRow testCase={testCase} onOpen={() => {}} onOpenTestRun={onOpenTestRun} />);
    // expand the row (chevron is the last button in the header)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(screen.getByTitle('Sprint 12 run'));
    expect(onOpenTestRun).toHaveBeenCalledWith(9, 2, { selectedCaseId: 5 });
  });
});
```

`packages/jira-panel-ui/src/components/PanelSections.test.jsx`:

```jsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PanelSections } from './PanelSections';

describe('PanelSections', () => {
  it('renders the empty state with home link and emptyActions slot', () => {
    const onOpenHome = vi.fn();
    render(
      <PanelSections
        testData={{ testCases: [], sessions: [], testRuns: [] }}
        onOpenHome={onOpenHome}
        emptyActions={<button>Generate</button>}
      />
    );
    expect(screen.getByText('No tests linked to this issue yet')).toBeTruthy();
    expect(screen.getByText('Generate')).toBeTruthy();
    fireEvent.click(screen.getByText('Link tests in TestPlanIt'));
    expect(onOpenHome).toHaveBeenCalled();
  });

  it('renders sections with counts and collapses them', () => {
    render(
      <PanelSections
        testData={{
          testCases: [{ id: 1, name: 'c1', status: 'Ready' }],
          sessions: [],
          testRuns: [{ id: 9, name: 'r1', status: 'Active', total: 0, displayItems: [] }],
        }}
        onOpenTestCase={() => {}}
        onOpenTestRun={() => {}}
        onOpenHome={() => {}}
      />
    );
    expect(screen.getByText('Test Cases (1)')).toBeTruthy();
    expect(screen.getByText('Test Runs (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('Test Cases (1)'));
    expect(screen.queryByTitle('c1')).toBeNull();
  });
});
```

- [ ] **Step 7: Install and run the package tests**

```powershell
pnpm install
pnpm --filter @testplanit/jira-panel-ui test
```

Expected: `pnpm install` links the new package (workspace glob `packages/*` already covers it); vitest reports all tests passing. Fix any drift between the moved code and the tests before proceeding.

- [ ] **Step 8: Refactor forge-app onto the package**

`forge-app/package.json` — add to `dependencies`:

```json
"@testplanit/jira-panel-ui": "workspace:*",
```

`forge-app/src/frontend/forgeBridge.js` — new; the Forge implementation of the bridge contract. `openUrl` carries over App's router fallback chain (app.jsx:1411-1431) verbatim once instead of four copies:

```js
import { invoke, router } from '@forge/bridge';

export const createForgeBridge = () => ({
  getTestInfo: () => invoke('getTestInfo'),

  openUrl: async (url) => {
    try {
      await router.open(url);
      return;
    } catch (routerError) {
      console.log('Forge router.open() failed, trying router.navigate():', routerError);
      try {
        await router.navigate(url);
        return;
      } catch (navigateError) {
        console.log('Forge router.navigate() failed:', navigateError);
      }
    }
    window.location.href = url;
  },

  // The Forge resolver derives the issue from its own invocation context.
  getIssueContext: () => ({ issueKey: null, issueId: null }),

  getTheme: () =>
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
});
```

`forge-app/src/frontend/app.jsx` — apply, keeping everything not listed untouched:

1. Replace the import block (lines 1-6) with:

```jsx
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import * as LucideIcons from 'lucide-react';
import {
  DynamicIcon,
  PanelSections,
  buildSessionUrl,
  buildTestCaseUrl,
  buildTestRunUrl,
  flattenFolders,
} from '@testplanit/jira-panel-ui';
import { createForgeBridge } from './forgeBridge';
import './app.css';
```

(`LucideIcons` stays only if `GenerateTestCasesFlow`'s retained code still references it; drop the import if not.)

2. Delete the moved blocks: `flattenFolders` (11-27), `StatusBadge` (29-51), `DynamicIcon` (53-118), `formatDuration` (120-138), `formatElapsedTime` (141-154), `TestCaseRow` (156-381), `SessionRow` (383-520), `TestRunRow` (522-610). `GenerateTestCasesFlow` and its helpers (`QUANTITY_OPTIONS`, `PreviewFieldValue`, `PreviewCaseRow`, lines 612-1291) stay.

3. Inside `App`, add `const bridge = React.useMemo(() => createForgeBridge(), []);` at the top, replace `loadTestInfo`'s `invoke('getTestInfo')` with `bridge.getTestInfo()`, and replace the four `open*` functions (1397-1570) with:

```jsx
const openTestCaseUrl = (testCaseId, projectId) => {
  if (!instanceUrl) return;
  bridge.openUrl(buildTestCaseUrl(instanceUrl, testCaseId, projectId));
};

const openSessionUrl = (sessionId, projectId) => {
  if (!instanceUrl) return;
  bridge.openUrl(buildSessionUrl(instanceUrl, sessionId, projectId));
};

const openTestRunUrl = (testRunId, projectId, opts) => {
  if (!instanceUrl) return;
  bridge.openUrl(buildTestRunUrl(instanceUrl, testRunId, projectId, opts));
};

const openTestPlanIt = () => {
  bridge.openUrl(instanceUrl || 'https://testplanit.com');
};
```

4. Replace the final render (the empty-state branch at 1843-1869 and the sections+footer return at 1871-1973) with:

```jsx
  const generateButton = (small) =>
    canGenerate ? (
      <button
        className={
          small
            ? 'flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-brand text-white hover:bg-brand-hover active:scale-95 transition-all duration-150'
            : 'flex items-center justify-center gap-1 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-brand-hover hover:shadow-md active:scale-95 transition-all duration-150'
        }
        onClick={() => setShowGenerate(true)}
      >
        <DynamicIcon name="Sparkles" className={small ? 'h-3 w-3' : 'h-4 w-4'} />
        Generate Test Cases
      </button>
    ) : null;

  return (
    <PanelSections
      testData={testData}
      onOpenTestCase={openTestCaseUrl}
      onOpenSession={openSessionUrl}
      onOpenTestRun={openTestRunUrl}
      onOpenHome={openTestPlanIt}
      actions={generateButton(true)}
      emptyActions={generateButton(false)}
    />
  );
```

Delete the now-dead `detectTheme`/`setIsDarkTheme` state if nothing else references it (the CSS handles theming via `prefers-color-scheme`).

5. `forge-app/src/frontend/app.css` — replace the entire file with:

```css
@import 'tailwindcss';
@source '../../../packages/jira-panel-ui/src';
@import '@testplanit/jira-panel-ui/src/theme.css';
```

(Tailwind 4 scans `forge-app` sources automatically; the `@source` adds the shared package so its class names keep generating utilities.)

6. `forge-app/webpack.config.js` — in the shared `moduleRules`, make babel transpile the shared package. Replace the js/jsx rule's `exclude: /node_modules/` with an explicit include:

```js
{
  test: /\.(js|jsx)$/,
  include: [
    path.resolve(__dirname, 'src'),
    path.resolve(__dirname, '../packages/jira-panel-ui/src'),
  ],
  use: { /* babel-loader options unchanged */ },
},
```

- [ ] **Step 9: Smoke-test the Forge bridge (mocked @forge/bridge)**

Add to `forge-app/package.json` `scripts`: `"test": "vitest run"`, and to `devDependencies`: `"vitest": "^4.1.9"`.

Create `forge-app/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

Create `forge-app/src/frontend/forgeBridge.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const open = vi.fn();
const navigate = vi.fn();
vi.mock('@forge/bridge', () => ({
  invoke: (...args) => invoke(...args),
  router: { open: (...args) => open(...args), navigate: (...args) => navigate(...args) },
}));

import { createForgeBridge } from './forgeBridge';

describe('createForgeBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates getTestInfo to the resolver', async () => {
    invoke.mockResolvedValue({ testCases: [] });
    const bridge = createForgeBridge();
    await expect(bridge.getTestInfo()).resolves.toEqual({ testCases: [] });
    expect(invoke).toHaveBeenCalledWith('getTestInfo');
  });

  it('opens urls via router.open first', async () => {
    open.mockResolvedValue(undefined);
    const bridge = createForgeBridge();
    await bridge.openUrl('https://tp.example.com');
    expect(open).toHaveBeenCalledWith('https://tp.example.com');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falls back to router.navigate when open fails', async () => {
    open.mockRejectedValue(new Error('sandbox'));
    navigate.mockResolvedValue(undefined);
    const bridge = createForgeBridge();
    await bridge.openUrl('https://tp.example.com');
    expect(navigate).toHaveBeenCalledWith('https://tp.example.com');
  });
});
```

Run: `pnpm install; pnpm --filter @testplanit/forge-app test`
Expected: 3 tests green.

- [ ] **Step 10: Verify the forge-app build and settings page are intact**

```powershell
pnpm --filter @testplanit/forge-app build
```

Expected: webpack finishes both configs with no errors; `forge-app/static/frontend/app.js` and `forge-app/static/settings/settings.js` regenerate. `settings.jsx` is untouched by design.

Re-run the package tests: `pnpm --filter @testplanit/jira-panel-ui test` → green.

- [ ] **Step 11: Commit**

```powershell
git add packages/jira-panel-ui forge-app pnpm-lock.yaml
git commit -m "refactor(forge-app): extract shared jira-panel-ui package with bridge seam"
```

---

### Task 7: DC frontend — bridge, panel entry, settings page, webpack

**Files:**
- Modify: `pnpm-workspace.yaml` (add `jira-dc-plugin/frontend`)
- Create: `jira-dc-plugin/frontend/package.json`
- Create: `jira-dc-plugin/frontend/webpack.config.js`
- Create: `jira-dc-plugin/frontend/postcss.config.js`
- Create: `jira-dc-plugin/frontend/vitest.config.mts`
- Create: `jira-dc-plugin/frontend/src/dcBridge.js`
- Create: `jira-dc-plugin/frontend/src/panel.jsx`
- Create: `jira-dc-plugin/frontend/src/panel.css`
- Create: `jira-dc-plugin/frontend/src/settings.jsx`
- Create: `jira-dc-plugin/frontend/src/settings.css`
- Test: `jira-dc-plugin/frontend/src/dcBridge.test.js`

**Interfaces:**
- Consumes: `@testplanit/jira-panel-ui` (Task 6), plugin REST endpoints (Task 4), container divs and web-resource names (Task 5: `frontend/panel.js|css`, `frontend/settings.js|css`).
- Produces: webpack build emitting exactly `panel.js`, `panel.css`, `settings.js`, `settings.css` into `jira-dc-plugin/src/main/resources/frontend/`.

- [ ] **Step 1: Register the workspace package**

`pnpm-workspace.yaml` — add to `packages:`:

```yaml
  - 'jira-dc-plugin/frontend'
```

- [ ] **Step 2: Create package.json, postcss, webpack, vitest configs**

`jira-dc-plugin/frontend/package.json`:

```json
{
  "name": "@testplanit/jira-dc-frontend",
  "version": "0.1.0",
  "private": true,
  "description": "Jira Data Center plugin frontend bundles (issue panel + admin settings)",
  "scripts": {
    "build": "webpack",
    "test": "vitest run"
  },
  "dependencies": {
    "@testplanit/jira-panel-ui": "workspace:*",
    "lucide-react": "^1.21.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "@babel/core": "^8.0.1",
    "@babel/preset-env": "^8.0.2",
    "@babel/preset-react": "^8.0.1",
    "@tailwindcss/postcss": "^4.3.1",
    "babel-loader": "^10.1.1",
    "css-loader": "^7.1.4",
    "mini-css-extract-plugin": "^2.10.2",
    "postcss": "^8.5.15",
    "postcss-loader": "^8.2.1",
    "tailwindcss": "^4.3.1",
    "vitest": "^4.1.9",
    "webpack": "^5.108.0",
    "webpack-cli": "^7.0.3"
  }
}
```

`jira-dc-plugin/frontend/postcss.config.js`:

```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

`jira-dc-plugin/frontend/webpack.config.js`:

```js
const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Bundles are emitted straight into the plugin's resources so the Maven build
// packs them into the JAR (the directory is gitignored; `pnpm build` must run
// before `mvn package` — see the root build:jira-dc script).
module.exports = {
  mode: 'production',
  entry: {
    panel: './src/panel.jsx',
    settings: './src/settings.jsx',
  },
  output: {
    path: path.resolve(__dirname, '../src/main/resources/frontend'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: [
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, '../../packages/jira-panel-ui/src'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'classic' }],
            ],
          },
        },
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].css' }),
  ],
  resolve: {
    extensions: ['.js', '.jsx'],
  },
};
```

`jira-dc-plugin/frontend/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 3: Write the failing dcBridge tests**

`jira-dc-plugin/frontend/src/dcBridge.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDcBridge } from './dcBridge';

describe('createDcBridge', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.dataset.issueKey = 'DEMO-1';
    container.dataset.issueId = '10001';
    delete window.AJS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-color-mode');
  });

  it('reads issue context from the container dataset', () => {
    const bridge = createDcBridge(container);
    expect(bridge.getIssueContext()).toEqual({ issueKey: 'DEMO-1', issueId: '10001' });
  });

  it('fetches panel data from the plugin REST with the AJS context path', async () => {
    window.AJS = { contextPath: () => '/jira' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ testCases: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(fetchMock).toHaveBeenCalledWith(
      '/jira/rest/testplanit/1.0/panel?issueKey=DEMO-1&issueId=10001',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(data).toEqual({ testCases: [] });
  });

  it('maps HTTP errors to the { error } shape the panel understands', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'Failed to fetch test info: 500' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(data).toEqual({ error: 'Failed to fetch test info: 500' });
  });

  it('synthesizes an error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(data.error).toContain('offline');
  });

  it('opens urls in a new tab', () => {
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    const bridge = createDcBridge(container);
    bridge.openUrl('https://tp.example.com/x');

    expect(openMock).toHaveBeenCalledWith('https://tp.example.com/x', '_blank', 'noopener');
  });

  it('reports the Jira color mode', () => {
    const bridge = createDcBridge(container);
    expect(bridge.getTheme()).toBe('light');
    document.documentElement.setAttribute('data-color-mode', 'dark');
    expect(bridge.getTheme()).toBe('dark');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```powershell
pnpm install
pnpm --filter @testplanit/jira-dc-frontend test
```

Expected: FAIL — `./dcBridge` does not exist.

- [ ] **Step 5: Implement `dcBridge.js`**

`jira-dc-plugin/frontend/src/dcBridge.js`:

```js
// DC implementation of the panel bridge contract (see
// @testplanit/jira-panel-ui bridge.jsx). Talks to this plugin's own REST
// module; Jira handles the user session cookie.
const contextPath = () =>
  (window.AJS && typeof window.AJS.contextPath === 'function' && window.AJS.contextPath()) ||
  window.contextPath ||
  '';

export const createDcBridge = (container) => {
  const issueKey = container.dataset.issueKey || null;
  const issueId = container.dataset.issueId || null;

  return {
    getTestInfo: async () => {
      const params = new URLSearchParams();
      if (issueKey) params.set('issueKey', issueKey);
      if (issueId) params.set('issueId', issueId);
      try {
        const response = await fetch(
          `${contextPath()}/rest/testplanit/1.0/panel?${params.toString()}`,
          { headers: { Accept: 'application/json' } }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok && !body.error) {
          return { error: `Request failed (${response.status})` };
        }
        return body;
      } catch (err) {
        return { error: err.message || 'Request failed' };
      }
    },

    openUrl: (url) => {
      window.open(url, '_blank', 'noopener');
    },

    getIssueContext: () => ({ issueKey, issueId }),

    getTheme: () =>
      document.documentElement.getAttribute('data-color-mode') === 'dark' ? 'dark' : 'light',
  };
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @testplanit/jira-dc-frontend test`
Expected: all 6 tests green.

- [ ] **Step 7: Create the panel entry and stylesheet**

`jira-dc-plugin/frontend/src/panel.css`:

```css
@import 'tailwindcss';
@source '../../../packages/jira-panel-ui/src';
@import '@testplanit/jira-panel-ui/src/theme.css';
```

`jira-dc-plugin/frontend/src/panel.jsx`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DynamicIcon,
  PanelSections,
  buildSessionUrl,
  buildTestCaseUrl,
  buildTestRunUrl,
} from '@testplanit/jira-panel-ui';
import { createDcBridge } from './dcBridge';
import './panel.css';

// Shown to everyone when the plugin has no instance URL/API key yet. Only a
// Jira admin can fix it, so this is a pointer, not a form (unlike Forge,
// which exposed an in-panel config UI — an admin-page-only flow is stricter).
const NotConfiguredHint = () => (
  <div className="p-4 testplanit-bg">
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <DynamicIcon name="Settings" className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold">TestPlanIt is not configured</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        A Jira administrator can connect TestPlanIt under
        {' '}<strong>Administration &gt; Manage apps &gt; TestPlanIt Settings</strong>:
        set the instance URL and paste an API key generated in TestPlanIt
        (Admin &gt; Integrations &gt; Jira).
      </p>
    </div>
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="p-4 testplanit-bg">
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-start gap-2 mb-3">
        <DynamicIcon name="AlertTriangle" className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">Could not load TestPlanIt data</p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        className="px-3 py-1.5 border border-border rounded text-xs font-medium hover:bg-muted transition-colors"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  </div>
);

const DcApp = ({ bridge }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [testData, setTestData] = useState(null);
  const [instanceUrl, setInstanceUrl] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const response = await bridge.getTestInfo();
    if (response.notConfigured) {
      setNotConfigured(true);
    } else if (response.error) {
      setError(response.error);
    } else {
      setTestData(response);
      setInstanceUrl(response.instanceUrl);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
          <span className="text-sm text-muted-foreground">Loading test information...</span>
        </div>
      </div>
    );
  }
  if (notConfigured) return <NotConfiguredHint />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <PanelSections
      testData={testData}
      onOpenTestCase={(id, projectId) => instanceUrl && bridge.openUrl(buildTestCaseUrl(instanceUrl, id, projectId))}
      onOpenSession={(id, projectId) => instanceUrl && bridge.openUrl(buildSessionUrl(instanceUrl, id, projectId))}
      onOpenTestRun={(id, projectId, opts) => instanceUrl && bridge.openUrl(buildTestRunUrl(instanceUrl, id, projectId, opts))}
      onOpenHome={() => bridge.openUrl(instanceUrl || 'https://testplanit.com')}
    />
  );
};

const container = document.getElementById('testplanit-panel');
if (container) {
  const bridge = createDcBridge(container);
  createRoot(container).render(<DcApp bridge={bridge} />);
}
```

- [ ] **Step 8: Create the settings entry**

`jira-dc-plugin/frontend/src/settings.css`:

```css
@import 'tailwindcss';
@source '../../../packages/jira-panel-ui/src';
@import '@testplanit/jira-panel-ui/src/theme.css';
```

`jira-dc-plugin/frontend/src/settings.jsx` — an adapted copy of `forge-app/src/frontend/settings.jsx` (same layout/classes/copy) with these mechanical substitutions; keep everything else identical to the Forge file:

1. Imports: replace `import { invoke } from '@forge/bridge';` with a small REST helper, and import `DynamicIcon` from the shared package instead of the local `iconMap` (delete the local `iconMap`/`DynamicIcon` at lines 4-12 of the Forge file):

```jsx
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicIcon } from '@testplanit/jira-panel-ui';
import './settings.css';

const contextPath = () =>
  (window.AJS && typeof window.AJS.contextPath === 'function' && window.AJS.contextPath()) ||
  window.contextPath ||
  '';

const rest = async (method, path, body) => {
  const response = await fetch(`${contextPath()}/rest/testplanit/1.0${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && data.error === undefined && data.message === undefined) {
    throw new Error(`Request failed (${response.status})`);
  }
  return data;
};
```

2. State: replace `apiKey` handling with an `apiKeySet` flag — the stored key is never shown:

```jsx
const [apiKeySet, setApiKeySet] = useState(false);
```

`loadSettings` becomes:

```jsx
const loadSettings = async () => {
  try {
    const response = await rest('GET', '/settings');
    if (response.instanceUrl) setInstanceUrl(response.instanceUrl);
    setApiKeySet(Boolean(response.apiKeySet));
  } catch (err) {
    console.error('Error loading settings:', err);
    setError('Failed to load settings');
  } finally {
    setLoading(false);
  }
};
```

3. `testConnection` calls `rest('POST', '/settings/test', { instanceUrl, apiKey })` (blank `apiKey` means "use the stored key" — allowed when `apiKeySet`); the enable-condition on the Test button becomes `!instanceUrl || (!apiKey && !apiKeySet)`.

4. `handleSave` calls `rest('PUT', '/settings', { instanceUrl: instanceUrl.replace(/\/$/, ''), apiKey: apiKey.trim() || null })`; on success set `apiKeySet(true)` when a key was submitted, clear the `apiKey` input, keep the green "saved" banner logic; surface `response.error` when `success` is false.

5. API key input placeholder: `apiKeySet ? 'Key saved — leave blank to keep it' : 'Enter your API key'`; helper text: `Generate an API key in TestPlanIt under Admin > Integrations > Jira.`

6. Setup instructions list: replace item 2 with `Generate an API key in TestPlanIt (Admin > Integrations > Jira)` (no "Forge" wording); everything else verbatim.

7. Mount target: `document.getElementById('testplanit-settings-root')` instead of `'root'`.

- [ ] **Step 9: Build the bundles and the JAR**

```powershell
pnpm --filter @testplanit/jira-dc-frontend build
Get-ChildItem jira-dc-plugin\src\main\resources\frontend
```

Expected: `panel.js`, `panel.css`, `settings.js`, `settings.css` present.

```powershell
mvn -f jira-dc-plugin/pom.xml package
```

Expected: BUILD SUCCESS; the JAR now contains `frontend/*` (verify: `jar -tf jira-dc-plugin/target/testplanit-jira-dc-0.1.0-SNAPSHOT.jar | Select-String "frontend"`).

- [ ] **Step 10: Commit**

```powershell
git add pnpm-workspace.yaml jira-dc-plugin/frontend pnpm-lock.yaml
git commit -m "feat(jira-dc): React panel and settings bundles over the DC bridge"
```

---

### Task 8: Build orchestration and CI

**Files:**
- Modify: `package.json` (repo root — add `build:jira-dc` script)
- Modify: `.github/workflows/ci.yml` (add a `jira-dc-plugin` job)
- Create: `jira-dc-plugin/README.md`

**Interfaces:**
- Produces: `pnpm run build:jira-dc` = frontend build + `mvn package` in one command; CI job running Java + frontend tests and the full JAR build on every PR.

- [ ] **Step 1: Add the root orchestration script**

In root `package.json` `scripts`, add:

```json
"build:jira-dc": "pnpm --filter @testplanit/jira-dc-frontend build && mvn -f jira-dc-plugin/pom.xml package"
```

Run: `pnpm run build:jira-dc`
Expected: webpack then Maven, BUILD SUCCESS.

- [ ] **Step 2: Add the CI job**

Read `.github/workflows/ci.yml` first and mirror its existing conventions (trigger filters, pnpm setup steps, runner labels, action versions). Add a job equivalent to:

```yaml
  jira-dc-plugin:
    name: Jira DC plugin
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
          cache: maven
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @testplanit/jira-panel-ui test
      - run: pnpm --filter @testplanit/jira-dc-frontend test
      - run: pnpm --filter @testplanit/forge-app test
      - run: pnpm --filter @testplanit/forge-app build
      - run: pnpm run build:jira-dc
```

(`mvn package` inside `build:jira-dc` runs the Java unit tests; the forge-app build guards the extraction against regressions. If ci.yml gates jobs behind path filters, include `jira-dc-plugin/**`, `packages/jira-panel-ui/**`, and `forge-app/**` for this job.)

- [ ] **Step 3: Write `jira-dc-plugin/README.md`**

```markdown
# TestPlanIt for Jira Data Center

A P2 plugin for Jira Data Center 10.3 LTS that shows TestPlanIt test cases,
test runs, and exploratory sessions on Jira issues, plus an admin settings
page. The Data Center counterpart of the Forge app in `../forge-app`.

## Requirements

- Jira Data Center 10.3.x (Platform 7)
- JDK 17, Maven 3.9+, pnpm (repo workspace)
- A TestPlanIt instance with a Jira integration API key
  (TestPlanIt: Admin > Integrations > Jira > generate API key)

## Build

    pnpm install
    pnpm run build:jira-dc        # from the repo root

The JAR lands in `target/testplanit-jira-dc-<version>.jar`.
Frontend bundles are built into `src/main/resources/frontend/` (gitignored)
by `frontend/` (webpack) and must exist before `mvn package` — the root
script handles the ordering.

## Run a dev Jira

    mvn -f pom.xml com.atlassian.maven.plugins:jira-maven-plugin:9.12.5:run

First boot downloads Jira 10.3.13 and starts it on
http://localhost:2990/jira (admin/admin, timebomb license). QuickReload is
enabled: re-run `pnpm run build:jira-dc` and the rebuilt JAR is picked up.

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
```

- [ ] **Step 4: Commit**

```powershell
git add package.json .github/workflows/ci.yml jira-dc-plugin/README.md
git commit -m "build(jira-dc): build:jira-dc orchestration script, CI job, README"
```

---

### Task 9: End-to-end verification on a local Jira 10.3

Manual gate before calling the MVP done. Needs a reachable TestPlanIt instance with a Jira integration API key (any deployment — a dev instance is fine; data shows only for issues actually linked in that TestPlanIt).

- [ ] **Step 1: Start Jira with the final JAR**

```powershell
pnpm run build:jira-dc
mvn -f jira-dc-plugin/pom.xml com.atlassian.maven.plugins:jira-maven-plugin:9.12.5:run
```

Wait for startup; log in at `http://localhost:2990/jira` as `admin`/`admin`. Check `atlassian-jira.log` (printed to the console) for the plugin enabling without stack traces.

- [ ] **Step 2: Walk the settings flow**

1. Administration → Manage apps → **TestPlanIt Settings**.
2. Empty state: URL field blank, key placeholder "Enter your API key".
3. Enter an invalid URL (`nope`) → Save → inline "Invalid URL format" error, nothing saved.
4. Enter the real TestPlanIt URL + a **wrong** key → Test Connection → red result mentioning an invalid key.
5. Enter the correct key → Test Connection → green "Successfully connected to TestPlanIt <version> — API key is valid."
6. Save → success banner; reload the page → URL shown, key field placeholder now "Key saved — leave blank to keep it", key value not present anywhere in the DOM or in the `GET /settings` response (verify in devtools).

- [ ] **Step 3: Walk the panel flow**

1. Create a project and an issue whose key matches an issue linked in TestPlanIt (or link this issue's key in TestPlanIt: open a test case → Issues → add the Jira issue key).
2. Open the issue → TestPlanIt panel shows Test Cases / Test Runs / Sessions sections with statuses and counts; sections collapse/expand.
3. Click a test case title → TestPlanIt opens in a new tab at the case URL.
4. Expand a test case with result history → click a run name → TestPlanIt opens the run with the case pre-selected (`?selectedCase=`) — this is the fixed-by-design link.
5. Open an issue with no linked tests → "No tests linked to this issue yet" + "Link tests in TestPlanIt".
6. `DELETE` the settings (Clear in the UI if exposed, or `Invoke-RestMethod -Method Delete http://localhost:2990/jira/rest/testplanit/1.0/settings -Headers @{...}` as admin — simplest is re-saving after) → panel shows the not-configured hint. Reconfigure afterwards.
7. REST guards: as an anonymous session, `Invoke-WebRequest http://localhost:2990/jira/rest/testplanit/1.0/panel?issueKey=X` → 401; logged in as a non-admin user, `GET /rest/testplanit/1.0/settings` → 403.

- [ ] **Step 4: Verify the Forge side still builds**

```powershell
pnpm --filter @testplanit/forge-app build
pnpm --filter @testplanit/jira-panel-ui test
pnpm --filter @testplanit/jira-dc-frontend test
mvn -f jira-dc-plugin/pom.xml test
```

Expected: everything green.

- [ ] **Step 5: Fix-forward and commit any adjustments**

Anything discovered in Steps 2–3 (annotation names, web-resource loading in `admin.vm`, theming glitches) gets fixed and committed:

```powershell
git add -A
git commit -m "fix(jira-dc): adjustments from end-to-end verification on Jira 10.3"
```

- [ ] **Step 6: Final install on jira.rapidsoft.ru (user-driven)**

Hand the JAR to the user (or, with their go-ahead, install via UPM on https://jira.rapidsoft.ru — Jira 10.3.13) and re-run the Step 2/3 checklist against their real TestPlanIt instance with real linked issues (project TITP has integration-test data). This is the spec's final success criterion; get explicit confirmation before marking the MVP complete.

---

## Deviations from the spec (intentional, minor)

- Java HTTP-client tests use the JDK's built-in `HttpServer` instead of WireMock — same coverage, no extra dependency.
- The DC panel does not replicate the Forge panel's in-panel configuration form (`ConfigurationUI`): configuration is admin-page-only, which matches the spec's stricter security model; the panel shows a pointer instead.
- `@LicensedOnly`/`@UnrestrictedAccess` REST security annotations are best-effort named; Task 1 Step 6 documents how to discover the exact names available on Platform 7 if these don't resolve. The in-method permission checks are the authoritative guards either way.



