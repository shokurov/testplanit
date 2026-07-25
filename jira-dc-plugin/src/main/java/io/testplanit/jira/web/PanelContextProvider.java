package io.testplanit.jira.web;

import com.atlassian.jira.issue.Issue;
import com.atlassian.jira.plugin.webfragment.contextproviders.AbstractJiraContextProvider;
import com.atlassian.jira.plugin.webfragment.model.JiraHelper;
import com.atlassian.jira.user.ApplicationUser;

import java.util.HashMap;
import java.util.Map;

/**
 * Supplies {@code $issueKey}/{@code $issueId} to the issue web-panel template.
 *
 * The template originally referenced {@code $issue.key} directly, betting on
 * the issue being present in the web-panel velocity context — live on Jira
 * 10.3 it was not, both attributes rendered blank, and the panel's REST call
 * failed with "issueKey or issueId is required". A context provider is the
 * documented, deterministic way to feed values to a web-panel template: the
 * plugin framework hands it the context params (which DO contain the issue
 * for view-issue locations) and the returned map becomes template variables.
 *
 * Deliberately dependency-free (no @Inject/@Named needed): the framework
 * instantiates module classes reflectively, and zero-arg classes are immune
 * to the DI wiring pitfalls this plugin has already hit.
 */
public class PanelContextProvider extends AbstractJiraContextProvider {

    @Override
    public Map<String, Object> getContextMap(ApplicationUser user, JiraHelper jiraHelper) {
        Map<String, Object> context = new HashMap<>();
        Object issueObj = jiraHelper.getContextParams().get("issue");
        if (issueObj instanceof Issue issue) {
            context.put("issueKey", issue.getKey());
            context.put("issueId", String.valueOf(issue.getId()));
        } else {
            context.put("issueKey", "");
            context.put("issueId", "");
        }
        return context;
    }
}
