import assert from "node:assert/strict";
import test from "node:test";
import { SERVER_INSTRUCTIONS } from "../src/mcp-instructions.ts";

test("MCP instructions keep Recall model-gated and save human-authorized", () => {
  assert.match(SERVER_INSTRUCTIONS, /explicitly asks for memory or history/i);
  assert.match(SERVER_INSTRUCTIONS, /named durable fact.*absent/i);
  assert.match(SERVER_INSTRUCTIONS, /live source first/i);
  assert.match(SERVER_INSTRUCTIONS, /Never save memory automatically/i);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /without being asked/i);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /At the start of a conversation/i);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /before acting on a task/i);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /save it via `save_memory` immediately/i);
});
