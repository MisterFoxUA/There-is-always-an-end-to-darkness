/* Рушій судоку: генерація, розвʼязування, оцінка складності.
   Файл не залежить від DOM — його можна запускати і в браузері, і в Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SudokuEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALL = 0x1FF; // бітова маска цифр 1..9

  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const u = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) u.push((br * 3 + r) * 9 + bc * 3 + c);
      UNITS.push(u);
    }
  }

  const UNITS_OF = Array.from({ length: 81 }, () => []);
  UNITS.forEach((u, ui) => u.forEach((i) => UNITS_OF[i].push(ui)));

  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const seen = new Set();
    for (const ui of UNITS_OF[i]) for (const j of UNITS[ui]) if (j !== i) seen.add(j);
    return [...seen];
  });

  const BOX_OF = Array.from({ length: 81 }, (_, i) => ((((i / 9) | 0) / 3) | 0) * 3 + (((i % 9) / 3) | 0));

  function popcount(m) { let n = 0; while (m) { m &= m - 1; n++; } return n; }
  function lowestDigit(m) { return 32 - Math.clz32(m & -m); } // цифра 1..9 з маски

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ───────── Пошук розвʼязків (з перебором) ───────── */

  // limit — скільком розвʼязкам достатньо знайти (1 — розвʼязати, 2 — перевірити єдиність)
  function search(grid, limit, rng) {
    const g = Int8Array.from(grid);
    const rowM = new Int16Array(9), colM = new Int16Array(9), boxM = new Int16Array(9);

    for (let i = 0; i < 81; i++) {
      const v = g[i];
      if (!v) continue;
      const b = 1 << (v - 1);
      const r = (i / 9) | 0, c = i % 9, bx = BOX_OF[i];
      if ((rowM[r] & b) || (colM[c] & b) || (boxM[bx] & b)) return { count: 0, solution: null };
      rowM[r] |= b; colM[c] |= b; boxM[bx] |= b;
    }

    let count = 0, solution = null;

    function rec() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const r = (i / 9) | 0, c = i % 9, bx = BOX_OF[i];
        const cand = ~(rowM[r] | colM[c] | boxM[bx]) & ALL;
        if (cand === 0) return false;
        const n = popcount(cand);
        if (n < bestN) { bestN = n; best = i; bestMask = cand; if (n === 1) break; }
      }
      if (best === -1) {
        count++;
        if (!solution) solution = Array.from(g);
        return count >= limit;
      }
      const r = (best / 9) | 0, c = best % 9, bx = BOX_OF[best];
      const order = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << (d - 1))) order.push(d);
      if (rng) shuffle(order, rng);
      for (const d of order) {
        const b = 1 << (d - 1);
        g[best] = d; rowM[r] |= b; colM[c] |= b; boxM[bx] |= b;
        const stop = rec();
        g[best] = 0; rowM[r] &= ~b; colM[c] &= ~b; boxM[bx] &= ~b;
        if (stop) return true;
      }
      return false;
    }

    rec();
    return { count, solution };
  }

  function solve(grid) { return search(grid, 1).solution; }
  function countSolutions(grid, limit) { return search(grid, limit || 2).count; }

  /* ───────── Логічне розвʼязування (для оцінки складності) ───────── */

  function candidatesOf(g) {
    const cand = new Int16Array(81);
    for (let i = 0; i < 81; i++) {
      if (g[i]) { cand[i] = 0; continue; }
      let used = 0;
      for (const p of PEERS[i]) if (g[p]) used |= 1 << (g[p] - 1);
      cand[i] = ~used & ALL;
    }
    return cand;
  }

  function combinations(arr, k) {
    const out = [];
    const n = arr.length;
    if (n < k) return out;
    const idx = Array.from({ length: k }, (_, i) => i);
    for (;;) {
      out.push(idx.map((i) => arr[i]));
      let p = k - 1;
      while (p >= 0 && idx[p] === n - k + p) p--;
      if (p < 0) break;
      idx[p]++;
      for (let q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
    }
    return out;
  }

  // Повертає { solved, hardest }, де hardest: 1 — одиначки, 2 — обмежені кандидати,
  // 3 — пари й трійки. Якщо цих техік не досить, solved = false.
  function logicalSolve(puzzle) {
    const g = Int8Array.from(puzzle);
    const cand = candidatesOf(g);
    let hardest = 0;
    let empty = 0;
    for (let i = 0; i < 81; i++) if (!g[i]) empty++;

    function place(i, d) {
      g[i] = d; cand[i] = 0; empty--;
      const b = ~(1 << (d - 1));
      for (const p of PEERS[i]) cand[p] &= b;
    }
    function broken() {
      for (let i = 0; i < 81; i++) if (!g[i] && cand[i] === 0) return true;
      return false;
    }

    // Одиначки: у клітинці лишився один кандидат, або цифрі в блоці лишилось одне місце
    function singles() {
      let did = false;
      for (let i = 0; i < 81; i++) {
        if (!g[i] && popcount(cand[i]) === 1) { place(i, lowestDigit(cand[i])); did = true; }
      }
      for (const u of UNITS) {
        for (let d = 1; d <= 9; d++) {
          const b = 1 << (d - 1);
          let spot = -1, n = 0, taken = false;
          for (const i of u) {
            if (g[i] === d) { taken = true; break; }
            if (!g[i] && (cand[i] & b)) { spot = i; n++; }
          }
          if (!taken && n === 1) { place(spot, d); did = true; }
        }
      }
      return did;
    }

    function lockedCandidates() {
      let did = false;
      // цифра в квадраті тримається одного рядка або стовпця
      for (let bx = 0; bx < 9; bx++) {
        const u = UNITS[18 + bx];
        for (let d = 1; d <= 9; d++) {
          const b = 1 << (d - 1);
          if (u.some((i) => g[i] === d)) continue;
          const spots = u.filter((i) => !g[i] && (cand[i] & b));
          if (spots.length < 2) continue;
          const rows = new Set(spots.map((i) => (i / 9) | 0));
          const cols = new Set(spots.map((i) => i % 9));
          if (rows.size === 1) {
            const r = [...rows][0];
            for (const i of UNITS[r]) {
              if (BOX_OF[i] !== bx && !g[i] && (cand[i] & b)) { cand[i] &= ~b; did = true; }
            }
          }
          if (cols.size === 1) {
            const c = [...cols][0];
            for (const i of UNITS[9 + c]) {
              if (BOX_OF[i] !== bx && !g[i] && (cand[i] & b)) { cand[i] &= ~b; did = true; }
            }
          }
        }
      }
      // цифра в рядку або стовпці тримається одного квадрата
      for (let li = 0; li < 18; li++) {
        const u = UNITS[li];
        for (let d = 1; d <= 9; d++) {
          const b = 1 << (d - 1);
          if (u.some((i) => g[i] === d)) continue;
          const spots = u.filter((i) => !g[i] && (cand[i] & b));
          if (spots.length < 2) continue;
          const boxes = new Set(spots.map((i) => BOX_OF[i]));
          if (boxes.size !== 1) continue;
          const bx = [...boxes][0];
          for (const i of UNITS[18 + bx]) {
            if (!spots.includes(i) && !g[i] && (cand[i] & b)) { cand[i] &= ~b; did = true; }
          }
        }
      }
      return did;
    }

    function subsets() {
      let did = false;
      for (const u of UNITS) {
        const open = u.filter((i) => !g[i]);
        // відкриті пари й трійки
        for (let size = 2; size <= 3; size++) {
          const cells = open.filter((i) => popcount(cand[i]) >= 2 && popcount(cand[i]) <= size);
          for (const set of combinations(cells, size)) {
            let union = 0;
            for (const i of set) union |= cand[i];
            if (popcount(union) !== size) continue;
            for (const i of open) {
              if (set.includes(i)) continue;
              if (cand[i] & union) { cand[i] &= ~union; did = true; }
            }
          }
        }
        // приховані пари
        const spots = {};
        for (let d = 1; d <= 9; d++) {
          const b = 1 << (d - 1);
          if (u.some((i) => g[i] === d)) continue;
          spots[d] = open.filter((i) => cand[i] & b);
        }
        const digits = Object.keys(spots).map(Number).filter((d) => spots[d].length === 2);
        for (const [d1, d2] of combinations(digits, 2)) {
          const a = spots[d1], b2 = spots[d2];
          if (a[0] !== b2[0] || a[1] !== b2[1]) continue;
          const mask = (1 << (d1 - 1)) | (1 << (d2 - 1));
          for (const i of a) if (cand[i] & ~mask) { cand[i] &= mask; did = true; }
        }
      }
      return did;
    }

    for (;;) {
      if (empty === 0) return { solved: true, hardest: hardest || 1 };
      if (broken()) return { solved: false, hardest: hardest || 1 };
      if (singles()) { hardest = Math.max(hardest, 1); continue; }
      if (lockedCandidates()) { hardest = Math.max(hardest, 2); continue; }
      if (subsets()) { hardest = Math.max(hardest, 3); continue; }
      return { solved: false, hardest: hardest || 1 };
    }
  }

  // 1 — легко, 2 — середньо, 3 — складно, 4 — потрібні глибші техніки
  function rate(puzzle) {
    const r = logicalSolve(puzzle);
    return r.solved ? r.hardest : 4;
  }

  /* ───────── Генерація ───────── */

  const EMPTY = new Array(81).fill(0);

  // level — рівень, який показуємо; min/max — які рівні приймаємо;
  // clues — до скількох підказок дотягуємо, щоб задача не була голою
  const LEVELS = {
    easy:   { level: 1, min: 1, max: 1, clues: 36 },
    medium: { level: 2, min: 2, max: 2, clues: 30 },
    hard:   { level: 3, min: 3, max: 4, clues: 30 },
    expert: { level: 4, min: 4, max: 4, clues: 23 }
  };

  function fullGrid(rng) { return search(EMPTY, 1, rng).solution; }

  // Прибирає якнайбільше клітинок, поки розвʼязок залишається єдиним (симетрично на 180°)
  function dig(solution, rng) {
    const puzzle = solution.slice();
    const removed = [];
    for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k), rng)) {
      const j = 80 - i;
      if (!puzzle[i] && !puzzle[j]) continue;
      const a = puzzle[i], b = puzzle[j];
      puzzle[i] = 0; puzzle[j] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        if (a) removed.push(i);
        if (b && j !== i) removed.push(j);
      } else { puzzle[i] = a; puzzle[j] = b; }
    }
    return { puzzle, removed };
  }

  // Повернена підказка ніколи не робить задачу складнішою, тож складність підганяємо
  // у два кроки: спускаємось у потрібний діапазон рівнів, а потім додаємо підказки,
  // які з цього діапазону не виводять.
  function tune(puzzle, removed, solution, spec, rng) {
    let level = rate(puzzle);
    let neutral = 0;

    while (level > spec.max) {
      shuffle(removed, rng);
      let pick = -1, kind = 0; // 3 — потрапили в діапазон, 2 — крок вниз, 1 — без зміни
      for (let k = 0; k < removed.length; k++) {
        const i = removed[k];
        puzzle[i] = solution[i];
        const next = rate(puzzle);
        puzzle[i] = 0;
        if (next >= spec.min && next <= spec.max) { pick = i; kind = 3; break; }
        if (next > spec.max && next < level) { if (kind < 2) { pick = i; kind = 2; } }
        else if (next === level && kind < 1) { pick = i; kind = 1; }
      }
      if (pick < 0) break;
      if (kind === 1 && ++neutral > 12) break;
      puzzle[pick] = solution[pick];
      removed.splice(removed.indexOf(pick), 1);
      level = rate(puzzle);
    }

    let clues = puzzle.filter(Boolean).length;
    let guard = 0;
    while (clues < spec.clues && removed.length && guard++ < 80) {
      shuffle(removed, rng);
      let pick = -1, exact = false;
      for (let k = 0; k < removed.length; k++) {
        const i = removed[k];
        puzzle[i] = solution[i];
        const next = rate(puzzle);
        puzzle[i] = 0;
        if (next < spec.min || next > spec.max) continue;
        pick = i;
        if (next === spec.level) { exact = true; break; } // тягнемось до заявленого рівня
      }
      if (pick < 0) break;
      puzzle[pick] = solution[pick];
      removed.splice(removed.indexOf(pick), 1);
      clues++;
      level = exact ? spec.level : rate(puzzle);
    }
    return level;
  }

  function now() {
    return (typeof performance === 'object' && performance.now) ? performance.now() : Date.now();
  }

  function generate(difficulty, opts) {
    opts = opts || {};
    const key = LEVELS[difficulty] ? difficulty : 'easy';
    const spec = LEVELS[key];
    const rng = opts.rng || (opts.seed != null ? mulberry32(opts.seed) : Math.random);
    const budget = opts.budget || 4000;
    const attempts = opts.attempts || 30;
    const t0 = now();
    let best = null;

    for (let a = 0; a < attempts; a++) {
      const solution = fullGrid(rng);
      const { puzzle, removed } = dig(solution, rng);
      const level = tune(puzzle, removed, solution, spec, rng);
      const miss = (level >= spec.min && level <= spec.max)
        ? 0
        : Math.min(Math.abs(level - spec.min), Math.abs(level - spec.max));
      if (!best || miss < best.miss) {
        best = { puzzle, solution, level, miss, clues: puzzle.filter(Boolean).length };
      }
      if (miss === 0) break;
      if (now() - t0 > budget) break;
    }

    return {
      difficulty: key,
      puzzle: best.puzzle,
      solution: best.solution,
      clues: best.clues,
      level: best.level,
      ms: Math.round(now() - t0)
    };
  }

  /* ───────── Дрібні помічники для інтерфейсу ───────── */

  // Індекси клітинок, які повторюються у своєму рядку, стовпці або квадраті
  function conflicts(values) {
    const bad = new Set();
    for (const u of UNITS) {
      const seen = new Map();
      for (const i of u) {
        const v = values[i];
        if (!v) continue;
        if (seen.has(v)) { bad.add(i); bad.add(seen.get(v)); }
        else seen.set(v, i);
      }
    }
    return bad;
  }

  function isComplete(values) {
    for (let i = 0; i < 81; i++) if (!values[i]) return false;
    return conflicts(values).size === 0;
  }

  return {
    UNITS, PEERS, UNITS_OF, BOX_OF,
    generate, solve, countSolutions, rate, logicalSolve, conflicts, isComplete,
    mulberry32, LEVELS
  };
});
