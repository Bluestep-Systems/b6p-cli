import { Err, gatewayErrorFor, redactToken } from "@bluestep-systems/b6p-core";
import type { GatewayClient } from "@bluestep-systems/b6p-core";

/**
 * Registering and changing global knowledge bases: `POST /api/v1/knowledge-bases` and
 * `PATCH /api/v1/knowledge-bases/{id}` (scope `kb:manage`).
 *
 * HUMAN-REVIEW-NEEDED: this lives in b6p-cli, not b6p-core, because core's `GatewayClient.request()` returns the
 * body only, and PATCH needs the `ETag` of a `GET /{id}` as its `If-Match` (the gateway answers `428` without
 * one). It reuses core's token handling and error mapping (`authHeadersFor`, `gatewayErrorFor`) and repeats the
 * client's rules: the gateway's origin only, redirects never followed, a timeout, the token never in a message.
 * Once core returns response headers (or grows `GatewayKb.create` / `update`), move it there and delete this file.
 * @lastreviewed null
 */

/** How long one request may take before it counts as the gateway being unavailable. */
const TIMEOUT_MS = 30_000;

/**
 * What `--access` may say. The gateway's `access` is `{"kind": "public" | "private"}`; a kind that carries a
 * permission object may follow, so an answer this version does not know is shown as `unknown`, never as public.
 * @lastreviewed null
 */
export type KbAccess = "public" | "private";

/**
 * A global knowledge base as the admin routes describe it. `access` is `null` when the gateway did not say
 * (one that predates public knowledge bases), and `"unknown"` for a kind this version does not know.
 * @lastreviewed null
 */
export interface KbDetail {
  id: string;
  ref: string;
  name: string;
  title: string;
  liveBranch: string;
  gitUrl: string;
  access: KbAccess | "unknown" | null;
}

/**
 * The fetch signature used; matches `globalThis.fetch`.
 * @lastreviewed null
 */
export type AdminFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * The slice of core's gateway client these calls use.
 * @lastreviewed null
 */
export type AdminClient = Pick<GatewayClient, "origin" | "authHeadersFor">;

/**
 * Parse a `--access` value. `undefined` is "not given".
 * @lastreviewed null
 */
export function parseAccess(
  raw: string | undefined
): { ok: true; access: KbAccess | undefined } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true, access: undefined };
  }
  if (raw === "public" || raw === "private") {
    return { ok: true, access: raw };
  }
  return { ok: false, message: `--access ${raw} is not understood. Use public or private.` };
}

/**
 * The warning shown before a knowledge base is made public.
 * @lastreviewed null
 */
export function publicWarning(name: string): string {
  return `Anyone on the internet will be able to read every file in the live branch of ${name}, with no sign-in. Anything already in it becomes public.`;
}

/**
 * The create request's body: only what was given, so the gateway's defaults (title, `master`, private) apply.
 * @lastreviewed null
 */
export function createBody(
  name: string,
  opts: { title?: string; liveBranch?: string; access?: KbAccess }
): Record<string, unknown> {
  return {
    name,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.liveBranch === undefined ? {} : { liveBranch: opts.liveBranch }),
    ...(opts.access === undefined ? {} : { access: { kind: opts.access } }),
  };
}

/**
 * The change request's body: the fields given, all in one PATCH.
 * @lastreviewed null
 */
