/* Стан однієї партії кросворда: літери, скасування, підказки, збереження.
   Без DOM — щоб логіку можна було перевіряти окремо від інтерфейсу. */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./crossword-engine.js') : root.CrosswordEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrosswordGame = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const MAX_HISTORY = 400;
  const BLOCK = '.'; // порожня клітинка сітки у збереженні

  class CrosswordGame {
    constructor(data) {
      this.difficulty = data.difficulty || 'easy';
      this.rows = data.rows;
      this.cols = data.cols;
      this.solution = data.solution.slice();       // '' там, де клітинки немає
      this.entries = data.entries || E.entriesOf(this.solution, this.rows, this.cols);
      this.given = new Set(data.given || []);
      this.letters = data.letters
        ? data.letters.slice()
        : this.solution.map((ch, i) => (this.given.has(i) ? ch : ''));
      this.hinted = new Set(data.hinted || []);
      this.hints = data.hints || 0;
      this.elapsed = data.elapsed || 0;   // накопичені мілісекунди
      this.runningSince = null;
      this.history = [];
      this.done = !!data.done;

      this.entryOf = { a: new Array(this.rows * this.cols).fill(null), d: new Array(this.rows * this.cols).fill(null) };
      for (const e of this.entries) for (const i of e.cells) this.entryOf[e.dir][i] = e;
    }

    get size() { return this.rows * this.cols; }

    isBlock(i) { return !this.solution[i]; }
    isGiven(i) { return this.given.has(i); }
    isEmpty(i) { return !this.letters[i]; }

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
      this.history.push({ letters: this.letters.slice(), hinted: [...this.hinted] });
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }

    // Ставить літеру. Та сама літера в тій же клітинці — прибирає її.
    place(i, letter) {
      if (this.done || this.isBlock(i) || this.isGiven(i)) return false;
      const ch = String(letter || '').toUpperCase();
      if (!E.isLetter(ch)) return false;
      if (this.letters[i] === ch) return this.erase(i);
      this.snapshot();
      this.letters[i] = ch;
      this.hinted.delete(i);
      this.checkDone();
      return true;
    }

    erase(i) {
      if (this.done || this.isBlock(i) || this.isGiven(i) || !this.letters[i]) return false;
      this.snapshot();
      this.letters[i] = '';
      this.hinted.delete(i);
      return true;
    }

    undo() {
      const prev = this.history.pop();
      if (!prev) return false;
      this.letters = prev.letters;
      this.hinted = new Set(prev.hinted);
      this.done = false;
      return true;
    }

    // Підказка: відкриває правильну літеру — спершу виправляє помилку,
    // потім заповнює порожню (у вибраній клітинці або слові, якщо можна)
    hint(i, dir, rng) {
      if (this.done) return -1;
      const wrong = [];
      const empty = [];
      for (let k = 0; k < this.size; k++) {
        if (this.isBlock(k) || this.isGiven(k)) continue;
        if (!this.letters[k]) empty.push(k);
        else if (this.letters[k] !== this.solution[k]) wrong.push(k);
      }

      let target = -1;
      const open = (k) => k != null && k >= 0 && !this.isBlock(k) && !this.isGiven(k) && this.letters[k] !== this.solution[k];
      if (open(i)) target = i;
      if (target < 0 && i != null && i >= 0 && dir) {
        const entry = this.entryOf[dir][i] || this.entryOf[dir === 'a' ? 'd' : 'a'][i];
        if (entry) target = entry.cells.find(open) ?? -1;
      }
      if (target < 0 && wrong.length) target = wrong[0];
      if (target < 0 && empty.length) {
        const r = rng ? rng() : Math.random();
        target = empty[Math.min(empty.length - 1, (r * empty.length) | 0)];
      }
      if (target < 0) return -1;

      this.snapshot();
      this.letters[target] = this.solution[target];
      this.hinted.add(target);
      this.hints++;
      this.checkDone();
      return target;
    }

    /* ───────── стан ───────── */

    // Клітинки, де стоїть літера, якої там бути не може
    mistakes() {
      const bad = new Set();
      for (let i = 0; i < this.size; i++) {
        if (this.isBlock(i)) continue;
        if (this.letters[i] && this.letters[i] !== this.solution[i]) bad.add(i);
      }
      return bad;
    }

    entryAt(i, dir) { return this.isBlock(i) ? null : this.entryOf[dir][i]; }

    // Слово, яке цікавить гравця: у вибраному напрямку, а якщо його немає — в іншому
    entryFor(i, dir) {
      if (this.isBlock(i)) return null;
      return this.entryOf[dir][i] || this.entryOf[dir === 'a' ? 'd' : 'a'][i];
    }

    entryFilled(entry) { return entry.cells.every((i) => !!this.letters[i]); }
    entrySolved(entry) { return entry.cells.every((i) => this.letters[i] === this.solution[i]); }

    solvedCount() { return this.entries.filter((e) => this.entrySolved(e)).length; }

    filled() {
      let n = 0;
      for (let i = 0; i < this.size; i++) if (!this.isBlock(i) && this.letters[i]) n++;
      return n;
    }

    total() {
      let n = 0;
      for (let i = 0; i < this.size; i++) if (!this.isBlock(i)) n++;
      return n;
    }

    checkDone() {
      for (let i = 0; i < this.size; i++) {
        if (this.isBlock(i)) continue;
        if (this.letters[i] !== this.solution[i]) return false;
      }
      this.done = true;
      this.pause();
      return true;
    }

    /* ───────── збереження ───────── */
    serialize() {
      return {
        v: 1,
        difficulty: this.difficulty,
        rows: this.rows,
        cols: this.cols,
        solution: this.solution.map((ch) => ch || BLOCK).join(''),
        letters: this.letters.map((ch, i) => (this.isBlock(i) ? BLOCK : (ch || ' '))).join(''),
        given: [...this.given],
        hinted: [...this.hinted],
        hints: this.hints,
        elapsed: Math.round(this.time()),
        done: this.done
      };
    }

    static restore(raw) {
      if (!raw || raw.v !== 1) return null;
      const rows = Number(raw.rows), cols = Number(raw.cols);
      if (!(rows > 0) || !(cols > 0)) return null;
      const sol = String(raw.solution || '');
      const got = String(raw.letters || '');
      if (sol.length !== rows * cols || got.length !== rows * cols) return null;

      const solution = [...sol].map((ch) => (ch === BLOCK ? '' : ch));
      const letters = [...got].map((ch, i) => (ch === BLOCK || ch === ' ' || !solution[i] ? '' : ch));
      if (solution.some((ch, i) => ch && !E.isLetter(ch))) return null;

      const game = new CrosswordGame({
        difficulty: raw.difficulty, rows, cols, solution, letters,
        given: raw.given, hinted: raw.hinted, hints: raw.hints,
        elapsed: raw.elapsed, done: raw.done
      });

      // Сітку відновлюємо з літер, а означення беремо зі словника — тож якщо слово
      // зі словника зникло, партія лишилася б із порожнім означенням і розгадати її
      // було б неможливо. Краще чесно віддати null: сторінка складе новий кросворд.
      if (!game.entries.length || game.entries.some((e) => !e.clue)) return null;
      return game;
    }

    static create(difficulty, opts) {
      const p = E.generate(difficulty, opts);
      return new CrosswordGame({
        difficulty: p.difficulty,
        rows: p.rows,
        cols: p.cols,
        solution: p.letters,
        entries: p.entries,
        given: p.given
      });
    }
  }

  return CrosswordGame;
});
