# Survival — the by-id substrate invariant

**Survival** is the single guarantee every layer above the engine leans on:

> A reference by stable id keeps resolving after the cell is demoted, retired, or
> soft-deleted. Only a **hard delete** removes a cell — and the engine never hard
> deletes as a side effect of ranking, aging, or unpinning.

This is a substrate property, not a feature. It is guaranteed **once at the
bottom** so that no layer above has to re-defend it:

- **facts** — recall ranking. A demoted memory drops in score, not out of existence.
- **state** — the [#142](https://github.com/n0mad-ai/bastra-recall/issues/142)
  pin/floor lifecycle. An expired floor drops back to *ranked*, it never deletes.
- **decisions** — a future citation/audit layer (jugeni-contracts). A citation must
  resolve against a demoted-or-retired cell, or the citation graph rots.

A silent change to any of the rules below would break all three layers at once.
That is why it is pinned by a regression test (see *Enforcement*).

## The contract

| Operation | Effect on the cell | By-id resolution |
|---|---|---|
| **Read / rank** | none | resolves |
| **Demote** (staleness aging) | recall **score** only — the file is byte-identical | resolves |
| **Unpin / retire** (#142 floor release) | drops to *ranked* — never deletes; file byte-identical, ranking identical | resolves |
| **Soft-delete** | file moves to append-only `.bastra/trash/` + a `delete` audit entry is appended | leaves the **active** index; recoverable via restore |
| **Restore** | trash file returns to the vault; the `delete` record stays (append-only) | resolves again |
| **Hard-delete** | the cell is gone | does not resolve — the only operation that ends survival |

Concretely:

- **Stable ids.** `Vault.get(id)` resolves a memory by its frontmatter `id`, independent of file path or score.
- **Demote = score only.** `computeStaleness(...)` returns a multiplier (`fresh` → `stale` → `expired`); aging touches the recall score, never the file and never by-id resolution.
- **Soft-delete = trash + audit, not erase.** `auditedSoftDelete(...)` moves the file under `.bastra/trash/` and appends a `delete` entry to the `AuditLog`. The active index drops the id (`vault.get(id) → undefined`), but the trash file and the audit record persist. `auditedRestore(...)` reindexes it and the id resolves again; the original `delete` record survives the restore because the log is append-only.
- **Unpin ≠ delete.** The #142 floor is **injection-layer-only**: a daemon-side registry (`packages/daemon/src/floors.ts`, persisted at `~/.bastra/floors.json`) decides what the session hook injects as `<pinned-memories>`; the engine score and the vault file are untouched by construction. `release(condition)` returns the memory to ordinary ranked retrieval — it removes a *guarantee* (always-present), not the *memory*. A citation still resolves against it, nothing evaporates; it just stops spending guaranteed context.

## Enforcement

The invariant is a CI gate, not a courtesy:

```
packages/core/__tests__/survival-by-id.test.ts
packages/daemon/__tests__/floors.test.ts   (retire/unpin arm)
```

- `demote` arm — a 200-day-old lesson is demoted (score multiplier `< 1`), yet `vault.get(id)` still resolves and the file is byte-identical.
- `soft-delete` arm — after `auditedSoftDelete`, the id leaves the active index but the trash file + append-only `delete`/`restore` records persist, and a restore brings the id back.
- `retire/unpin` arm — pinned by `packages/daemon/__tests__/floors.test.ts`
  (it lives in the daemon suite because the #142 floor registry is daemon-side
  state and core does not import daemon): floor + `release(condition)` leave the
  vault file **byte-identical** and the engine ranking **identical**
  before/during/after flooring, and `vault.get(id)` resolves throughout —
  drop-to-ranked, never delete. The core file keeps a `test.todo` signpost
  pointing there.

The day any of these operations starts *evaporating* the cell instead of
demoting / unpinning / trashing it, the tests go red.

## Provenance

This contract was hardened in the dev.to threads with **Mike Czerwinski**
(jugeni-contracts, the decision/citation layer) and **Raffaele Zarrelli**
(cowork-os, the govern-surface). Their layers compose on bastra-recall *because*
survival holds at the substrate — turning the promise into a CI break is what makes
it a contract a third party can re-run, rather than something either side has to
remember to preserve. See [#146](https://github.com/n0mad-ai/bastra-recall/issues/146).
