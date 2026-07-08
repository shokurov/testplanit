import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "vitest";

/**
 * Recording fetch wrapper shared by the Jira DC and Jira Cloud contract
 * suites.
 *
 * Wraps `globalThis.fetch` and, when recording is enabled, writes one
 * fixture file per recorded request/response pair to
 * `__fixtures__/<fixturesSubdir>/<slugified-test-name>/<name>.json`
 * (`fixturesSubdir` is `"jira-dc"` or `"jira-cloud"`, passed by the
 * caller so each suite's recordings land in its own tree). Fixtures
 * contain: method, url, request headers (secrets redacted), request body,
 * status, and response body. Secrets (Authorization, PAT, password) are
 * redacted in both headers and bodies before anything is written to disk.
 *
 * Fixtures are namespaced by the full test name (via
 * `expect.getState().currentTestName`, which includes every parent
 * `describe` block) — NOT just a flat `call-000.json` counter. The suite
 * runs each test twice (once per auth scheme), and previously every test's
 * fixtures overwrote the previous test's since the counter reset to 0 on
 * every `installRecorder()` call — only whichever test happened to run
 * last ever survived to disk. Namespacing by test name means every test's
 * recordings are preserved independently.
 *
 * The wrapper is installed per-test via `installRecorder()` and removed in
 * teardown. It does NOT mutate the real fetch semantics — requests still go
 * to the live instance.
 *
 * Writing to disk is a separate opt-in from running the suite: `stop()`
 * only flushes fixtures when `JIRA_IT_RECORD=1` is set. Without it, a
 * contract run still exercises the live instance and verifies behavior,
 * but `__fixtures__/` is left untouched — re-recording is a deliberate,
 * reviewable act, not a side effect of every local run.
 */

interface RecordedFixture {
  name: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  recordedAt: string;
}

const FIXTURES_ROOT = resolve(__dirname, "__fixtures__");

// Patterns whose values must never reach disk.
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-forge-api-key",
]);
const SECRET_BODY_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /"[A-Za-z0-9_]*[Tt]oken"\s*:\s*"[^"]*"/g,
  /"password"\s*:\s*"[^"]*"/g,
];

function redactHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_NAMES.has(k.toLowerCase())
      ? "<redacted>"
      : v;
  }
  return out;
}

function redactBody(body: unknown): unknown {
  if (typeof body === "string") {
    let s = body;
    for (const re of SECRET_BODY_PATTERNS) {
      s = s.replace(re, (m) =>
        m.startsWith("Bearer") ? "Bearer <redacted>" : m
      );
    }
    return s;
  }
  if (body && typeof body === "object") {
    try {
      const json = JSON.stringify(body);
      let s = json;
      for (const re of SECRET_BODY_PATTERNS) {
        s = s.replace(re, (m) =>
          m.startsWith("Bearer") ? "Bearer <redacted>" : m
        );
      }
      return JSON.parse(s);
    } catch {
      return body;
    }
  }
  return body;
}

export interface Recorder {
  /** Stop recording and flush all fixtures to disk. */
  stop: () => void;
  /** Names of fixtures written so far. */
  written: string[];
}

/** Turn a full test name (with " > "-joined describe path) into a
 * filesystem-safe directory name. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "unnamed-test";
}

export function installRecorder(fixturesSubdir: "jira-dc" | "jira-cloud"): Recorder {
  const realFetch = globalThis.fetch;
  const recorded: RecordedFixture[] = [];
  let counter = 0;
  // Read once at install time — installRecorder() is called from a
  // beforeEach, so the current test is active and its full name (this
  // test + every parent describe block) is available.
  const slug = slugify(expect.getState().currentTestName ?? "unnamed-test");

  const wrappedFetch: typeof fetch = async (
    input: any,
    init?: any
  ): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input?.url ?? String(input);
    const method = (init?.method || (input?.method) || "GET").toUpperCase();
    const reqHeaders: Record<string, string> = {};
    const rawHeaders = init?.headers || input?.headers;
    if (rawHeaders) {
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v: string, k: string) => {
          reqHeaders[k] = v;
        });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) reqHeaders[k] = String(v);
      } else {
        for (const [k, v] of Object.entries(rawHeaders)) {
          reqHeaders[k] = String(v);
        }
      }
    }
    const reqBodyRaw = init?.body;
    let reqBodyParsed: unknown = undefined;
    if (reqBodyRaw && typeof reqBodyRaw === "string") {
      try {
        reqBodyParsed = JSON.parse(reqBodyRaw);
      } catch {
        reqBodyParsed = reqBodyRaw;
      }
    }

    const response = await realFetch(input, init);
    const status = response.status;
    const statusText = response.statusText;

    // Clone the response so the caller can still consume it.
    let resBody: unknown = undefined;
    try {
      const clone = response.clone();
      const text = await clone.text();
      try {
        resBody = JSON.parse(text);
      } catch {
        resBody = text.slice(0, 2000);
      }
    } catch {
      resBody = "<unavailable>";
    }

    const name = `call-${String(counter++).padStart(3, "0")}`;
    recorded.push({
      name,
      request: {
        method,
        url,
        headers: redactHeaders(reqHeaders),
        body: redactBody(reqBodyParsed),
      },
      response: { status, statusText, body: redactBody(resBody) },
      recordedAt: new Date().toISOString(),
    });

    return response;
  };

  globalThis.fetch = wrappedFetch;

  return {
    written: [],
    stop: () => {
      globalThis.fetch = realFetch;
      if (process.env.JIRA_IT_RECORD !== "1") return;
      const dir = join(FIXTURES_ROOT, fixturesSubdir, slug);
      mkdirSync(dir, { recursive: true });
      for (const fx of recorded) {
        const file = join(dir, `${fx.name}.json`);
        writeFileSync(file, JSON.stringify(fx, null, 2) + "\n", "utf8");
      }
    },
  };
}
