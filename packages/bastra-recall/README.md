# bastra-recall

Persistent **recall memory** for AI coding agents — Claude Code, Claude Desktop, and Cursor. This package is a thin launcher that installs and wires up bastra-recall across every MCP-capable client with one command.

## Install

```bash
# zero-install, one-off:
npx bastra-recall install all

# or install the CLI globally:
npm install -g bastra-recall
bastra install all
```

Both expose the `bastra` CLI. After installing, restart your AI client.

- `bastra install all` — register the MCP server, Skill, and hooks across Claude Code, Claude Desktop, and Cursor.
- `bastra doctor` — check / repair registrations.
- `bastra uninstall all` — remove everything again.

The CLI itself ships in [`@bastra-recall/daemon`](https://www.npmjs.com/package/@bastra-recall/daemon); this package just re-exports its `bastra` entry point under the unscoped name.

## Requirements

macOS (Apple Silicon) today. Node 22+. Semantic recall is opt-in (BM25 is the default); set `BASTRA_EMBEDDING_PROVIDER=ollama` to enable embeddings.

Full docs & source: <https://github.com/n0mad-ai/bastra-recall>

MIT © Daniel Nevoigt
