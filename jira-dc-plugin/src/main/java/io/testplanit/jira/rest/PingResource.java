package io.testplanit.jira.rest;

import com.atlassian.annotations.security.UnrestrictedAccess;
// NOTE: javax.ws.rs, NOT jakarta.ws.rs. On Platform 7 / Jira 10.3 the
// `jakarta.ws.rs:jakarta.ws.rs-api` artifact still ships `javax.ws.rs`
// packages; the jakarta.* package rename lands in a later platform. Do not let
// an IDE "organize imports" rewrite these to jakarta.* — it breaks the build.
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
