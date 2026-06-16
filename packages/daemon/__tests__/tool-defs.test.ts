/**
 * Tests for ALL_TOOL_DEFS — the single source of truth the daemon serves at
 * GET /tools and the forwarder falls back to (#132). The core guarantee: the
 * schema clients are told declares `body` as a required string for save_memory,
 * so a forwarder/daemon can never disagree about it.
 *
 * Runner: tsx --test __tests__/tool-defs.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_TOOL_DEFS } from "../src/tool-defs.js";

interface ToolDef {
  name: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
}

function tool(name: string): ToolDef {
  const t = (ALL_TOOL_DEFS as ToolDef[]).find((d) => d.name === name);
  assert.ok(t, `ALL_TOOL_DEFS must contain ${name}`);
  return t;
}

test("ALL_TOOL_DEFS contains the core memory tools", () => {
  const names = (ALL_TOOL_DEFS as ToolDef[]).map((d) => d.name);
  for (const n of ["recall", "load_memory", "save_memory"]) {
    assert.ok(names.includes(n), `expected tool ${n}`);
  }
});

test("save_memory declares body as a required string (#132 guarantee)", () => {
  const save = tool("save_memory");
  assert.equal(save.inputSchema.properties?.body?.type, "string", "body must be a string property");
  assert.ok(
    save.inputSchema.required?.includes("body"),
    "body must be in the required list — this is exactly the field that arrived undefined in #132",
  );
});

test("every tool def has a name and an object inputSchema", () => {
  for (const d of ALL_TOOL_DEFS as ToolDef[]) {
    assert.equal(typeof d.name, "string");
    assert.ok(d.name.length > 0);
    assert.equal(typeof d.inputSchema, "object");
  }
});

test("tool names are unique (no accidental double-registration)", () => {
  const names = (ALL_TOOL_DEFS as ToolDef[]).map((d) => d.name);
  assert.equal(names.length, new Set(names).size, "duplicate tool name in ALL_TOOL_DEFS");
});
