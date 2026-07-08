import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load env vars from a gitignored `.jira-it.env` at the monorepo root, if
 * present, so `pnpm test:jira-contract` / `pnpm test:jira-cloud-contract`
 * work without exporting vars manually. Shared by the DC and Cloud contract
 * suites — both resolve the same file from the same `__contract__`
 * directory, so the candidate paths are identical regardless of which
 * suite calls this.
 *
 * Never overwrites a var already set in `process.env` — this is what lets
 * `JIRA_IT_RUN`/`JIRA_IT_RECORD` (set by the npm scripts via `cross-env`,
 * not meant to live in the env file) win over anything a stray line in the
 * file might set.
 */
export function loadEnvFile() {
  const candidates = [
    resolve(__dirname, "../../../../../.jira-it.env"),
    resolve(__dirname, "../../../../.jira-it.env"),
    resolve(process.cwd(), ".jira-it.env"),
  ];
  for (const p of candidates) {
    try {
      const text = readFileSync(p, "utf8");
      // Split on \r?\n, not just \n: a CRLF file (the common case when the
      // .env is created on Windows) otherwise leaves a trailing \r on every
      // line. JS regex `.` treats \r as a line terminator, so `(.*)$`
      // without the /m flag can never reach it — the match silently fails
      // for every line, no env vars get set, and the suite skips with 0
      // tests instead of erroring, which is exactly what happened here.
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2];
        }
      }
      return;
    } catch {
      /* try next */
    }
  }
}
