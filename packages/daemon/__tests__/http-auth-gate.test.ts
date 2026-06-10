/**
 * Tests für die Browser-Bridge-Härtung des HTTP-Servers: Origin-Gate,
 * Token-Pflicht für Browser-Requests und die CORS-Allowlist.
 *
 * Kern-Bedrohungsmodell: Der Browser des Users läuft auf 127.0.0.1 — über die
 * TCP-Quelle nicht von der CLI unterscheidbar. Nur der Origin-Header trennt eine
 * (potenziell fremde) Website von einem lokalen Tool. Darum: Origin gesetzt =
 * Allowlist + Token Pflicht (auch loopback); kein Origin = loopback-skip gilt.
 *
 * Runner: `tsx --test __tests__/http-auth-gate.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCorsOrigin, gateApiRequest, safeEqual, isLoopbackHost } from "../src/http.js";

const SITE = "https://bastra.io";
const TOKEN = "secret-token";

// ── resolveCorsOrigin ────────────────────────────────────────────────
test("resolveCorsOrigin: '*' reflects the caller's origin (or '*' when none)", () => {
  assert.equal(resolveCorsOrigin(SITE, ["*"]), SITE);
  assert.equal(resolveCorsOrigin(undefined, ["*"]), "*");
});

test("resolveCorsOrigin: allowlist reflects only listed origins, else null", () => {
  assert.equal(resolveCorsOrigin(SITE, [SITE]), SITE);
  assert.equal(resolveCorsOrigin("https://evil.com", [SITE]), null);
  assert.equal(resolveCorsOrigin(undefined, [SITE]), null); // no origin, not in list
});

// ── gateApiRequest: local tools (no Origin) ──────────────────────────
test("gate: no Origin + loopback-skip → 200 without token (CLI/forwarder path)", () => {
  assert.equal(
    gateApiRequest({
      reqOrigin: undefined,
      allowedOrigin: null,
      isLoopback: true,
      authHeader: "",
      apiToken: TOKEN,
      loopbackSkip: true,
    }),
    200,
  );
});

test("gate: no Origin, non-loopback, token set → 401 without correct Bearer", () => {
  const base = {
    reqOrigin: undefined,
    allowedOrigin: null,
    isLoopback: false,
    apiToken: TOKEN,
    loopbackSkip: true,
  };
  assert.equal(gateApiRequest({ ...base, authHeader: "" }), 401);
  assert.equal(gateApiRequest({ ...base, authHeader: `Bearer ${TOKEN}` }), 200);
});

test("gate: no Origin, loopback-skip OFF, token set → token enforced even on loopback", () => {
  const base = {
    reqOrigin: undefined,
    allowedOrigin: null,
    isLoopback: true,
    apiToken: TOKEN,
    loopbackSkip: false,
  };
  assert.equal(gateApiRequest({ ...base, authHeader: "" }), 401);
  assert.equal(gateApiRequest({ ...base, authHeader: `Bearer ${TOKEN}` }), 200);
});

// ── gateApiRequest: browser requests (Origin present) ────────────────
test("gate: browser, allowed origin + correct token → 200 (even over loopback)", () => {
  assert.equal(
    gateApiRequest({
      reqOrigin: SITE,
      allowedOrigin: SITE,
      isLoopback: true,
      authHeader: `Bearer ${TOKEN}`,
      apiToken: TOKEN,
      loopbackSkip: true, // must NOT exempt a browser request
    }),
    200,
  );
});

test("gate: browser, allowed origin, wrong/missing token → 401", () => {
  const base = {
    reqOrigin: SITE,
    allowedOrigin: SITE,
    isLoopback: true,
    apiToken: TOKEN,
    loopbackSkip: true,
  };
  assert.equal(gateApiRequest({ ...base, authHeader: "" }), 401);
  assert.equal(gateApiRequest({ ...base, authHeader: "Bearer wrong" }), 401);
});

test("gate: browser, origin NOT on allowlist → 403 regardless of token", () => {
  assert.equal(
    gateApiRequest({
      reqOrigin: "https://evil.com",
      allowedOrigin: null, // resolveCorsOrigin rejected it
      isLoopback: true,
      authHeader: `Bearer ${TOKEN}`,
      apiToken: TOKEN,
      loopbackSkip: true,
    }),
    403,
  );
});

test("gate: browser, allowed origin but NO token issued → 401 (secure by default)", () => {
  assert.equal(
    gateApiRequest({
      reqOrigin: SITE,
      allowedOrigin: SITE,
      isLoopback: true,
      authHeader: "",
      apiToken: "", // daemon has no token → browser clients can't get in
      loopbackSkip: true,
    }),
    401,
  );
});

// ── safeEqual: timing-safe Token-Vergleich ───────────────────────────
test("safeEqual: equal true; different content or length false", () => {
  assert.equal(safeEqual(`Bearer ${TOKEN}`, `Bearer ${TOKEN}`), true);
  assert.equal(safeEqual("Bearer secret-tokeX", `Bearer ${TOKEN}`), false);
  assert.equal(safeEqual("", `Bearer ${TOKEN}`), false);
});

// ── isLoopbackHost: DNS-Rebinding-Gate für token-lose Endpoints ──────
test("isLoopbackHost: loopback hosts pass, rebound domains do not", () => {
  assert.equal(isLoopbackHost("127.0.0.1:6723", []), true);
  assert.equal(isLoopbackHost("localhost:6723", []), true);
  assert.equal(isLoopbackHost("LOCALHOST", []), true);
  assert.equal(isLoopbackHost("[::1]:6723", []), true);
  // HTTP/1.0-CLIs ohne Host-Header — Rebinding trägt immer einen.
  assert.equal(isLoopbackHost(undefined, []), true);
  assert.equal(isLoopbackHost("attacker.example:6723", []), false);
  assert.equal(isLoopbackHost("attacker.example", []), false);
});

test("isLoopbackHost: BASTRA_ALLOWED_HOSTS entries pass (tunnel escape hatch)", () => {
  assert.equal(isLoopbackHost("tunnel.example.com", ["tunnel.example.com"]), true);
  assert.equal(isLoopbackHost("tunnel.example.com:443", ["tunnel.example.com"]), true);
  assert.equal(isLoopbackHost("other.example.com", ["tunnel.example.com"]), false);
});
