package io.testplanit.jira.rest;

import com.atlassian.jira.component.ComponentAccessor;
import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import io.testplanit.jira.client.ConnectionTestResult;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mockStatic;
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
    MockedStatic<ComponentAccessor> componentAccessor;

    @BeforeEach
    void setUp() {
        resource = new SettingsResource(globalPermissionManager, settings, client);
        componentAccessor = mockStatic(ComponentAccessor.class);
        componentAccessor.when(ComponentAccessor::getJiraAuthenticationContext).thenReturn(authContext);
        lenient().when(authContext.getLoggedInUser()).thenReturn(admin);
        lenient().when(globalPermissionManager.hasPermission(GlobalPermissionKey.ADMINISTER, admin))
                .thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        componentAccessor.close();
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
