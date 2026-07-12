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
