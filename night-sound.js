/*
  Тихий звук нічного неба.

  Жодних аудіофайлів: усе народжується в браузері через Web Audio.
  Три шари, усі дуже тихі:
    - подих   — коричневий шум під низьким фільтром, що повільно дихає (далекий вітер);
    - гудіння — відкритий акорд без терції, голоси ледь розходяться між собою (саме небо);
    - зорі    — рідкі мʼякі дзвіночки з довгим хвостом, раз на 30–70 секунд.

  Нічого мінорного й нічого низького: від такого в темряві стає тривожно,
  а тут потрібне протилежне.

  Сторінці достатньо одного рядка: <script src="night-sound.js" defer></script>.
  Сценарій сам додає маленький перемикач у нижньому куті й памʼятає вибір у браузері.
  Звук увімкнений одразу, але браузер не дає звучати до першого дотику до сторінки,
  тому насправді він приходить з першим кліком чи натиском клавіші — і завжди тихо наростає.
*/
(() => {
  'use strict';

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  const KEY = 'etd-night-sound';
  const LEVEL = 0.1;      // загальна гучність: майже межа чутності
  const FADE = 6;         // скільки секунд наростає й гасне звук
  const SILENT = 0.0001;  // не нуль: від нуля не працює плавний спад

  // Гучності звукових шарів — щоб перевірки бачили, що ніде немає підсилення
  const audio = [];

  const store = {
    // Усталено звук увімкнений: вимкненим він стає лише тоді, коли його вимкнули
    get() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } },
    set(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} }
  };

  /* ───────── Перемикач ───────── */

  const style = document.createElement('style');
  style.textContent = `
    .night-sound {
      position: fixed; z-index: 25;
      right: calc(env(safe-area-inset-right, 0px) + .9rem);
      bottom: calc(env(safe-area-inset-bottom, 0px) + .9rem);
      display: inline-flex; align-items: center; gap: .5em;
      padding: .42em .85em .5em;
      border: 1px solid rgba(239, 231, 220, .16);
      border-radius: 999px;
      background: rgba(13, 11, 31, .55);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      color: var(--bone-faint, rgba(239, 231, 220, .28));
      font-family: var(--serif, Georgia, serif);
      font-size: .95rem; font-style: italic; line-height: 1;
      cursor: pointer; opacity: .55;
      transition: opacity .6s ease, color .6s ease, border-color .6s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .night-sound:hover, .night-sound:focus-visible {
      opacity: 1; color: var(--bone-dim, rgba(239, 231, 220, .56));
      border-color: rgba(239, 231, 220, .3);
    }
    .night-sound[aria-pressed="true"] {
      opacity: .9; color: var(--moon, #b9c6ec); border-color: rgba(185, 198, 236, .3);
    }
    .night-sound .dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: currentColor; opacity: .35;
      transition: opacity .6s ease, box-shadow .6s ease;
    }
    .night-sound[aria-pressed="true"] .dot {
      opacity: 1; box-shadow: 0 0 10px 2px rgba(185, 198, 236, .5);
      animation: night-sound-breath 7s ease-in-out infinite;
    }
    /* Увімкнено, але браузер ще не пустив звук: кажемо про це словами, а не тишею */
    .night-sound.waiting {
      opacity: .85; color: var(--candle, #f2b872); border-color: rgba(242, 184, 114, .3);
    }
    .night-sound.waiting .dot {
      opacity: 1; box-shadow: 0 0 10px 2px rgba(242, 184, 114, .45);
      animation: night-sound-breath 2.6s ease-in-out infinite;
    }
    @keyframes night-sound-breath {
      50% { opacity: .45; box-shadow: 0 0 6px 1px rgba(185, 198, 236, .3); }
    }
    @media (prefers-reduced-motion: reduce) {
      .night-sound[aria-pressed="true"] .dot { animation: none; }
    }
  `;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'night-sound';
  btn.setAttribute('aria-pressed', 'false');
  btn.title = 'тихий звук нічного неба';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'нічне небо';
  btn.append(dot, label);

  /* ───────── Звук ───────── */

  let ctx = null, master = null;
  let on = false;

  // Коричневий шум: мʼякший за білий, у ньому більше низу — схоже на вітер, а не на радіо
  function noiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  // Повільний синус, що гуляє навколо заданого значення параметра
  function drift(param, base, depth, seconds) {
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = 1 / seconds;
    amount.gain.value = depth;
    param.value = base;
    lfo.connect(amount).connect(param);
    lfo.start();
  }

  function breath() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(12);
    src.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.Q.value = 0.4;
    drift(low.frequency, 300, 90, 34);

    const gain = ctx.createGain();
    drift(gain.gain, 0.32, 0.12, 23);
    audio.push(gain);

    src.connect(low).connect(gain).connect(master);
    src.start();
  }

  function hum() {
    // Відкритий акорд без терції: тоніка, квінта, октава, нона й квінта вище.
    // Ні мінору, ні низького дрона — від них у темряві стає тривожно, а треба навпаки.
    const notes = [110, 164.81, 220, 246.94, 329.63];
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 620;
    low.connect(master);

    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // Тон ледь-ледь гуляє: через це акорд ніколи не звучить двічі однаково
      drift(osc.frequency, hz, hz * 0.0012, 19 + i * 6);

      const gain = ctx.createGain();
      const level = 0.075 / (1 + i * 0.55);
      drift(gain.gain, level, level * 0.75, 17 + i * 8);
      audio.push(gain);

      const pan = ctx.createStereoPanner();
      pan.pan.value = (i % 2 ? 1 : -1) * (0.15 + i * 0.09);

      osc.connect(gain).connect(pan).connect(low);
      osc.start();
    });
  }

  // Довгий мʼякий хвіст замість справжньої луни: імпульс — той самий шум, що затухає
  function tail() {
    const seconds = 3.6;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    const rev = ctx.createConvolver();
    rev.buffer = buf;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    audio.push(wet);
    rev.connect(wet).connect(master);
    return rev;
  }

  function starfall() {
    const rev = tail();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    audio.push(dry);
    dry.connect(master);
    // Мажорна пентатоніка від ля: будь-які дві ноти поряд звучать світло
    const notes = [440, 493.88, 554.37, 659.25, 739.99];

    function ring() {
      const hz = notes[Math.floor(Math.random() * notes.length)];
      const now = ctx.currentTime;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.03, now + 1.2);  // нота приходить, а не бʼє
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 8);

      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 1600;

      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 1.2;

      [1, 2].forEach((mult, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz * mult;
        const part = ctx.createGain();
        part.gain.value = i ? 0.22 : 1;
        osc.connect(part).connect(gain);
        osc.start(now);
        osc.stop(now + 9);
      });

      gain.connect(low).connect(pan);
      pan.connect(dry);
      pan.connect(rev);

      setTimeout(ring, 30000 + Math.random() * 40000);
    }

    setTimeout(ring, 12000 + Math.random() * 10000);
  }

  function build() {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = SILENT;
    master.connect(ctx.destination);
    audio.push(master);
    breath();
    hum();
    starfall();
    ctx.addEventListener('statechange', paint);
  }

  function fadeTo(value) {
    master.gain.setTargetAtTime(value, ctx.currentTime, FADE / 3);
  }

  function start() {
    if (!ctx) build();
    const resumed = ctx.resume();
    if (resumed && resumed.catch) resumed.catch(() => {});
    fadeTo(LEVEL);
    paint();
  }

  /* ───────── Стан перемикача ───────── */

  // Три стани, і третій найважливіший: «увімкнено, але браузер ще не пустив звук»
  function paint() {
    const waiting = on && (!ctx || ctx.state !== 'running');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('waiting', waiting);
    label.textContent = waiting ? 'торкнись — і буде небо' : 'нічне небо';
    btn.title = waiting
      ? 'браузер не пускає звук, поки не торкнешся сторінки'
      : (on ? 'вимкнути звук нічного неба' : 'тихий звук нічного неба');
  }

  function set(next) {
    on = next;
    store.set(on);
    if (on) start();
    else if (ctx) fadeTo(SILENT);
    paint();
  }

  btn.addEventListener('click', () => set(!on));
  // Після кліку мишею чи дотиком знімаємо фокус: інакше в іграх пробіл і стрілки
  // йшли б у перемикач, а не в гру. З клавіатури фокус залишаємо на місці.
  btn.addEventListener('pointerup', () => btn.blur());

  // Якщо вкладку залишили — небо замовкає, а коли повернулись, тихо приходить назад
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) fadeTo(SILENT); else start();
  });

  /* ───────── Поява на сторінці ───────── */

  let mounted = false;
  function mount() {
    if (mounted) return;
    mounted = true;
    document.head.appendChild(style);
    document.body.appendChild(btn);

    on = store.get();
    paint();
    if (!on) return;

    // Звук увімкнений, але браузер не дасть йому звучати до першої дії людини на
    // сторінці — і обійти це не можна. Тому пробуємо одразу, а далі чекаємо будь-якої
    // дії: кліку, дотику, клавіші, колеса. Слухаємо, поки звук справді не пішов.
    start();
    const kinds = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'wheel'];
    const wake = () => {
      if (!on) return;
      start();
      if (ctx.state === 'running') kinds.forEach((k) => document.removeEventListener(k, wake, true));
    };
    kinds.forEach((k) => document.addEventListener(k, wake, true));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // Для night-sound-tests.html: звідси видно, з чого складається звук
  window.__nightSoundTest = {
    get on() { return on; },
    get ctx() { return ctx; },
    get master() { return master; },
    audio, level: LEVEL, fade: FADE, silent: SILENT
  };
})();
