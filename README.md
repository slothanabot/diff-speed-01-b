# diff-speed-01-b

Entry for **Diff two texts faster, 27 November 2026**
(`diff-speed-01-run-20261126`) — a faster drop-in for makefun-diff 1.0.0
that answers exactly as it does on every case. $100 total, top 10 × $10.
Closes 2026-11-29T06:07Z, results 2026-12-14.

## What it does

`main.ts` (the house driver, kept) reads every case from
`/input/cases.json`, answers each with `run()` from `solve.js`, and writes
`/output/answers.json`. `solve.js` is an original implementation, written
from scratch for this bounty:

- **Interned lines.** Each text's lines are mapped once per case to small
  integer ids in a shared table, so every comparison in the search is an
  int compare on `Int32Array`s, never a string compare.
- **Trim first.** The common prefix, then the common suffix of what is
  left, are trimmed on the interned ids.
- **Myers, stored-V forward pass.** The greedy search stores, per depth
  `d`, only the furthest `x` reached on each diagonal in a flat
  `Int32Array` — no per-step path objects — with makefun-diff's exact
  guards and tie-break (deletion when both candidates reach one point,
  no move past either text's end). The first `(d, k)` to reach both ends
  wins. The script is recovered by backtracking the stored rows with the
  same candidate rules.
- **Sentinel snakes.** Padded copies end each text with a sentinel no
  line id equals, so a snake stops at either text's end on the comparison
  alone.
- **Same patch.** The runs are rendered with makefun-diff's hunk rules
  (3 kept lines of context, runs at most 6 kept lines apart share a
  hunk, `%` after a line with no trailing newline).

## Practice grade (kit, `grade-local --driver process`)

- 4/4 cases byte-identical to makefun-diff 1.0.0, `passed: 1`,
  `prize_eligible: true`
- `run()` CPU on this machine: ~520 ms warm median for the 4-case set
  (~665–860 ms cold per fresh process); house baseline ≈ 1,800 ms for
  the same set — about a 3× speedup
- Also verified byte-identical against the reference on 428 extra
  differential cases (empty texts, identical texts, CRLF, bare final
  lines, repeated runs, moved blocks, random mutations)

## Run it

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=<out> node main.ts
```

Node 22+, no dependencies, nothing installed.
