/**
 * #482: the corrupted-arguments diagnosis is for every tool, not just saves.
 *
 * When a client turns its native JSON arguments into legacy XML inside the
 * first multiline string, the sibling parameters never arrive. That is a
 * transport failure — it hits `recall` and `read_document` exactly like
 * `save_memory`, which is only where it was noticed because it has the most
 * parameters. Before this, every other tool still answered with anonymous
 * "received undefined" lines and the model retried into the wall.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/call-corruption.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertCallNotCorrupted,
  callCorruptionMessage,
  detectCallCorruption,
  requiredFieldsOf,
} from "../src/call-corruption.js";
import { TOOL_ARG_EXPECTATIONS } from "../src/tool-defs.js";
import { dispatchApi } from "../src/http-api-routes.js";

/** A `move_document` call the client turned into XML. */
const CORRUPTED_MOVE = {
  id: "doc-1</id><folder_path>Rechnungen</folder_path><title>Beleg</title>",
};

test("every declared tool contributes its own required fields", () => {
  const recall = TOOL_ARG_EXPECTATIONS.get("recall");
  assert.deepEqual(recall?.required, ["query"]);
  assert.equal(recall?.readOnly, true);

  const save = TOOL_ARG_EXPECTATIONS.get("save_memory");
  assert.ok((save?.required.length ?? 0) >= 8, "save_memory keeps its full required list");
  assert.equal(save?.readOnly, false);
  // The point of deriving it: nothing here is hand-maintained.
  assert.ok(TOOL_ARG_EXPECTATIONS.size >= 5, "all tool definitions are covered");
});

test("a corrupted call to a tool other than save_memory gets the same diagnosis", async () => {
  await assert.rejects(
    dispatchApi("save_product_doc", {
      project: "buzz</project><area>hints</area><title>T</title><summary>S</summary><body>B</body>",
    }, { toolDeps: {} as never, documentWriteEnabled: false, ccSessionId: null }),
    (err: Error) =>
      err.message.includes("save_product_doc arguments were corrupted before validation")
      && err.message.includes("caller-side MCP serialization failure")
      && err.message.includes("STOP retrying"),
  );
});

test("the same holds for the other multi-field write tool", () => {
  assert.throws(
    () => assertCallNotCorrupted("save_document", {
      original_path: "/tmp/a.pdf</original_path><title>T</title><tags><item>x</item></tags><category>rechnungen</category>",
    }, TOOL_ARG_EXPECTATIONS),
    /save_document arguments were corrupted before validation/,
  );
});

/**
 * The honest limit of this change, pinned so nobody reads more into it.
 *
 * The detector needs structural tags for at least TWO MISSING required fields
 * — the rule that keeps it from masking real validation errors. A tool with a
 * SINGLE required field can therefore never trigger it, however corrupted the
 * call is: `recall`, `load_memory`, `find_document`, `read_document`,
 * `archive_memory`, `open_document`, `recategorize_document` — including the
 * very tools #482 names as still unhelped. Widening this would mean matching
 * optional properties too, which is a separate decision about false positives,
 * not a fix for this one.
 */
test("tools with a single required field stay out of reach — by construction", () => {
  const oneField = [...TOOL_ARG_EXPECTATIONS.entries()].filter(([, v]) => v.required.length === 1);
  assert.ok(oneField.length > 0);
  for (const [name] of oneField) {
    assert.doesNotThrow(
      () => assertCallNotCorrupted(name, { id: "x</id><query>y</query><scope>z</scope>" }, TOOL_ARG_EXPECTATIONS),
      `${name} cannot be detected with a single required field`,
    );
  }
});

/**
 * Two required fields ARE reachable — the container is any surviving string,
 * not necessarily a required one (`Object.entries(args)`). Pinned because the
 * earlier wording of this file claimed a three-field floor, which promised
 * more than the code delivers (review find, Archie 06.09.).
 */
test("two required fields are reachable when an optional string carries the text", () => {
  const corruption = detectCallCorruption(
    { note: "x</id><folder_path>Rechnungen</folder_path>" },
    ["id", "folder_path"],
  );
  assert.deepEqual(corruption?.swallowed, ["id", "folder_path"]);
  assert.equal(corruption?.container, "note");
});

test("a read tool does not claim that nothing was saved", () => {
  const corruption = detectCallCorruption(
    { query: "a</query><scope>s</scope><type>lesson</type>" },
    ["query", "scope", "type"],
  );
  assert.ok(corruption);
  const message = callCorruptionMessage("recall", corruption!, true);
  assert.match(message, /THE CALL DID NOT RUN/);
  assert.doesNotMatch(message, /NOTHING WAS SAVED/);
});

test("detection stays as narrow as it was — one tag is not enough", () => {
  // Only ONE missing field has a structural tag: a genuine validation error
  // must not be masked by this.
  assert.equal(
    detectCallCorruption({ query: "text with <body>only one</body>" }, ["query", "body", "tags"]),
    null,
  );
  // Nothing missing at all.
  assert.equal(detectCallCorruption({ query: "q", k: 5 }, ["query"]), null);
  // A plain missing field, no XML anywhere: Zod's own error is the right answer.
  assert.equal(detectCallCorruption({ query: "q" }, ["query", "scope", "type"]), null);
  // Not an object.
  assert.equal(detectCallCorruption("string", ["query"]), null);
  // A tool with no required fields can never be corrupted by this shape.
  assert.equal(detectCallCorruption({ a: "<b>x</b><c>y</c>" }, []), null);
});

test("an unknown tool is left to the dispatcher's own 404", () => {
  assert.doesNotThrow(() => assertCallNotCorrupted("not_a_tool", CORRUPTED_MOVE, TOOL_ARG_EXPECTATIONS));
});

test("requiredFieldsOf survives a definition without a schema", () => {
  assert.deepEqual(requiredFieldsOf(undefined), []);
  assert.deepEqual(requiredFieldsOf({ inputSchema: {} }), []);
  assert.deepEqual(requiredFieldsOf({ inputSchema: { required: ["a", 2, "b"] } }), ["a", "b"]);
});
