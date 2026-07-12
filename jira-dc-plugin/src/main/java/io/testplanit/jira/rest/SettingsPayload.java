package io.testplanit.jira.rest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Request body for PUT /settings and POST /settings/test. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class SettingsPayload {
    public String instanceUrl;
    public String apiKey;
}
