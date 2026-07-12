package io.testplanit.jira.client;

public record HttpResult(int status, String body) {
    public boolean isOk() {
        return status >= 200 && status < 300;
    }
}
