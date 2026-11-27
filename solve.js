// Fast drop-in for makefun-diff 1.0.0: returns make.fun's own patch of { old, new }.
// Own implementation, written from scratch for this bounty.
//
// Design (different emphasis from the reference's linked-path search):
//  - Lines are interned to small integers once per case (one shared Map), so every
//    comparison in the search is an int compare on Int32Arrays, not a string compare.
//  - Common prefix / suffix are trimmed on the interned ids first.
//  - Myers' greedy search runs forward storing, per depth d, only the furthest x
//    reached on each diagonal in a flat Int32Array (no per-step path objects), with
//    the reference's exact guards and tie-break (deletion when both reach one point,
//    no move past either text's end). The first (d, k) to reach both ends wins.
//  - The edit script is recovered by backtracking the stored V rows with the same
//    candidate rules, then rendered into the patch with the reference's hunk rules.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** Intern a text's lines (split after every '\n') to ids in the shared table. */
function internLines(text, ids, strs) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const n = last + (parts[last] !== '' ? 1 : 0);
  const out = new Int32Array(n);
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    let id = ids.get(line);
    if (id === undefined) {
      id = strs.length;
      ids.set(line, id);
      strs.push(line);
    }
    out[i] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    let id = ids.get(line);
    if (id === undefined) {
      id = strs.length;
      ids.set(line, id);
      strs.push(line);
    }
    out[last] = id;
  }
  return out;
}

/** The edit runs of the trimmed middle: [{kind, count}] in order. */
function editRuns(A0, B0, n, m) {
  // Padded copies: A[n] = -1 and B[m] = -2 are sentinels no real line id equals,
  // so a snake stops at either text's end on the comparison alone.
  const A = new Int32Array(n + 1);
  A.set(A0);
  A[n] = -1;
  const B = new Int32Array(m + 1);
  B.set(B0);
  B[m] = -2;
  // Per-depth V rows: Vs[d] is an Int32Array of length 2d+1; Vs[d][k+d] = furthest
  // x on diagonal k after d edits and its snake, stored as x+1 (0 = not reached).
  // No per-step path objects are kept.
  const Vs = new Array(n + m + 1);
  let x = 0;
  let y = 0;
  while (A[x] === B[y]) {
    x++;
    y++;
  }
  const v0 = new Int32Array(1);
  v0[0] = x + 1;
  Vs[0] = v0;
  if (x >= n && y >= m) return [{ kind: KEEP, count: x }];

  let D = -1;
  let K = 0;
  outer: for (let d = 1; d <= n + m; d++) {
    const prev = Vs[d - 1];
    const cur = new Int32Array(2 * d + 1);
    Vs[d] = cur;
    // Edge diagonal k = -d: only the insertion candidate (from k+1) exists.
    {
      const k = -d;
      const xa = prev[0] - 1; // prev diagonal k+1 = -d+1 lives at index 0
      const ya = xa - (k + 1);
      if (xa !== -1 && ya - 1 < m) {
        x = xa;
        y = x - k;
        while (A[x] === B[y]) {
          x++;
          y++;
        }
        cur[0] = x + 1;
        if (x >= n && y >= m) {
          D = d;
          K = k;
          break outer;
        }
      }
    }
    // Interior diagonals: both candidates always in range.
    // Running indices: prev index i = k + (d-1), cur index ci = k + d.
    let i = 1;
    let ci = 2;
    for (let k = -d + 2; k <= d - 2; k += 2, i += 2, ci += 2) {
      const xr = prev[i - 1] - 1;
      const xa = prev[i + 1] - 1;
      const canRemove = xr !== -1 && xr < n;
      const ya = xa - (k + 1);
      const canAdd = xa !== -1 && ya - 1 < m;
      if (!canRemove && !canAdd) continue;
      // Tie-break: the candidate further into the old text; the deletion on a tie.
      const byDel = canRemove ? xr : -2;
      const byIns = canAdd ? xa - 1 : -2;
      if (byDel >= byIns) {
        x = xr + 1;
        y = x - k;
      } else {
        x = xa;
        y = x - k;
      }
      while (A[x] === B[y]) {
        x++;
        y++;
      }
      cur[ci] = x + 1;
      if (x >= n && y >= m) {
        D = d;
        K = k;
        break outer;
      }
    }
    // Edge diagonal k = d: only the deletion candidate (from k-1) exists.
    {
      const k = d;
      // Prev index for diagonal k-1 = d-1 is (d-1) + (d-1) = 2d-2.
      const xr = prev[2 * d - 2] - 1;
      if (xr !== -1 && xr < n) {
        x = xr + 1;
        y = x - k;
        while (A[x] === B[y]) {
          x++;
          y++;
        }
        cur[2 * d] = x + 1;
        if (x >= n && y >= m) {
          D = d;
          K = k;
          break outer;
        }
      }
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack the stored V rows with the same candidate rules, collecting the
  // steps (one deletion/insertion per depth) and the snake after each.
  const stepKind = new Int8Array(D + 1);
  const stepSnake = new Int32Array(D + 1);
  stepKind[0] = KEEP;
  stepSnake[0] = Vs[0][0] - 1;
  let k = K;
  for (let d = D; d >= 1; d--) {
    const prev = Vs[d - 1];
    const poff = d - 1;
    const cur = Vs[d];
    const x = cur[k + d] - 1;
    const xr = k - 1 >= -(d - 1) ? prev[k - 1 + poff] - 1 : -1;
    const xa = k + 1 <= d - 1 ? prev[k + 1 + poff] - 1 : -1;
    const canRemove = xr !== -1 && xr < n;
    const ya = xa - (k + 1);
    const canAdd = xa !== -1 && ya - 1 < m;
    const byDel = canRemove ? xr : -2;
    const byIns = canAdd ? xa - 1 : -2;
    if (byDel >= byIns) {
      stepKind[d] = DELETE;
      stepSnake[d] = x - (xr + 1);
      k = k - 1;
    } else {
      stepKind[d] = INSERT;
      stepSnake[d] = x - xa;
      k = k + 1;
    }
  }

  // Forward: merge consecutive runs of one kind.
  const runs = [];
  const push = (kind, count) => {
    if (count <= 0) return;
    const r = runs[runs.length - 1];
    if (r !== undefined && r.kind === kind) r.count += count;
    else runs.push({ kind, count });
  };
  for (let d = 0; d <= D; d++) {
    if (d > 0) push(stepKind[d], 1);
    push(KEEP, stepSnake[d]);
  }
  return runs;
}

/** A line as the patch writes it. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const ids = new Map();
  const strs = [];
  const a = internLines(input.old, ids, strs);
  const b = internLines(input.new, ids, strs);
  const n = a.length;
  const m = b.length;
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = editRuns(
    a.subarray(prefix, n - suffix),
    b.subarray(prefix, m - suffix),
    n - prefix - suffix,
    m - prefix - suffix,
  );
  for (const r of mid) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  if (suffix > 0) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === KEEP) last.count += suffix;
    else runs.push({ kind: KEEP, count: suffix });
  }

  // Change runs, hunks and the patch text: the reference's rules.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', strs[a[at]]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', strs[a[c.o + i]]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', strs[b[c.p + i]]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', strs[a[at]]));
  }
  return out.join('');
}
