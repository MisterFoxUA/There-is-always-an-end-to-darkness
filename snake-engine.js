/* Рушій змійки: поле, рух, їжа, перешкоди, рахунок, збереження.
   Файл не залежить від DOM — його можна запускати і в браузері, і в Node.
   Один крок = один виклик step(); коли саме його робити, вирішує сторінка. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnakeEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Рівні. wrap = чи можна проходити крізь край поля.
     tick — мілісекунди на крок на початку, minTick — найшвидше, до чого розганяється. */
  const LEVELS = {
    calm:  { cols: 15, rows: 15, tick: 190, minTick: 120, wrap: true,  obstacles: 0 },
    night: { cols: 19, rows: 19, tick: 145, minTick: 85,  wrap: true,  obstacles: 0 },
    storm: { cols: 21, rows: 21, tick: 115, minTick: 65,  wrap: false, obstacles: 0 },
    abyss: { cols: 21, rows: 21, tick: 100, minTick: 55,  wrap: false, obstacles: 12 }
  };

  const START_LENGTH = 3;   // з чого починається змійка
  const FOOD_GROWTH = 2;    // на скільки ланок росте від однієї їжі
  const FOOD_POINTS = 10;
  const STAR_GROWTH = 1;
  const STAR_POINTS = 50;
  const STAR_EVERY = 5;     // зірка зʼявляється після кожної пʼятої їжі
  const STAR_TTL = 45;      // і живе стільки кроків
  const SPEEDUP = 3;        // на стільки мілісекунд коротшає крок з кожною їжею
  const MAX_QUEUE = 2;      // скільком поворотам поспіль дозволено чекати своєї черги

  const DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

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

  class SnakeGame {
    constructor(opts) {
      const o = opts || {};
      const level = LEVELS[o.level] ? o.level : 'calm';
      const spec = LEVELS[level];

      this.level = level;
      this.cols = spec.cols;
      this.rows = spec.rows;
      this.wrap = spec.wrap;
      this.tick0 = spec.tick;
      this.minTick = spec.minTick;
      this.rng = o.rng || mulberry32(o.seed == null ? (Math.random() * 2 ** 32) >>> 0 : o.seed);

      this.score = 0;
      this.eaten = 0;
      this.steps = 0;
      this.alive = true;
      this.won = false;
      this.cause = null;        // 'wall' | 'self' — чим закінчилась гра
      this.star = null;         // { cell, ttl }
      this.queue = [];
      this.grow = 0;
      this.elapsed = 0;         // накопичені мілісекунди
      this.runningSince = null;

      this.walls = new Set(o.walls || []);
      this.snake = o.snake ? o.snake.slice() : null;
      this.dir = o.dir ? { x: o.dir.x, y: o.dir.y } : { x: 1, y: 0 };

      if (!this.snake) {
        if (!o.walls) this.buildWalls(spec.obstacles);
        this.buildSnake();
      }
      this.food = o.food === undefined ? this.placeFood() : o.food;
    }

    /* ───────── поле ───────── */
    get size() { return this.cols * this.rows; }
    idx(x, y) { return y * this.cols + x; }
    xOf(i) { return i % this.cols; }
    yOf(i) { return (i / this.cols) | 0; }
    isWall(i) { return this.walls.has(i); }

    // Перешкоди: випадкові блоки, але не по краю і не на стартовому рядку —
    // щоб перші кроки завжди були можливі.
    buildWalls(count) {
      const midRow = (this.rows / 2) | 0;
      const spots = [];
      for (let y = 1; y < this.rows - 1; y++) {
        if (Math.abs(y - midRow) <= 1) continue;
        for (let x = 1; x < this.cols - 1; x++) spots.push(this.idx(x, y));
      }
      for (let n = 0; n < count && spots.length; n++) {
        const k = (this.rng() * spots.length) | 0;
        this.walls.add(spots.splice(k, 1)[0]);
      }
    }

    buildSnake() {
      const y = (this.rows / 2) | 0;
      const headX = Math.min(this.cols - 1, ((this.cols / 2) | 0) + 1);
      this.snake = [];
      for (let k = 0; k < START_LENGTH; k++) {
        const x = headX - k;
        this.snake.push(this.idx(x < 0 ? x + this.cols : x, y));
      }
      this.dir = { x: 1, y: 0 };
    }

    occupied() {
      const busy = new Set(this.snake);
      for (const w of this.walls) busy.add(w);
      if (this.food != null) busy.add(this.food);
      if (this.star) busy.add(this.star.cell);
      return busy;
    }

    free() {
      const busy = this.occupied();
      const out = [];
      for (let i = 0; i < this.size; i++) if (!busy.has(i)) out.push(i);
      return out;
    }

    placeFood() {
      const spots = this.free();
      if (!spots.length) return null;
      return spots[(this.rng() * spots.length) | 0];
    }

    placeStar() {
      const spots = this.free();
      if (!spots.length) return;
      this.star = { cell: spots[(this.rng() * spots.length) | 0], ttl: STAR_TTL };
    }

    /* ───────── час ───────── */
    start(now) { if (this.runningSince == null && this.alive) this.runningSince = now == null ? Date.now() : now; }
    pause(now) {
      if (this.runningSince == null) return;
      this.elapsed += (now == null ? Date.now() : now) - this.runningSince;
      this.runningSince = null;
    }
    time(now) {
      const extra = this.runningSince == null ? 0 : (now == null ? Date.now() : now) - this.runningSince;
      return this.elapsed + extra;
    }

    /* ───────── керування ───────── */
    get head() { return this.snake[0]; }
    get length() { return this.snake.length; }

    // Скільки мілісекунд до наступного кроку: з кожною їжею трохи швидше.
    speed() { return Math.max(this.minTick, this.tick0 - this.eaten * SPEEDUP); }

    // Напрямок, від якого треба відштовхуватись, приймаючи новий поворот
    lastDir() { return this.queue.length ? this.queue[this.queue.length - 1] : this.dir; }

    // Поворот: назад у себе не можна, той самий напрямок двічі не копимо.
    turn(dx, dy) {
      if (!this.alive) return false;
      const d = typeof dx === 'string' ? DIRS[dx] : { x: dx, y: dy };
      if (!d || Math.abs(d.x) + Math.abs(d.y) !== 1) return false;
      const last = this.lastDir();
      if (d.x === last.x && d.y === last.y) return false;
      if (d.x === -last.x && d.y === -last.y) return false;
      if (this.queue.length >= MAX_QUEUE) return false;
      this.queue.push({ x: d.x, y: d.y });
      return true;
    }

    die(cause) {
      this.alive = false;
      this.cause = cause;
      this.queue.length = 0;
      this.pause();
      return cause;
    }

    /* Один крок. Повертає, що сталося:
       'move' | 'eat' | 'star' | 'wall' | 'self' | 'won' | 'over' */
    step() {
      if (!this.alive) return 'over';

      if (this.queue.length) this.dir = this.queue.shift();

      let x = this.xOf(this.head) + this.dir.x;
      let y = this.yOf(this.head) + this.dir.y;
      if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
        if (!this.wrap) return this.die('wall');
        x = (x + this.cols) % this.cols;
        y = (y + this.rows) % this.rows;
      }
      const next = this.idx(x, y);
      if (this.isWall(next)) return this.die('wall');

      // Хвіст цього ж кроку зійде з місця — тож на нього стати можна.
      const tail = this.snake[this.snake.length - 1];
      const hitsSelf = this.snake.indexOf(next) !== -1 && !(next === tail && this.grow === 0);
      if (hitsSelf) return this.die('self');

      this.snake.unshift(next);
      let event = 'move';

      if (next === this.food) {
        this.eaten++;
        this.score += FOOD_POINTS;
        this.grow += FOOD_GROWTH;
        this.food = null;
        event = 'eat';
      } else if (this.star && next === this.star.cell) {
        this.score += STAR_POINTS;
        this.grow += STAR_GROWTH;
        this.star = null;
        event = 'star';
      }

      if (this.grow > 0) this.grow--;
      else this.snake.pop();

      this.steps++;

      if (this.star) {
        this.star.ttl--;
        if (this.star.ttl <= 0) this.star = null;
      }

      if (event === 'eat') {
        if (!this.star && this.eaten % STAR_EVERY === 0) this.placeStar();
        this.food = this.placeFood();
        if (this.food == null) {     // вільного місця більше немає — поле пройдено
          this.won = true;
          this.alive = false;
          this.pause();
          return 'won';
        }
      }
      return event;
    }

    /* ───────── збереження ───────── */
    serialize() {
      return {
        v: 1,
        level: this.level,
        snake: this.snake.slice(),
        dir: { x: this.dir.x, y: this.dir.y },
        walls: [...this.walls],
        food: this.food,
        star: this.star ? { cell: this.star.cell, ttl: this.star.ttl } : null,
        grow: this.grow,
        score: this.score,
        eaten: this.eaten,
        steps: this.steps,
        alive: this.alive,
        won: this.won,
        cause: this.cause,
        elapsed: Math.round(this.time())
      };
    }

    static restore(raw) {
      if (!raw || raw.v !== 1 || !LEVELS[raw.level]) return null;
      if (!Array.isArray(raw.snake) || !raw.snake.length) return null;
      const spec = LEVELS[raw.level];
      const size = spec.cols * spec.rows;
      const cell = (i) => Number.isInteger(i) && i >= 0 && i < size;
      if (!raw.snake.every(cell)) return null;
      if (new Set(raw.snake).size !== raw.snake.length) return null;
      if (!raw.dir || Math.abs(raw.dir.x) + Math.abs(raw.dir.y) !== 1) return null;
      if (raw.food != null && !cell(raw.food)) return null;
      const walls = Array.isArray(raw.walls) ? raw.walls.filter(cell) : [];

      const g = new SnakeGame({
        level: raw.level,
        snake: raw.snake,
        dir: raw.dir,
        walls,
        food: raw.food == null ? null : raw.food
      });
      g.star = raw.star && cell(raw.star.cell) ? { cell: raw.star.cell, ttl: raw.star.ttl | 0 } : null;
      g.grow = Math.max(0, raw.grow | 0);
      g.score = Math.max(0, raw.score | 0);
      g.eaten = Math.max(0, raw.eaten | 0);
      g.steps = Math.max(0, raw.steps | 0);
      g.alive = raw.alive !== false;
      g.won = !!raw.won;
      g.cause = raw.cause || null;
      g.elapsed = Math.max(0, raw.elapsed | 0);
      if (g.food == null && g.alive && !g.won) g.food = g.placeFood();
      return g;
    }

    static create(level, opts) {
      return new SnakeGame(Object.assign({ level }, opts));
    }
  }

  return {
    SnakeGame,
    LEVELS, DIRS,
    START_LENGTH, FOOD_GROWTH, FOOD_POINTS, STAR_GROWTH, STAR_POINTS,
    STAR_EVERY, STAR_TTL, SPEEDUP, MAX_QUEUE,
    mulberry32
  };
});
