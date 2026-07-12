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
