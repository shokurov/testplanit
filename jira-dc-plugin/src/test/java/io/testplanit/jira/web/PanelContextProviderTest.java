package io.testplanit.jira.web;

import com.atlassian.jira.issue.MutableIssue;
import com.atlassian.jira.plugin.webfragment.model.JiraHelper;
import com.atlassian.jira.user.ApplicationUser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PanelContextProviderTest {

    @Mock JiraHelper jiraHelper;
    @Mock ApplicationUser user;

    private final PanelContextProvider provider = new PanelContextProvider();

    @Test
    void exposesIssueKeyAndIdFromContextParams() {
        MutableIssue issue = mock(MutableIssue.class);
        when(issue.getKey()).thenReturn("DEMO-7");
        when(issue.getId()).thenReturn(10007L);
        when(jiraHelper.getContextParams()).thenReturn(Map.of("issue", issue));

        Map<String, Object> context = provider.getContextMap(user, jiraHelper);

        assertThat(context).containsEntry("issueKey", "DEMO-7")
                .containsEntry("issueId", "10007");
    }

    @Test
    void rendersBlankWhenIssueAbsent() {
        when(jiraHelper.getContextParams()).thenReturn(Map.of());

        Map<String, Object> context = provider.getContextMap(user, jiraHelper);

        assertThat(context).containsEntry("issueKey", "")
                .containsEntry("issueId", "");
    }
}
