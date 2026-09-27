/* Рушій кросворда: складає сітку зі слів, які перетинаються.
   Файл не залежить від DOM — його можна запускати і в браузері, і в Node.

   Правила розкладки (звичайні для «хрестика»):
   — кожне нове слово мусить перетнути вже покладене хоча б в одній літері;
   — на перетині літери збігаються, два перетини поспіль заборонені
     (інакше два слова злилися б в одну лінію);
   — збоку від нової літери не може стояти чужа літера, а перед словом
     і після нього клітинки порожні — щоб у сітці не з'являлося слів,
     яких ми не задумували. */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./crossword-words.js') : root.CrosswordWords);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrosswordEngine = api;
})(typeof self !== 'undefined' ? self : this, function (WORDS) {
  'use strict';

  const ALPHABET = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ';

  // rare — яку приблизно частку сітки складають рідші слова (ті, що з позначкою 2)
  const LEVELS = {
    easy:   { words: 8,  min: 3, max: 6, size: 13, given: .18, tries: 16, rare: .05 },
    medium: { words: 12, min: 3, max: 7, size: 15, given: .08, tries: 18, rare: .2 },
    hard:   { words: 16, min: 4, max: 8, size: 17, given: 0,   tries: 20, rare: .55 },
    expert: { words: 20, min: 4, max: 9, size: 19, given: 0,   tries: 22, rare: .7 }
  };

  const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

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

  // Зливає два списки в один так, щоб на початку перших була приблизно задана частка
  function mix(first, second, share, rng) {
    const out = [];
    let i = 0, j = 0;
    while (i < first.length || j < second.length) {
      const wantFirst = rng() < share;
      if (wantFirst && i < first.length) out.push(first[i++]);
      else if (!wantFirst && j < second.length) out.push(second[j++]);
      else if (i < first.length) out.push(first[i++]);
      else out.push(second[j++]);
    }
    return out;
  }

  const CLUE_OF = new Map();
  for (const { word, clue } of WORDS) if (!CLUE_OF.has(word)) CLUE_OF.set(word, clue);

  /* ───────── Розкладка на робочому полі ───────── */

  // Одна спроба скласти сітку. Повертає поле size×size і список покладених слів.
  function build(spec, rng) {
    const S = spec.size;
    const grid = new Array(S * S).fill('');
    const idx = (r, c) => r * S + c;
    const inside = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

    // Рушій бере слова з початку списку, тож порядок і задає, чого в сітці буде більше:
    // два шари перемішуємо у пропорції рівня, а не ставимо один суцільним блоком —
    // інакше складні кросворди щоразу збиралися б з тих самих рідкісних слів.
    const fitsLength = ({ word }) => word.length >= spec.min && word.length <= spec.max;
    const shuffled = shuffle(WORDS.filter(fitsLength).slice(), rng);
    const pool = mix(
      shuffled.filter((w) => w.tier === 2),
      shuffled.filter((w) => w.tier !== 2),
      spec.rare, rng
    ).map(({ word }) => word);
    if (!pool.length) return { grid, size: S, placed: [] };

    // Скільки літер збігається, або -1, якщо так класти не можна
    function fit(word, r, c, dir) {
      const dr = dir === 'd' ? 1 : 0;
      const dc = dir === 'a' ? 1 : 0;
      const len = word.length;
      const endR = r + dr * (len - 1);
      const endC = c + dc * (len - 1);
      if (!inside(r, c) || !inside(endR, endC)) return -1;
      if (inside(r - dr, c - dc) && grid[idx(r - dr, c - dc)]) return -1;
      if (inside(endR + dr, endC + dc) && grid[idx(endR + dr, endC + dc)]) return -1;

      let crossings = 0;
      let prevCrossed = false;
      for (let i = 0; i < len; i++) {
        const rr = r + dr * i;
        const cc = c + dc * i;
        const here = grid[idx(rr, cc)];
        if (here) {
          if (here !== word[i]) return -1;
          if (prevCrossed) return -1;
          crossings++;
          prevCrossed = true;
        } else {
          prevCrossed = false;
          // збоку (поперек напрямку слова) мусить бути порожньо
          if (inside(rr - dc, cc - dr) && grid[idx(rr - dc, cc - dr)]) return -1;
          if (inside(rr + dc, cc + dr) && grid[idx(rr + dc, cc + dr)]) return -1;
        }
      }
      return crossings;
    }

    function put(word, r, c, dir) {
      const dr = dir === 'd' ? 1 : 0;
      const dc = dir === 'a' ? 1 : 0;
      for (let i = 0; i < word.length; i++) grid[idx(r + dr * i, c + dc * i)] = word[i];
      placed.push({ word, row: r, col: c, dir });
    }

    const placed = [];
    const used = new Set();

    // перше слово — довге, посередині поля, лежачи
    let first = pool.find((w) => w.length >= spec.max - 1) || pool[0];
    put(first, S >> 1, (S - first.length) >> 1, 'a');
    used.add(first);

    let progress = true;
    while (placed.length < spec.words && progress) {
      progress = false;
      for (const word of pool) {
        if (placed.length >= spec.words) break;
        if (used.has(word)) continue;

        // усі місця, де це слово перетинає щось уже покладене
        const spots = [];
        for (let i = 0; i < word.length; i++) {
          for (const anchor of placed) {
            const dir = anchor.dir === 'a' ? 'd' : 'a';
            for (let j = 0; j < anchor.word.length; j++) {
              if (anchor.word[j] !== word[i]) continue;
              const ar = anchor.row + (anchor.dir === 'd' ? j : 0);
              const ac = anchor.col + (anchor.dir === 'a' ? j : 0);
              const r = dir === 'd' ? ar - i : ar;
              const c = dir === 'a' ? ac - i : ac;
              const cross = fit(word, r, c, dir);
              if (cross > 0) spots.push({ r, c, dir, cross });
            }
          }
        }
        if (!spots.length) continue;

        // більше перетинів — щільніша й цікавіша сітка
        const best = Math.max(...spots.map((s) => s.cross));
        const good = spots.filter((s) => s.cross === best);
        const pick = good[(rng() * good.length) | 0];
        put(word, pick.r, pick.c, pick.dir);
        used.add(word);
        progress = true;
      }
    }

    return { grid, size: S, placed };
  }

  /* ───────── Обрізання й нумерація ───────── */

  // Прибирає порожні краї та збирає слова так, як їх видно в сітці
  function finalize(raw, level) {
    const S = raw.size;
    let minR = S, maxR = -1, minC = S, maxC = -1;
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        if (!raw.grid[r * S + c]) continue;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
    const rows = maxR - minR + 1;
    const cols = maxC - minC + 1;
    const letters = new Array(rows * cols).fill('');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) letters[r * cols + c] = raw.grid[(r + minR) * S + (c + minC)];
    }

    return { level, rows, cols, letters, entries: entriesOf(letters, rows, cols) };
  }

  // Усі слова, які читаються в сітці: пронумеровані так, як звично в кросворді —
  // по рядках зверху вниз, і «лежачі» перед «стоячими» в одній клітинці.
  function entriesOf(letters, rows, cols) {
    const at = (r, c) => (r >= 0 && c >= 0 && r < rows && c < cols) ? letters[r * cols + c] : '';
    const entries = [];
    let num = 0;

    const readEntry = (n, dir, r, c) => {
      const dr = dir === 'd' ? 1 : 0;
      const dc = dir === 'a' ? 1 : 0;
      const cells = [];
      let word = '';
      let rr = r, cc = c;
      while (at(rr, cc)) {
        cells.push(rr * cols + cc);
        word += at(rr, cc);
        rr += dr; cc += dc;
      }
      return { num: n, dir, row: r, col: c, len: word.length, word, cells, clue: CLUE_OF.get(word) || '' };
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!at(r, c)) continue;
        const startsAcross = !at(r, c - 1) && !!at(r, c + 1);
        const startsDown = !at(r - 1, c) && !!at(r + 1, c);
        if (!startsAcross && !startsDown) continue;
        num++;
        if (startsAcross) entries.push(readEntry(num, 'a', r, c));
        if (startsDown) entries.push(readEntry(num, 'd', r, c));
      }
    }
    return entries;
  }

  /* ───────── Складання задачі ───────── */

  function generate(difficulty, opts) {
    opts = opts || {};
    const key = LEVELS[difficulty] ? difficulty : 'easy';
    const spec = LEVELS[key];
    const rng = opts.rng || (opts.seed != null ? mulberry32(opts.seed) : Math.random);
    const tries = opts.tries || spec.tries;
    const t0 = now();

    let best = null;
    for (let a = 0; a < tries; a++) {
      const raw = build(spec, rng);
      if (!best || raw.placed.length > best.placed.length) best = raw;
      if (best.placed.length >= spec.words) break;
    }

    const puzzle = finalize(best, key);
    puzzle.difficulty = key;
    puzzle.given = pickGiven(puzzle, spec, rng);
    puzzle.ms = Math.round(now() - t0);

    // Означення без пари — ознака помилки в розкладці, краще знати про це одразу
    puzzle.unknown = puzzle.entries.filter((e) => !e.clue).map((e) => e.word);
    return puzzle;
  }

  // Кілька літер, які стоять від початку — щоб на легких рівнях було з чого почати
  function pickGiven(puzzle, spec, rng) {
    if (!spec.given) return [];
    const cells = puzzle.letters.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const count = Math.floor(cells.length * spec.given);
    if (count <= 0) return [];
    return shuffle(cells, rng).slice(0, count).sort((a, b) => a - b);
  }

  /* ───────── Дрібні помічники для інтерфейсу ───────── */

  function isLetter(ch) { return typeof ch === 'string' && ch.length === 1 && ALPHABET.includes(ch); }

  // Слова, які в сітці читаються, але яких немає у словнику (має бути порожньо)
  function strayWords(puzzle) {
    const known = new Set(WORDS.map(({ word }) => word));
    return puzzle.entries.filter((e) => !known.has(e.word)).map((e) => e.word);
  }

  return {
    ALPHABET, LEVELS, WORDS, CLUE_OF,
    generate, build, finalize, entriesOf, isLetter, strayWords, mulberry32, shuffle
  };
});