export function changeBody(opts: { title?: string; liveBranch?: string; access?: KbAccess }): Record<string, unknown> {
  return {
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.liveBranch === undefined ? {} : { liveBranch: opts.liveBranch }),
    ...(opts.access === undefined ? {} : { access: { kind: opts.access } }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check a detail body and return it typed. Throws `GatewayUnexpectedResponseError` naming the field, never a value.
 * @lastreviewed null
 */
export function parseDetail(body: unknown, what: string, status: number): KbDetail {
  const bad = (field: string): Err.GatewayUnexpectedResponseError =>
    new Err.GatewayUnexpectedResponseError(`${what}: the answer has a missing or malformed "${field}".`, status, null);
  if (!isRecord(body)) {
    throw bad("body");
  }
  const text = (field: string): string => {
    const value = body[field];
    if (typeof value !== "string" || value.length === 0) {
      throw bad(field);
    }
    return value;
  };
  let access: KbDetail["access"] = null;
  if (body.access !== undefined) {
    const kind = isRecord(body.access) ? body.access.kind : undefined;
    // Lower case on purpose: the REST form is "public"/"private" (GraphQL's enum is upper case).
    access = kind === "public" || kind === "private" ? kind : "unknown";
  }
  return {
    id: text("id"),
    ref: text("ref"),
    name: text("name"),
    title: text("title"),
    liveBranch: text("liveBranch"),
    gitUrl: text("gitUrl"),
    access,
  };
}

interface AdminResponse {
  status: number;
  etag: string | null;
  body: unknown;
}

async function send(
  client: AdminClient,
  fetchFn: AdminFetch,
  method: string,
  path: string,
  options: { body?: Record<string, unknown>; ifMatch?: string } = {}
): Promise<AdminResponse> {
  const origin = await client.origin();
  const url = new URL(path, origin).toString();
  const what = `${method} ${path}`;
  const auth = await client.authHeadersFor(url);
  const token = Object.values(auth)[0]?.replace(/^Bearer /i, "");
  const headers: Record<string, string> = { ...auth, Accept: "application/json" };
  if (options.ifMatch !== undefined) {
    headers["If-Match"] = options.ifMatch;
  }
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  init.signal = controller.signal;
  let response: Response;
  let text: string;
  try {
    response = await fetchFn(url, init);
    text = await response.text();
  } catch (error) {
    const why = controller.signal.aborted
      ? `no answer within ${TIMEOUT_MS} ms`
      : `the request failed (${redactToken(error instanceof Error ? error.message : String(error), token)})`;
    throw new Err.GatewayUnavailableError(`${what}: the gateway could not be reached: ${why}.`, null, null);
  } finally {
    clearTimeout(timer);
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new Err.GatewayUnexpectedResponseError(
      `${what}: the gateway answered with a redirect (${response.status}), which was not followed.`,
      response.status,
      "redirect-refused"
    );
  }
  if (!response.ok) {
    throw gatewayErrorFor(response.status, text, what, token);
  }
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Err.GatewayUnexpectedResponseError(
        `${what}: the gateway answered ${response.status} with a body that is not JSON.`,
        response.status,
        null
      );
    }
  }
  return { status: response.status, etag: response.headers.get("ETag"), body };
}

const KBS = "/api/v1/knowledge-bases";

/**
 * Register a global knowledge base (`POST`), which creates its repository too.
 *
 * @throws {Err.GatewayError} a subclass for any gateway failure
 * @lastreviewed null
 */
export async function createKnowledgeBase(
  client: AdminClient,
  fetchFn: AdminFetch,
  name: string,
  opts: { title?: string; liveBranch?: string; access?: KbAccess }
): Promise<KbDetail> {
  const r = await send(client, fetchFn, "POST", KBS, { body: createBody(name, opts) });
  return parseDetail(r.body, `POST ${KBS}`, r.status);
}

/**
 * The knowledge base as it is now, and the version (`ETag`) a change must name.
 *
 * @throws {Err.GatewayError} a subclass for any gateway failure
 * @lastreviewed null
 */
export async function readKnowledgeBase(
  client: AdminClient,
  fetchFn: AdminFetch,
  id: string
): Promise<{ detail: KbDetail; etag: string }> {
  const path = `${KBS}/${encodeURIComponent(id)}`;
  const r = await send(client, fetchFn, "GET", path);
  if (r.etag === null) {
    throw new Err.GatewayUnexpectedResponseError(
      `GET ${path}: the answer carries no ETag to change it against.`,
      r.status,
      null
    );
  }
  return { detail: parseDetail(r.body, `GET ${path}`, r.status), etag: r.etag };
}

/**
 * Change a knowledge base (`PATCH`, one request for every given field) as of `etag`.
 *
 * @throws {Err.GatewayError} a subclass for any gateway failure (`412` if it changed since `etag`)
 * @lastreviewed null
 */
export async function changeKnowledgeBase(
  client: AdminClient,
  fetchFn: AdminFetch,
  id: string,
  etag: string,
  opts: { title?: string; liveBranch?: string; access?: KbAccess }
): Promise<KbDetail> {
  const path = `${KBS}/${encodeURIComponent(id)}`;
  const r = await send(client, fetchFn, "PATCH", path, { body: changeBody(opts), ifMatch: etag });
  return parseDetail(r.body, `PATCH ${path}`, r.status);
}

/**
 * The lines printed after a create or change.
 * @lastreviewed null
 */
export function describeDetail(d: KbDetail): string {
  const access =
    d.access === null
      ? "not reported (the gateway predates public knowledge bases)"
      : d.access === "unknown"
        ? "a kind this version does not know; treat it as private"
        : d.access;
  return [`  ref:    ${d.ref}`, `  title:  ${d.title}`, `  branch: ${d.liveBranch}`, `  access: ${access}`].join("\n");
}
