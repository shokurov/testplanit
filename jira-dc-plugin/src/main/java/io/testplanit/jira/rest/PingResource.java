package io.testplanit.jira.rest;

import com.atlassian.annotations.security.UnrestrictedAccess;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.util.Map;

@Path("/ping")
@UnrestrictedAccess
public class PingResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response ping() {
        return Response.ok(Map.of("status", "ok")).build();
    }
}
