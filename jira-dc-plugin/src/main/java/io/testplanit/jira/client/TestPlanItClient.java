package io.testplanit.jira.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javax.inject.Named;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Server-side HTTP client for the TestPlanIt integration API. Mirrors the
 * Forge resolver's calls: same endpoints, same X-Forge-Api-Key header, same
 * user-facing connection-test messages. 10s timeouts; default JVM proxy.
 */
@Named
public class TestPlanItClient {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public HttpResult fetchTestInfo(String baseUrl, String apiKey, String issueKey, String issueId)
            throws IOException, InterruptedException {
        List<String> params = new ArrayList<>();
        if (issueKey != null) {
            params.add("issueKey=" + URLEncoder.encode(issueKey, StandardCharsets.UTF_8));
        }
        if (issueId != null) {
            params.add("issueId=" + URLEncoder.encode(issueId, StandardCharsets.UTF_8));
        }
        String url = baseUrl + "/api/integrations/jira/test-info?" + String.join("&", params);
        return get(url, apiKey);
    }

    public ConnectionTestResult testConnection(String baseUrl, String apiKey) {
        try {
            HttpResult version = get(baseUrl + "/version.json", null);
            if (!version.isOk()) {
                return new ConnectionTestResult(false,
                        "Could not reach TestPlanIt instance (status " + version.status()
                                + "). Please check the URL.");
            }
            String versionLabel = "instance";
            try {
                JsonNode node = MAPPER.readTree(version.body());
                if (node.hasNonNull("version")) {
                    versionLabel = node.get("version").asText();
                }
            } catch (IOException ignored) {
                // non-JSON version.json — keep the generic label
            }

            HttpResult test = get(baseUrl + "/api/integrations/jira/test-connection", apiKey);
            if (test.status() == 401 || test.status() == 403) {
                return new ConnectionTestResult(false,
                        "Instance is reachable but the API key is invalid or expired. "
                                + "Please check your key in Admin > Integrations > Jira.");
            }
            if (!test.isOk()) {
                return new ConnectionTestResult(false,
                        "Connection test returned status " + test.status()
                                + ". Please ensure your TestPlanIt instance is v0.15.4 or later.");
            }
            return new ConnectionTestResult(true,
                    "Successfully connected to TestPlanIt " + versionLabel + " — API key is valid.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new ConnectionTestResult(false, "Connection failed: interrupted");
        } catch (Exception e) {
            return new ConnectionTestResult(false, "Connection failed: " + e.getMessage());
        }
    }

    private HttpResult get(String url, String apiKeyOrNull) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(TIMEOUT)
                .header("Accept", "application/json")
                .GET();
        if (apiKeyOrNull != null) {
            builder.header("X-Forge-Api-Key", apiKeyOrNull);
        }
        HttpResponse<String> response = httpClient.send(builder.build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new HttpResult(response.statusCode(), response.body());
    }
}
