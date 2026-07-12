package io.testplanit.jira.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;

class TestPlanItClientTest {

    private HttpServer server;
    private String baseUrl;
    private final Map<String, String> seenHeaders = new ConcurrentHashMap<>();
    private final Map<String, String> seenQueries = new ConcurrentHashMap<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void respond(String path, int status, String body) {
        server.createContext(path, exchange -> {
            seenHeaders.put(path, String.valueOf(exchange.getRequestHeaders().getFirst("X-Forge-Api-Key")));
            seenQueries.put(path, String.valueOf(exchange.getRequestURI().getRawQuery()));
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
    }

    @Test
    void fetchTestInfoSendsKeyAndEncodedParams() throws Exception {
        respond("/api/integrations/jira/test-info", 200, "{\"testCases\":[]}");
        TestPlanItClient client = new TestPlanItClient();

        HttpResult result = client.fetchTestInfo(baseUrl, "the-key", "DEMO-1", "10001");

        assertThat(result.status()).isEqualTo(200);
        assertThat(result.body()).isEqualTo("{\"testCases\":[]}");
        assertThat(seenHeaders.get("/api/integrations/jira/test-info")).isEqualTo("the-key");
        assertThat(seenQueries.get("/api/integrations/jira/test-info"))
                .contains("issueKey=DEMO-1").contains("issueId=10001");
    }

    @Test
    void fetchTestInfoOmitsNullParams() throws Exception {
        respond("/api/integrations/jira/test-info", 200, "{}");
        TestPlanItClient client = new TestPlanItClient();

        client.fetchTestInfo(baseUrl, "k", "DEMO-2", null);

        assertThat(seenQueries.get("/api/integrations/jira/test-info"))
                .contains("issueKey=DEMO-2").doesNotContain("issueId");
    }

    @Test
    void testConnectionHappyPath() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 200, "{\"ok\":true}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "the-key");

        assertThat(result.success()).isTrue();
        assertThat(result.message()).contains("0.41.3");
        assertThat(seenHeaders.get("/api/integrations/jira/test-connection")).isEqualTo("the-key");
    }

    @Test
    void testConnectionUnreachableInstance() {
        // no /version.json context registered -> 404
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("Could not reach TestPlanIt instance");
    }

    @Test
    void testConnectionInvalidKey() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 401, "{}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "bad");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("API key is invalid or expired");
    }

    @Test
    void testConnectionOtherErrorStatus() {
        respond("/version.json", 200, "{\"version\":\"0.41.3\"}");
        respond("/api/integrations/jira/test-connection", 500, "{}");
        TestPlanItClient client = new TestPlanItClient();

        ConnectionTestResult result = client.testConnection(baseUrl, "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("status 500");
    }

    @Test
    void testConnectionNetworkErrorIsCaught() {
        TestPlanItClient client = new TestPlanItClient();

        // Port 1 on localhost: connection refused.
        ConnectionTestResult result = client.testConnection("http://127.0.0.1:1", "k");

        assertThat(result.success()).isFalse();
        assertThat(result.message()).contains("Connection failed");
    }
}
