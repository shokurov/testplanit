package io.testplanit.jira.rest;

import com.atlassian.jira.component.ComponentAccessor;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
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
    MockedStatic<ComponentAccessor> componentAccessor;

    @BeforeEach
    void setUp() {
        resource = new PanelResource(issueManager, permissionManager, settings, client);
        componentAccessor = mockStatic(ComponentAccessor.class);
        componentAccessor.when(ComponentAccessor::getJiraAuthenticationContext).thenReturn(authContext);
        lenient().when(authContext.getLoggedInUser()).thenReturn(user);
        lenient().when(issueManager.getIssueObject("DEMO-1")).thenReturn(issue);
        lenient().when(permissionManager.hasPermission(eq(ProjectPermissions.BROWSE_PROJECTS), eq(issue), any(ApplicationUser.class)))
                .thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        componentAccessor.close();
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
