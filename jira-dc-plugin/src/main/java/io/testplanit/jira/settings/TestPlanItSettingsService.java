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

    public static String normalizeInstanceUrl(String raw) {
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
