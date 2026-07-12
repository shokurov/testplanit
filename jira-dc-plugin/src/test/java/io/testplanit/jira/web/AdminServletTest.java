package io.testplanit.jira.web;

import com.atlassian.jira.component.ComponentAccessor;
import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.security.JiraAuthenticationContext;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.sal.api.auth.LoginUriProvider;
import com.atlassian.templaterenderer.TemplateRenderer;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.URI;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mockStatic;
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
    MockedStatic<ComponentAccessor> componentAccessor;

    @BeforeEach
    void setUp() throws Exception {
        servlet = new AdminServlet(globalPermissionManager, loginUriProvider, templateRenderer);
        componentAccessor = mockStatic(ComponentAccessor.class);
        componentAccessor.when(ComponentAccessor::getJiraAuthenticationContext).thenReturn(authContext);
        lenient().when(request.getRequestURL()).thenReturn(new StringBuffer("http://jira/plugins/servlet/testplanit/admin"));
        lenient().when(request.getContextPath()).thenReturn("/jira");
        lenient().when(response.getWriter()).thenReturn(new PrintWriter(new StringWriter()));
    }

    @AfterEach
    void tearDown() {
        componentAccessor.close();
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
