/* Стан однієї партії судоку: ходи, олівець, скасування, підказки, збереження.
   Без DOM — щоб логіку можна було перевіряти окремо від інтерфейсу. */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./sudoku-engine.js') : root.SudokuEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SudokuGame = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const MAX_HISTORY = 300;

  class SudokuGame {
    constructor(data) {
      this.difficulty = data.difficulty || 'easy';
      this.puzzle = data.puzzle.slice();
      this.solution = data.solution.slice();
      this.values = data.values ? data.values.slice() : this.puzzle.slice();
      this.notes = data.notes ? data.notes.slice() : new Array(81).fill(0);
      this.hinted = new Set(data.hinted || []);
      this.hints = data.hints || 0;
      this.elapsed = data.elapsed || 0;   // накопичені мілісекунди
      this.runningSince = null;
      this.history = [];
      this.done = !!data.done;
    }

    isGiven(i) { return this.puzzle[i] !== 0; }
    isEmpty(i) { return this.values[i] === 0; }

    /* ───────── час ───────── */
    start(now) { if (this.runningSince == null && !this.done) this.runningSince = now == null ? Date.now() : now; }
    pause(now) {
      if (this.runningSince == null) return;
      this.elapsed += (now == null ? Date.now() : now) - this.runningSince;
      this.runningSince = null;
    }
    time(now) {
      const extra = this.runningSince == null ? 0 : (now == null ? Date.now() : now) - this.runningSince;
      return this.elapsed + extra;
    }

    /* ───────── ходи ───────── */
    snapshot() {
      this.history.push({ values: this.values.slice(), notes: this.notes.slice(), hinted: [...this.hinted] });
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }

    // Ставить цифру. Та сама цифра в тій же клітинці — прибирає її.
    place(i, digit) {
      if (this.done || this.isGiven(i) || digit < 1 || digit > 9) return false;
      if (this.values[i] === digit) return this.erase(i);
      this.snapshot();
      this.values[i] = digit;
      this.notes[i] = 0;
      this.hinted.delete(i);
      const bit = ~(1 << (digit - 1));
      for (const p of E.PEERS[i]) if (!this.values[p]) this.notes[p] &= bit; // прибираємо олівець у сусідів
      this.checkDone();
      return true;
    }

    // Олівець: позначка-кандидат у порожній клітинці
    toggleNote(i, digit) {
      if (this.done || this.isGiven(i) || this.values[i] || digit < 1 || digit > 9) return false;
      this.snapshot();
      this.notes[i] ^= 1 << (digit - 1);
      return true;
    }

    hasNote(i, digit) { return !!(this.notes[i] & (1 << (digit - 1))); }

    notesOf(i) {
      const out = [];
      for (let d = 1; d <= 9; d++) if (this.hasNote(i, d)) out.push(d);
      return out;
    }

    erase(i) {
      if (this.done || this.isGiven(i)) return false;
      if (!this.values[i] && !this.notes[i]) return false;
      this.snapshot();
      this.values[i] = 0;
      this.notes[i] = 0;
      this.hinted.delete(i);
      return true;
    }

    undo() {
      const prev = this.history.pop();
      if (!prev) return false;
      this.values = prev.values;
      this.notes = prev.notes;
      this.hinted = new Set(prev.hinted);
      this.done = false;
      return true;
    }

    // Підказка: відкриває правильну цифру (у вибраній клітинці, якщо вона порожня)
    hint(i, rng) {
      if (this.done) return -1;
      const wrong = [];
      const empty = [];
      for (let k = 0; k < 81; k++) {
        if (this.isGiven(k)) continue;
        if (!this.values[k]) empty.push(k);
        else if (this.values[k] !== this.solution[k]) wrong.push(k);
      }
      let target = -1;
      if (i != null && i >= 0 && !this.isGiven(i) && this.values[i] !== this.solution[i]) target = i;
      else if (wrong.length) target = wrong[0];            // спершу виправляємо помилки
      else if (empty.length) {
        const r = rng ? rng() : Math.random();
        target = empty[Math.min(empty.length - 1, (r * empty.length) | 0)];
      }
      if (target < 0) return -1;

      this.snapshot();
      this.values[target] = this.solution[target];
      this.notes[target] = 0;
      this.hinted.add(target);
      this.hints++;
      const bit = ~(1 << (this.solution[target] - 1));
      for (const p of E.PEERS[target]) if (!this.values[p]) this.notes[p] &= bit;
      this.checkDone();
      return target;
    }

    /* ───────── стан ───────── */
    conflicts() { return E.conflicts(this.values); }

    // Клітинки, де стоїть цифра, якої там бути не може
    mistakes() {
      const bad = new Set();
      for (let i = 0; i < 81; i++) {
        if (this.values[i] && this.values[i] !== this.solution[i]) bad.add(i);
      }
      return bad;
    }

    remaining(digit) {
      let n = 0;
      for (let i = 0; i < 81; i++) if (this.values[i] === digit) n++;
      return 9 - n;
    }

    filled() {
      let n = 0;
      for (let i = 0; i < 81; i++) if (this.values[i]) n++;
      return n;
    }

    checkDone() {
      for (let i = 0; i < 81; i++) if (this.values[i] !== this.solution[i]) return false;
      this.done = true;
      this.pause();
      return true;
    }

    /* ───────── збереження ───────── */
    serialize() {
      return {
        v: 1,
        difficulty: this.difficulty,
        puzzle: this.puzzle.join(''),
        solution: this.solution.join(''),
        values: this.values.join(''),
        notes: this.notes.join(','),
        hinted: [...this.hinted],
        hints: this.hints,
        elapsed: Math.round(this.time()),
        done: this.done
      };
    }

    static restore(raw) {
      if (!raw || raw.v !== 1) return null;
      const digits = (s) => String(s).split('').map(Number);
      const puzzle = digits(raw.puzzle), solution = digits(raw.solution), values = digits(raw.values);
      const notes = String(raw.notes).split(',').map(Number);
      if (puzzle.length !== 81 || solution.length !== 81 || values.length !== 81 || notes.length !== 81) return null;
      if (puzzle.some(isNaN) || solution.some(isNaN) || values.some(isNaN) || notes.some(isNaN)) return null;
      return new SudokuGame({
        difficulty: raw.difficulty, puzzle, solution, values, notes,
        hinted: raw.hinted, hints: raw.hints, elapsed: raw.elapsed, done: raw.done
      });
    }

    static create(difficulty, opts) {
      const g = E.generate(difficulty, opts);
      return new SudokuGame({ difficulty: g.difficulty, puzzle: g.puzzle, solution: g.solution });
    }
  }

  return SudokuGame;
});
