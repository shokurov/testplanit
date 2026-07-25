package io.testplanit.jira.web;

import com.atlassian.jira.component.ComponentAccessor;
import com.atlassian.jira.permission.GlobalPermissionKey;
import com.atlassian.jira.security.GlobalPermissionManager;
import com.atlassian.jira.user.ApplicationUser;
import com.atlassian.plugin.spring.scanner.annotation.imports.ComponentImport;
import com.atlassian.sal.api.auth.LoginUriProvider;
import com.atlassian.templaterenderer.TemplateRenderer;
import javax.inject.Inject;
import javax.inject.Named;
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
 *
 * JiraAuthenticationContext is read via {@link ComponentAccessor}, not
 * {@code @ComponentImport} constructor injection: on this platform version,
 * {@code @ComponentImport JiraAuthenticationContext} consistently produced
 * "no qualifying bean" (Spring) / "unsatisfied dependency" (Jersey/HK2)
 * regardless of {@code @Named} on the consuming class. ComponentAccessor is
 * the long-standing static-accessor path and sidesteps that OSGi/DI wiring
 * entirely. The other three host services (GlobalPermissionManager,
 * LoginUriProvider, TemplateRenderer) remain constructor-injected — they
 * have not shown the same failure.
 */
@Named
public class AdminServlet extends HttpServlet {

    private final transient GlobalPermissionManager globalPermissionManager;
    private final transient LoginUriProvider loginUriProvider;
    private final transient TemplateRenderer templateRenderer;

    @Inject
    public AdminServlet(@ComponentImport GlobalPermissionManager globalPermissionManager,
                        @ComponentImport LoginUriProvider loginUriProvider,
                        @ComponentImport TemplateRenderer templateRenderer) {
        this.globalPermissionManager = globalPermissionManager;
        this.loginUriProvider = loginUriProvider;
        this.templateRenderer = templateRenderer;
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        ApplicationUser user = ComponentAccessor.getJiraAuthenticationContext().getLoggedInUser();
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
