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
import javax.inject.Named;
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
@Named
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
