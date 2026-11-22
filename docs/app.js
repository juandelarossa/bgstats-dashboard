"use strict";

const IS_SHARED = Boolean(window.SCOREBOARD_DATA);
/* Openbare versie: iedereen laadt zijn eigen BG Stats-export; alles blijft in de browser. */
const IS_PUBLIC = Boolean(window.PUBLIC_MODE);
const DATASET_KEY = "scoreboard-dataset";
const NO_NAME = "Onbekende speler";
const THE_GAME = "Het spel";
const POLL_MS = 10000;
const PAGE_SIZE = 30;
/* Maand- en dagnamen in de gekozen taal (LOCALE komt uit i18n.js). 5 januari 2026 is een maandag. */
const MONTHS = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(LOCALE, { month: "short" }).format(new Date(2026, m, 1)).replace(".", ""));
const DAYS = Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(new Date(2026, 0, 5 + d)).replace(".", "").slice(0, 3));
const DAY_NAMES = Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(LOCALE, { weekday: "long" }).format(new Date(2026, 0, 5 + d)));
const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const MONTH_FORMAT = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric" });
/* Online speel je vaker tegen onbekenden; daar staan de spellen meer voorop. */
const VIEWS = IS_PUBLIC ? [
  ["overzicht", "Alles op één pagina", "🎲"], ["spellen", "Spellen", "🃏"], ["genres", "Genres", "🎭"], ["klassement", "Klassement", "🏆"],
  ["rivalen", "Rivalen", "⚔️"], ["patronen", "Patronen", "🕹️"], ["plekken", "Plekken", "📍"], ["logboek", "Logboek", "📖"],
] : [
  ["overzicht", "Alles op één pagina", "🎲"], ["klassement", "Klassement", "🏆"], ["spellen", "Spellen", "🃏"], ["genres", "Genres", "🎭"],
  ["rivalen", "Rivalen", "⚔️"], ["patronen", "Patronen", "🕹️"], ["plekken", "Plekken", "📍"], ["logboek", "Logboek", "📖"],
];
const COLORS = { live: "var(--live)", digital: "var(--digital)", ink: "var(--mix)", win: "var(--win)" };
const AWARD_ICONS = {
  "Meest gespeeld": "❤️", "Tijdvreter": "⏳", "Snelle hap": "⚡", "Marathondag": "🏃", "Beste spel": "🌟", "Lastigste spel": "🧗", "Aartsrivaal": "😈",
  "Favoriete prooi": "🎯", "Vaste medespeler": "🤝", "Beste co-op-maatje": "🦸", "Drukste speeldag": "🥳", "Drukste maand": "📅",
  "Grootste overwinning": "💥", "Nieuwste ontdekking": "🔍", "Stoffigste favoriet": "🕸️", "Vaste speelplek": "🏠",
};
const MEEPLE = "M12 2a3.7 3.7 0 0 1 3.7 3.7c0 .9-.3 1.7-.9 2.3 3.5.8 7.2 2.6 7.2 4.2 0 1.3-2.7 1.7-4.3 1.2.5 2 1.7 4.5 2.7 6.3.4.8 0 1.6-.9 1.6h-4c-.6 0-1.1-.3-1.4-.9L12 16.9l-2.1 3.9c-.3.6-.8.9-1.4.9h-4c-.9 0-1.3-.8-.9-1.6 1-1.8 2.2-4.3 2.7-6.3C4.7 14.3 2 13.9 2 12.6c0-1.6 3.7-3.4 7.2-4.2-.6-.6-.9-1.4-.9-2.3A3.7 3.7 0 0 1 12 2z";
const meeple = (color, size = 44) => `<svg class="meeple" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${MEEPLE}" fill="${color}" stroke="var(--line)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const state = {
  type: "Alles", me: "", period: "all", from: "", to: "", game: "", mate: "", loc: "", size: "", kind: "", genre: "",
  view: "overzicht", gameSort: "plays", gameSearch: "", lbSort: "rate", lbMin: 10, rival: "", logSearch: "", logPage: 1,
};
let db = null;
let scoped = [];
let mine = [];
let charts = {};
let version = null;

const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (value) => Number(value).toLocaleString(LOCALE);
const rate = (value, digits = 0) => (value === null ? "–" : `${(value * 100).toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const dateLabel = (p) => DATE_FORMAT.format(p.date);
const monthLabel = (key) => MONTH_FORMAT.format(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
const minutesOf = (list) => list.reduce((sum, p) => sum + p.game.minutes, 0);
const duration = (minutes) => (!minutes ? "–" : minutes < 90 ? `${num(Math.round(minutes))} min` : `${num(Math.round(minutes / 60))} uur`);
const daysOf = (minutes) => (minutes / 1440).toLocaleString(LOCALE, { maximumFractionDigits: 1 });
const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optioneel */ } };

/* --- Data ---------------------------------------------------------------- */

function prepare(raw) {
  const players = raw.players;
  const games = raw.games.map(([name, bgg, coop, year, designers, image, minutes, genres]) => ({
    name, bgg, coop, year, image, minutes: minutes || 0, designers: designers ? designers.split(/,\s*/) : [], genres: genres || [],
  }));
  const plays = raw.plays.map(([when, g, l, digital, board, people, duration, table]) => {
    const [year, month, day] = when.slice(0, 10).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const hour = when.length > 11 ? Number(when.slice(11, 13)) : null;
    return {
      when, year, month: month - 1, day, date, hour, board, duration: duration || 0, table: table || null,
      key: when.slice(0, 10), ym: when.slice(0, 7), dow: (date.getDay() + 6) % 7,
      game: games[g], location: raw.locations[l] || "Geen locatie", digital: digital === 1,
      people: people.map(([i, score, win, role, isNew, rank, start]) => ({
        name: i < 0 ? NO_NAME : players[i], score, win: win === 1, role, isNew: isNew === 1, rank: rank || 0, start: start === 1,
      })),
    };
  }).sort((a, b) => (a.when < b.when ? 1 : -1));
  plays.forEach((p) => { p.anyWin = p.people.some((x) => x.win); });
  return { me: raw.me, plays, games, byName: new Map(games.map((g) => [g.name, g])), genres: raw.genres || {}, updated: raw.updated };
}

function resultFor(play, name) {
  const person = play.people.find((x) => x.name === name);
  if (!person) return null;
  if (person.win) return "W";
  return play.game.coop || play.anyWin ? "L" : "D";
}

function record(plays, name) {
  const r = { plays: 0, W: 0, D: 0, L: 0, last: "", minutes: 0 };
  plays.forEach((p) => {
    const result = resultFor(p, name);
    if (!result) return;
    r.plays += 1;
    r[result] += 1;
    r.minutes += p.game.minutes;
    if (p.key > r.last) r.last = p.key;
  });
  r.rate = r.W + r.L ? r.W / (r.W + r.L) : null;
  return r;
}

/* "Het spel" wint elk coöperatief potje waarin niemand wint. */
function gameRecord(plays) {
  const W = plays.filter((p) => !p.anyWin).length;
  const L = plays.length - W;
  const last = plays.reduce((max, p) => (p.key > max ? p.key : max), "");
  return { plays: plays.length, W, L, D: 0, last, minutes: minutesOf(plays), rate: plays.length ? W / plays.length : null };
}

function periodMatch(p) {
  const period = state.period;
  if (period === "all") return true;
  if (period === "custom") return (!state.from || p.key >= state.from) && (!state.to || p.key <= state.to);
  if (period[0] === "y") return String(p.year) === period.slice(1);
  return (Date.now() - p.date.getTime()) / 864e5 <= Number(period.slice(1));
}

function sizeMatch(p) {
  if (!state.size) return true;
  const count = p.people.length;
  return state.size === "5+" ? count >= 5 : count === Number(state.size);
}

function select() {
  scoped = db.plays.filter((p) =>
    (state.type === "Alles" || p.digital === (state.type === "Digitaal"))
    && periodMatch(p) && sizeMatch(p)
    && (!state.game || p.game.name === state.game)
    && (!state.loc || p.location === state.loc)
    && (!state.kind || p.game.coop === (state.kind === "coop"))
    && (!state.genre || p.game.genres.includes(state.genre))
    && (!state.mate || p.people.some((x) => x.name === state.mate)));
  mine = scoped.filter((p) => p.people.some((x) => x.name === state.me));
}

function groupBy(plays, keyOf) {
  const groups = new Map();
  plays.forEach((p) => {
    const key = keyOf(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return groups;
}

function gameRows(plays) {
  return [...groupBy(plays, (p) => p.game.name).entries()].map(([name, list]) => ({
    name, game: list[0].game, list, live: list.filter((p) => !p.digital).length, ...record(list, state.me),
  }));
}

function streaks(plays) {
  const chrono = [...plays].reverse().map((p) => resultFor(p, state.me)).filter((r) => r && r !== "D");
  let bestWin = 0; let bestLoss = 0; let run = 0; let last = null;
  chrono.forEach((r) => {
    run = r === last ? run + 1 : 1;
    last = r;
    if (r === "W") bestWin = Math.max(bestWin, run);
    else bestLoss = Math.max(bestLoss, run);
  });
  return { current: last, length: run, bestWin, bestLoss };
}

function hIndex(rows) {
  const sorted = rows.map((r) => r.plays).sort((a, b) => b - a);
  let h = 0;
  while (h < sorted.length && sorted[h] >= h + 1) h += 1;
  return h;
}

function rivals(plays) {
  const table = new Map();
  plays.forEach((p) => {
    const mineResult = resultFor(p, state.me);
    p.people.forEach((x) => {
      if (x.name === state.me || x.name === NO_NAME) return;
      if (!table.has(x.name)) table.set(x.name, { name: x.name, plays: 0, beat: 0, lost: 0, even: 0, teamWin: 0, teamLoss: 0, list: [] });
      const row = table.get(x.name);
      row.plays += 1;
      row.list.push(p);
      if (p.game.coop) {
        if (mineResult === "W") row.teamWin += 1; else row.teamLoss += 1;
      } else {
        const iWon = mineResult === "W";
        if (iWon && !x.win) row.beat += 1;
        else if (x.win && !iWon) row.lost += 1;
        else row.even += 1;
      }
    });
  });
  const coop = plays.filter((p) => p.game.coop && resultFor(p, state.me));
  if (coop.length) {
    const lost = coop.filter((p) => resultFor(p, state.me) === "L").length;
    table.set(THE_GAME, { name: THE_GAME, plays: coop.length, beat: coop.length - lost, lost, even: 0, teamWin: 0, teamLoss: 0, list: coop, virtual: true });
  }
  return [...table.values()];
}

/* --- Filters ------------------------------------------------------------- */

function fillSelect(id, options, value) {
  const node = $(id);
  node.replaceChildren(...options.map(([v, label]) => new Option(label, v)));
  node.value = options.some(([v]) => v === value) ? value : options[0][0];
}

function buildFilters() {
  const counts = new Map();
  db.plays.forEach((p) => p.people.forEach((x) => counts.set(x.name, (counts.get(x.name) || 0) + 1)));
  const people = [...counts.entries()].filter(([name, n]) => name !== NO_NAME && n >= 3).sort((a, b) => b[1] - a[1]);
  if (!people.some(([name]) => name === state.me)) state.me = db.me;
  fillSelect("me", people.map(([name, n]) => [name, `${name} (${num(n)})`]), state.me);

  const years = [...new Set(db.plays.map((p) => p.year))].sort((a, b) => b - a);
  fillSelect("f-period", [["all", "Altijd"], ["d30", "Laatste 30 dagen"], ["d90", "Laatste 90 dagen"], ["d365", "Laatste 12 maanden"],
    ...years.map((y) => [`y${y}`, String(y)]), ["custom", "Zelf kiezen"]], state.period);
  const names = [...new Set(db.plays.map((p) => p.game.name))].sort((a, b) => a.localeCompare(b, LOCALE));
  fillSelect("f-game", [["", "Alle spellen"], ...names.map((n) => [n, n])], state.game);
  fillSelect("f-mate", [["", "Iedereen"], ...people.map(([n]) => [n, n])], state.mate);
  const locs = [...groupBy(db.plays, (p) => p.location).entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => [n, n]);
  fillSelect("f-loc", [["", "Alle locaties"], ...locs], state.loc);
  fillSelect("f-size", [["", "Alle aantallen"], ["1", "Solo"], ["2", "2 spelers"], ["3", "3 spelers"], ["4", "4 spelers"], ["5+", "5 of meer"]], state.size);
  fillSelect("f-kind", [["", "Alle soorten"], ["comp", "Tegen elkaar"], ["coop", "Coöperatief"]], state.kind);
  const genres = Object.entries(db.genres).map(([key, g]) => [key, `${g.icon} ${g.label}`]).sort((a, b) => a[1].slice(3).localeCompare(b[1].slice(3), LOCALE));
  fillSelect("f-genre", [["", "Alle genres"], ...genres], state.genre);
}

const CHIP_FIELDS = [
  ["period", () => $("f-period").selectedOptions[0]?.text, "all"],
  ["game", () => state.game, ""], ["mate", () => `Met ${state.mate}`, ""], ["loc", () => state.loc, ""],
  ["size", () => $("f-size").selectedOptions[0]?.text, ""], ["kind", () => $("f-kind").selectedOptions[0]?.text, ""],
  ["genre", () => $("f-genre").selectedOptions[0]?.text, ""],
];

function renderChips() {
  const active = CHIP_FIELDS.filter(([field, , empty]) => state[field] !== empty);
  const chips = active.map(([field, label]) => `<button type="button" data-clear="${field}">${esc(label())} ✕</button>`);
  if (active.length > 1) chips.push('<button type="button" data-clear="all">Alles wissen</button>');
  $("chips").innerHTML = chips.join("");
  $("chips").hidden = !active.length;
  $("toggle-filters").innerHTML = active.length ? `Filters <b>${active.length}</b>` : "Filters";
}

function syncControls() {
  document.documentElement.dataset.type = state.type;
  document.querySelectorAll("#type-tokens button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === state.type)));
  $("views").innerHTML = VIEWS.map(([id, label, icon]) => `<a href="#${id}" ${state.view === id ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${label}</a>`).join("");
  const custom = state.period === "custom";
  $("custom-from").hidden = !custom;
  $("custom-to").hidden = !custom;
}

/* --- Grafieken ----------------------------------------------------------- */

function svg(width, height, content, label) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${content}</svg>`;
}

const topBar = (x, y, w, h, fill) => {
  const r = Math.min(4, w / 2, h);
  return `<path d="M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z" fill="${fill}"/>`;
};

/* Gestapelde kolommen; rijen zijn {label, tip, live, digital} of {label, tip, value}. */
function columns(width, rows, { height = 200, every = 1, color = COLORS.ink, label = "Staafdiagram" } = {}) {
  const bottom = height - 22;
  const top = 12;
  const total = (r) => (r.value ?? r.live + r.digital);
  const max = Math.max(...rows.map(total), 1);
  const step = (width - 30) / rows.length;
  const bar = Math.max(Math.min(step - 3, 34), 2);
  const y = (v) => ((bottom - top) * v) / max;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f)).filter((v, i, a) => a.indexOf(v) === i);
  let out = ticks.map((t) => `<line class="grid" x1="30" x2="${width}" y1="${bottom - y(t)}" y2="${bottom - y(t)}"/><text x="24" y="${bottom - y(t) + 4}" text-anchor="end">${num(t)}</text>`).join("");
  rows.forEach((r, i) => {
    const x = 30 + i * step + (step - bar) / 2;
    if (r.value !== undefined) {
      if (r.value) out += topBar(x, bottom - y(r.value), bar, y(r.value), r.color || color);
    } else {
      const lh = y(r.live); const dh = y(r.digital);
      const liveOnTop = r.digital === 0;
      if (r.live) out += liveOnTop ? topBar(x, bottom - lh, bar, lh, COLORS.live) : `<rect x="${x}" y="${bottom - lh}" width="${bar}" height="${lh}" fill="${COLORS.live}"/>`;
      if (r.digital) out += topBar(x, bottom - lh - dh - (r.live ? 2 : 0), bar, dh, COLORS.digital);
    }
    if (i % every === 0) out += `<text x="${x + bar / 2}" y="${height - 6}" text-anchor="middle">${esc(r.label)}</text>`;
    out += `<rect class="hit" x="${30 + i * step}" y="0" width="${step}" height="${bottom}" data-tip="${esc(r.tip)}"/>`;
  });
  return svg(width, height, out, label);
}

function line(width, series, { height = 200, min = 0, max = 1, format = (v) => v, mids = [], label = "Lijndiagram" } = {}) {
  const left = 38; const right = 44; const top = 10; const bottom = height - 22;
  const count = Math.max(...series.map((s) => s.points.length));
  const x = (i) => left + (i * (width - left - right)) / Math.max(count - 1, 1);
  const y = (v) => bottom - ((v - min) * (bottom - top)) / (max - min || 1);
  let out = [min, ...mids, max].map((t) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${format(t)}</text>`).join("");
  series.forEach((s) => {
    const path = s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
    if (series.length === 1) out += `<path d="${path}L${x(s.points.length - 1)} ${bottom}L${x(0)} ${bottom}Z" fill="${s.color}" opacity="0.13"/>`;
    out += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    const last = s.points[s.points.length - 1];
    if (last) {
      out += `<circle cx="${x(s.points.length - 1)}" cy="${y(last.value)}" r="4.5" fill="${s.color}"/>`;
      out += `<text class="label-strong" x="${x(s.points.length - 1) + 8}" y="${y(last.value) + 4}">${format(last.value)}</text>`;
    }
  });
  const first = series[0].points;
  if (first[0]) {
    out += `<text x="${left}" y="${height - 6}">${esc(first[0].label)}</text><text x="${width - right}" y="${height - 6}" text-anchor="end">${esc(first[first.length - 1].label)}</text>`;
  }
  const band = (width - left - right) / Math.max(count - 1, 1);
  first.forEach((p, i) => { out += `<rect class="hit" x="${x(i) - band / 2}" y="0" width="${Math.max(band, 1)}" height="${bottom}" data-tip="${esc(p.tip)}"/>`; });
  return svg(width, height, out, label);
}

function typeShade(ratio) {
  if (ratio <= 0) return "var(--cell)";
  const strength = [35, 55, 78, 100][Math.min(3, Math.floor(ratio * 4))];
  return `color-mix(in srgb, var(--heat) ${strength}%, white)`;
}

function calendar(width, plays) {
  const counts = groupBy(plays, (p) => p.key);
  const anchor = plays.length ? new Date(plays[0].date) : new Date();
  const end = new Date(anchor);
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)));
  const weeks = 53;
  const gap = 3;
  const cell = Math.min(16, Math.max(6, (width - 26 - gap * weeks) / weeks));
  const height = 20 + (cell + gap) * 7;
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);
  const max = Math.max(...[...counts.values()].map((l) => l.length), 1);
  let out = [0, 2, 4, 6].map((d) => `<text x="0" y="${20 + d * (cell + gap) + cell - 1}">${DAYS[d]}</text>`).join("");
  let lastMonth = -1;
  let lastLabelWeek = -3;
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const week = Math.floor(i / 7);
    const x = 26 + week * (cell + gap);
    const y = 20 + (i % 7) * (cell + gap);
    const list = counts.get(key) || [];
    if (i % 7 === 0 && d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      if (week < weeks - 1 && week - lastLabelWeek >= 3) {
        out += `<text x="${x}" y="10">${MONTHS[lastMonth]}</text>`;
        lastLabelWeek = week;
      }
    }
    const names = [...new Set(list.map((p) => p.game.name))].slice(0, 4).join(", ");
    out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${typeShade(list.length / max)}" data-tip="${esc(`${DATE_FORMAT.format(d)}: ${plural(list.length, "potje", "potjes")}${names ? `\n${names}` : ""}`)}"/>`;
  }
  return svg(26 + weeks * (cell + gap), height, out, "Kalender van speeldagen");
}

function dayHourGrid(width, plays) {
  const timed = plays.filter((p) => p.hour !== null);
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  timed.forEach((p) => { grid[p.dow][p.hour] += 1; });
  const max = Math.max(...grid.flat(), 1);
  const gap = 2;
  const cell = Math.max(8, (width - 26 - gap * 24) / 24);
  const tall = Math.min(cell, 26);
  let out = "";
  grid.forEach((row, d) => {
    out += `<text x="0" y="${16 + d * (tall + gap) + tall - 4}">${DAYS[d]}</text>`;
    row.forEach((n, h) => {
      out += `<rect x="${26 + h * (cell + gap)}" y="${16 + d * (tall + gap)}" width="${cell}" height="${tall}" rx="3" fill="${typeShade(n / max)}" data-tip="${esc(`${DAY_NAMES[d]} ${h}:00: ${plural(n, "potje", "potjes")}`)}"/>`;
    });
  });
  [0, 6, 12, 18].forEach((h) => { out += `<text x="${26 + h * (cell + gap)}" y="10">${h}:00</text>`; });
  return svg(26 + 24 * (cell + gap), 20 + 7 * (tall + gap), out, "Potjes per dag en uur");
}

function scatter(width, rows) {
  const data = rows.filter((r) => r.rate !== null && r.plays >= 2);
  const height = 300; const left = 38; const right = 16; const top = 10; const bottom = height - 26;
  const maxLog = Math.log(Math.max(...data.map((r) => r.plays), 2));
  const x = (n) => left + (Math.log(n) / maxLog) * (width - left - right);
  const y = (v) => bottom - v * (bottom - top);
  let out = [0, 0.5, 1].map((t) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${rate(t)}</text>`).join("");
  const ticks = [2, 5, 10, 20, 50, 100].filter((t) => t <= Math.exp(maxLog) * 1.01);
  out += ticks.map((t) => `<text x="${x(t)}" y="${height - 8}" text-anchor="middle">${t}</text>`).join("");
  const labelled = new Set();
  const usedRows = [];
  [...data].sort((a, b) => b.plays - a.plays).slice(0, 8).forEach((r) => {
    const row = y(r.rate);
    if (labelled.size < 5 && usedRows.every((other) => Math.abs(other - row) >= 15)) {
      labelled.add(r.name);
      usedRows.push(row);
    }
  });
  data.forEach((r) => {
    const color = r.live === r.plays ? COLORS.live : r.live === 0 ? COLORS.digital : COLORS.ink;
    out += `<circle class="mark" cx="${x(r.plays)}" cy="${y(r.rate)}" r="6.5" fill="${color}" data-game="${esc(r.name)}" data-tip="${esc(`${r.name}\n${plural(r.plays, "potje", "potjes")} · ${rate(r.rate)} gewonnen`)}"/>`;
    if (labelled.has(r.name)) {
      const end = x(r.plays) > width - 120;
      out += `<text class="label-strong" x="${x(r.plays) + (end ? -10 : 10)}" y="${y(r.rate) + 4}" text-anchor="${end ? "end" : "start"}">${esc(r.name.slice(0, 22))}</text>`;
    }
  });
  return svg(width, height, out, "Winratio tegen aantal potjes per spel");
}

function hbars(rows, { color } = {}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return `<div class="bars">${rows.map((r) => {
    const segments = r.live !== undefined
      ? `${r.live ? `<i style="width:${(r.live / max) * 100}%"></i>` : ""}${r.digital ? `<i class="d" style="width:${(r.digital / max) * 100}%"></i>` : ""}`
      : `<i style="width:${(r.total / max) * 100}%;background:${color || COLORS.ink}"></i>`;
    const name = r.game ? `<span class="name with-thumb" title="${esc(r.name)}">${thumb(r.game)}<span>${esc(r.name)}</span></span>` : `<span class="name" title="${esc(r.name)}">${esc(r.name)}</span>`;
    return `<div class="bar-row" data-tip="${esc(r.tip || "")}">${name}<div class="stack">${segments}</div><span class="value">${esc(r.value)}</span></div>`;
  }).join("")}</div>`;
}

function drawCharts() {
  document.querySelectorAll("[data-chart]").forEach((node) => {
    const draw = charts[node.dataset.chart];
    if (draw && node.clientWidth >= 160) node.innerHTML = draw(node.clientWidth);
  });
}

const liveDigital = (list) => ({ live: list.filter((p) => !p.digital).length, digital: list.filter((p) => p.digital).length });
const legend = () => (state.type === "Alles" ? '<div class="legend"><span><i class="dot live"></i>Live</span><span><i class="dot digital"></i>Digitaal</span></div>' : "");
const emptyView = (text) => `<div class="panel empty">${esc(text)}</div>`;

function monthsBetween(plays) {
  const keys = [...new Set(plays.map((p) => p.ym))].sort();
  const out = [];
  if (!keys.length) return out;
  let [y, m] = keys[0].split("-").map(Number);
  const last = keys[keys.length - 1];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) return out;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

/* --- Overzicht ----------------------------------------------------------- */

function dial(r) {
  const size = 196; const stroke = 24; const radius = (size - stroke) / 2; const length = 2 * Math.PI * radius;
  const total = r.W + r.D + r.L || 1;
  let offset = 0;
  const parts = [["W", "var(--win)"], ["D", "var(--draw)"], ["L", "var(--loss)"]].map(([key, color]) => {
    const part = (r[key] / total) * length;
    const arc = part > 3 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${part - 3} ${length - part + 3}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : "";
    offset += part;
    return arc;
  }).join("");
  return `<div class="dial"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Winratio ${rate(r.rate, 1)}">${parts}</svg><div><strong>${rate(r.rate, 1)}</strong><small>winratio</small></div></div>`;
}

function stat(label, value, note = "") {
  return `<div class="stat"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(note)}</small></div>`;
}

function formGuide(plays) {
  const last = plays.slice(0, 24).reverse();
  return `<div class="form"><span>Laatste ${last.length}</span>${last.map((p) => {
    const r = resultFor(p, state.me);
    return `<i class="pip ${r}" data-tip="${esc(`${dateLabel(p)}\n${p.game.name}\n${{ W: "Gewonnen", L: "Verloren", D: "Geen winnaar" }[r]}`)}">${{ W: "W", L: "V", D: "=" }[r]}</i>`;
  }).join("")}</div>`;
}

function splitPanel() {
  const rows = [["Live", mine.filter((p) => !p.digital), COLORS.live], ["Digitaal", mine.filter((p) => p.digital), COLORS.digital]];
  return `<section class="panel"><div class="panel-head"><div><h2>Live tegen digitaal</h2><p class="hint">Winratio binnen je huidige filters</p></div></div>
    ${rows.map(([name, list, color]) => {
      const r = record(list, state.me);
      return `<div class="split-row"><b>${name}</b><div class="track" style="--bar:${color}"><i style="width:${(r.rate ?? 0) * 100}%"></i></div><span class="value">${rate(r.rate, 1)} · ${num(r.plays)}× · ${duration(r.minutes)}</span></div>`;
    }).join("")}
  </section>`;
}

function firstPlayOf(name) {
  const list = db.plays;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].game.name === name && list[i].people.some((x) => x.name === state.me)) return list[i];
  }
  return null;
}

function buildAwards(rows, rivalRows) {
  const list = [];
  const add = (label, value, note, game) => list.push({ label, value, note, game });
  const enough = Math.min(5, Math.max(2, Math.round(mine.length / 40)));
  const rated = rows.filter((r) => r.plays >= enough && r.rate !== null);
  const fav = [...rows].sort((a, b) => b.plays - a.plays)[0];
  if (fav) add("Meest gespeeld", fav.name, plural(fav.plays, "potje", "potjes"), fav.game);
  const hog = [...rows].sort((a, b) => b.minutes - a.minutes)[0];
  if (hog?.minutes) add("Tijdvreter", hog.name, `Zo'n ${duration(hog.minutes)} speeltijd`, hog.game);
  const quick = rows.filter((r) => r.plays >= enough && r.game.minutes).sort((a, b) => a.game.minutes - b.game.minutes)[0];
  if (quick) add("Snelle hap", quick.name, `Zo'n ${quick.game.minutes} minuten per potje`, quick.game);
  if (rated.length) {
    const best = [...rated].sort((a, b) => b.rate - a.rate || b.plays - a.plays)[0];
    const worst = [...rated].sort((a, b) => a.rate - b.rate || b.plays - a.plays)[0];
    add("Beste spel", best.name, `${rate(best.rate)} gewonnen in ${num(best.plays)} potjes`, best.game);
    add("Lastigste spel", worst.name, `${rate(worst.rate)} gewonnen in ${num(worst.plays)} potjes`, worst.game);
  }
  const duels = rivalRows.filter((r) => r.beat + r.lost >= enough);
  if (duels.length) {
    const score = (r) => r.beat / (r.beat + r.lost);
    const nemesis = [...duels].sort((a, b) => score(a) - score(b) || b.lost - a.lost)[0];
    const prey = [...duels].sort((a, b) => score(b) - score(a) || b.beat - a.beat)[0];
    add("Aartsrivaal", nemesis.name, `${num(nemesis.beat)} gewonnen, ${num(nemesis.lost)} verloren`);
    add("Favoriete prooi", prey.name, `${num(prey.beat)} gewonnen, ${num(prey.lost)} verloren`);
  }
  const buddy = rivalRows.filter((r) => !r.virtual).sort((a, b) => b.plays - a.plays)[0];
  if (buddy) add("Vaste medespeler", buddy.name, plural(buddy.plays, "potje", "potjes"));
  const team = rivalRows.filter((r) => r.teamWin + r.teamLoss >= enough).sort((a, b) => b.teamWin / (b.teamWin + b.teamLoss) - a.teamWin / (a.teamWin + a.teamLoss))[0];
  if (team) add("Beste co-op-maatje", team.name, `${num(team.teamWin)} van ${num(team.teamWin + team.teamLoss)} samen gewonnen`);
  const days = [...groupBy(mine, (p) => p.key).values()].sort((a, b) => b.length - a.length)[0];
  if (days) add("Drukste speeldag", dateLabel(days[0]), plural(days.length, "potje", "potjes"));
  const marathon = [...groupBy(mine, (p) => p.key).values()].sort((a, b) => minutesOf(b) - minutesOf(a))[0];
  if (marathon && minutesOf(marathon)) add("Marathondag", dateLabel(marathon[0]), `Zo'n ${duration(minutesOf(marathon))} gespeeld`);
  const month = [...groupBy(mine, (p) => p.ym).entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (month) add("Drukste maand", monthLabel(month[0]), plural(month[1].length, "potje", "potjes"));
  let margin = null;
  mine.forEach((p) => {
    const me = p.people.find((x) => x.name === state.me);
    const others = p.people.filter((x) => x !== me && x.score !== null).map((x) => x.score);
    if (me?.win && me.score !== null && others.length && !p.game.coop) {
      const gap = me.score - Math.max(...others);
      if (!margin || gap > margin.gap) margin = { gap, p };
    }
  });
  if (margin && margin.gap > 0) add("Grootste overwinning", margin.p.game.name, `${num(margin.gap)} punten verschil op ${dateLabel(margin.p)}`, margin.p.game);
  const firsts = rows.map((r) => ({ name: r.name, first: firstPlayOf(r.name) })).filter((r) => r.first).sort((a, b) => (a.first.when < b.first.when ? 1 : -1));
  if (firsts[0]) add("Nieuwste ontdekking", firsts[0].name, `Voor het eerst op ${dateLabel(firsts[0].first)}`, firsts[0].first.game);
  const dusty = rows.filter((r) => r.plays >= 3).sort((a, b) => (a.last < b.last ? -1 : 1))[0];
  if (dusty) add("Stoffigste favoriet", dusty.name, `Laatst gespeeld op ${dusty.last.split("-").reverse().join("-")}`, dusty.game);
  const place = [...groupBy(mine.filter((p) => !p.digital), (p) => p.location).entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (place) add("Vaste speelplek", place[0], plural(place[1].length, "potje", "potjes"));
  return list;
}

function viewOverview() {
  const r = record(mine, state.me);
  const rows = gameRows(mine);
  const s = streaks(mine);
  const days = new Set(mine.map((p) => p.key)).size;
  const rivalRows = rivals(mine);
  const streakNote = s.current ? (s.current === "W" ? "op rij gewonnen" : "op rij verloren") : "";
  const awards = buildAwards(rows, rivalRows);
  const series = monthsBetween(mine).map((key) => ({ key, list: mine.filter((p) => p.ym === key) }));
  charts.months = (w) => columns(w, series.map(({ key, list }) => {
    const split = liveDigital(list);
    return { label: monthLabel(key), ...split, tip: `${monthLabel(key)}: ${plural(list.length, "potje", "potjes")}\n${num(split.live)} live · ${num(split.digital)} digitaal` };
  }), { every: Math.ceil(series.length / Math.max(4, Math.floor(w / 80))), label: "Potjes per maand" });
  charts.form = (w) => {
    const chrono = [...mine].reverse().map((p) => ({ p, r: resultFor(p, state.me) })).filter((x) => x.r !== "D");
    const size = Math.min(30, Math.max(5, Math.floor(chrono.length / 8)));
    const points = [];
    let wins = 0;
    chrono.forEach((x, i) => {
      wins += x.r === "W" ? 1 : 0;
      if (i >= size) wins -= chrono[i - size].r === "W" ? 1 : 0;
      if (i >= size - 1) points.push({ value: wins / size, label: dateLabel(x.p), tip: `${dateLabel(x.p)}\n${rate(wins / size)} over de laatste ${size} potjes` });
    });
    const stride = Math.max(1, Math.ceil(points.length / 300));
    const thin = points.filter((_, i) => i % stride === 0 || i === points.length - 1);
    if (thin.length < 2) return '<p class="empty">Te weinig potjes voor een vormlijn.</p>';
    return line(w, [{ color: "var(--win)", points: thin }], { mids: [0.5], format: (v) => rate(v), label: `Winratio over de laatste ${size} potjes` });
  };
  charts.calendar = (w) => calendar(w, mine);
  const formPanel = '<section class="panel"><div class="panel-head"><div><h2>Vorm</h2><p class="hint">Winratio over je laatste potjes</p></div></div><div class="chart" data-chart="form"></div></section>';
  return `
  <section class="scorecard">
    ${dial(r)}
    <div>
      <p class="who-big">${esc(state.me)}</p>
      <p class="who-sub">${num(r.W)} gewonnen · ${num(r.L)} verloren${r.D ? ` · ${num(r.D)} zonder winnaar` : ""}</p>
      <div class="record">
        ${stat("Potjes", num(r.plays), plural(days, "speeldag", "speeldagen"))}
        ${stat("Speeltijd", `±${duration(r.minutes)}`, `zo'n ${daysOf(r.minutes)} dagen`)}
        ${stat("Spellen", num(rows.length), `h-index ${hIndex(rows)}`)}
        ${stat("Huidige reeks", num(s.current ? s.length : 0), streakNote)}
        ${stat("Beste winreeks", num(s.bestWin), "potjes op rij")}
      </div>
      ${formGuide(mine)}
    </div>
  </section>
  ${state.type === "Alles" ? `<div class="grid-2">${splitPanel()}${formPanel}</div>` : formPanel}
  <section class="panel"><div class="panel-head"><h2>Prijzenkast</h2></div><div class="awards">${awards.map((a) => `<${a.game ? `button type="button" data-game="${esc(a.game.name)}"` : "div"} class="award${a.game ? " has-game" : ""}"><i aria-hidden="true">${AWARD_ICONS[a.label] || "🎉"}</i>${a.game ? thumb(a.game, "lg") : ""}<span>${esc(a.label)}</span><strong>${esc(a.value)}</strong><small>${esc(a.note)}</small></${a.game ? "button" : "div"}>`).join("")}</div></section>
  <section class="panel"><div class="panel-head"><h2>Potjes per maand</h2>${legend()}</div><div class="chart" data-chart="months"></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Speelkalender</h2><p class="hint">De laatste 53 weken van deze selectie</p></div></div><div class="table-wrap"><div class="chart" data-chart="calendar"></div></div></section>`;
}

/* --- Klassement ---------------------------------------------------------- */

function leaderboard() {
  const people = new Map();
  scoped.forEach((p) => p.people.forEach((x) => {
    if (x.name === NO_NAME) return;
    if (!people.has(x.name)) people.set(x.name, []);
    people.get(x.name).push(p);
  }));
  const rows = [...people.entries()].map(([name, list]) => ({
    name, ...record(list, name),
    liveRate: record(list.filter((p) => !p.digital), name).rate,
    digitalRate: record(list.filter((p) => p.digital), name).rate,
  }));
  const coop = scoped.filter((p) => p.game.coop);
  if (coop.length) rows.push({ name: THE_GAME, virtual: true, ...gameRecord(coop), liveRate: gameRecord(coop.filter((p) => !p.digital)).rate, digitalRate: gameRecord(coop.filter((p) => p.digital)).rate });
  return rows;
}

function viewLeaderboard() {
  const key = { rate: (r) => r.rate ?? -1, wins: (r) => r.W, plays: (r) => r.plays, time: (r) => r.minutes }[state.lbSort];
  const rows = leaderboard().filter((r) => r.plays >= state.lbMin).sort((a, b) => key(b) - key(a) || b.plays - a.plays);
  const metric = (r) => (state.lbSort === "rate" ? rate(r.rate, 1) : state.lbSort === "wins" ? `${num(r.W)} winst` : state.lbSort === "time" ? `±${duration(r.minutes)}` : `${num(r.plays)} potjes`);
  const podium = rows.slice(0, 3).map((r, i) => `<button type="button" class="step p${i + 1}" ${r.virtual ? "" : `data-person="${esc(r.name)}"`}>${r.virtual ? '<span class="die-mini" aria-hidden="true">🎲</span>' : meeple(["var(--gold)", "var(--silver)", "var(--bronze)"][i])}<span class="medal">${i + 1}</span><strong>${esc(r.name)}</strong><small>${metric(r)}</small></button>`).join("");
  return `<section class="panel">
    <div class="panel-head">
      <div><h2>Klassement</h2><p class="hint">Iedereen in de gekozen potjes. Klik op een naam om het scoreboard vanuit die persoon te bekijken.</p></div>
      <div class="inline-controls">
        <label><span>Sorteer op</span><select id="lb-sort"><option value="rate">Winratio</option><option value="wins">Winst</option><option value="plays">Potjes</option><option value="time">Speeltijd</option></select></label>
        <label><span>Minimaal aantal potjes</span><input type="number" id="lb-min" min="1" value="${state.lbMin}"></label>
      </div>
    </div>
    ${rows.length >= 3 ? `<div class="podium">${podium}</div>` : ""}
    ${rows.length ? `<div class="table-wrap tall"><table><thead><tr><th>#</th><th>Speler</th><th class="num">Potjes</th><th class="num">Winst</th><th class="num">Verlies</th><th class="num">Winratio</th><th class="num">Speeltijd</th><th class="num">Live</th><th class="num">Digitaal</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.name === state.me ? "me" : ""}"><td>${i + 1}</td><td>${r.virtual ? `<b title="Wint elk coöperatief potje dat niemand wint">🎲 ${esc(r.name)}</b>` : `<button type="button" class="link" data-person="${esc(r.name)}">${esc(r.name)}</button>`}</td><td class="num">${num(r.plays)}</td><td class="num">${num(r.W)}</td><td class="num">${num(r.L)}</td><td class="num">${rate(r.rate, 1)}</td><td class="num">±${duration(r.minutes)}</td><td class="num muted">${rate(r.liveRate)}</td><td class="num muted">${rate(r.digitalRate)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="empty">Niemand haalt dit minimum aantal potjes. Verlaag het minimum of wis filters.</p>'}
  </section>`;
}

/* --- Spellen ------------------------------------------------------------- */

const art = (game) => (game.image ? `<img src="${esc(game.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${esc(initials(game.name))}">` : esc(initials(game.name)));

/* Kleine cover naast een spelnaam; game is een spelobject of een naam. */
function thumb(game, size = "") {
  const g = typeof game === "string" ? db.byName.get(game) : game;
  return g ? `<span class="thumb ${size}" aria-hidden="true">${art(g)}</span>` : "";
}

/* Eindplaats van een speler: uit BG Stats, of afgeleid uit de scores. Co-op heeft geen plaats. */
function placeOf(p, name) {
  const me = p.people.find((x) => x.name === name);
  if (!me || p.game.coop || p.people.length < 2) return null;
  if (me.rank > 0) return me.rank;
  if (me.win) return 1;
  if (me.score === null || p.people.some((x) => x.score === null)) return null;
  return Math.max(2, 1 + p.people.filter((x) => x.score > me.score).length);
}

const average = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

/* Hoe goed is iemand in een spel, los van wie de tegenstanders zijn? */
function gameStats(list, name) {
  const mineList = list.filter((p) => p.people.some((x) => x.name === name));
  const places = [];
  let beaten = 0; let opponents = 0;
  const asStart = []; const notStart = []; const margins = []; const durations = []; const scores = [];
  mineList.forEach((p) => {
    const me = p.people.find((x) => x.name === name);
    const place = placeOf(p, name);
    if (place) {
      places.push({ place, size: p.people.length });
      beaten += p.people.length - place;
      opponents += p.people.length - 1;
    }
    if (me.start) asStart.push(p); else if (p.people.some((x) => x.start)) notStart.push(p);
    if (me.score !== null) {
      scores.push(me.score);
      const others = p.people.filter((x) => x !== me && x.score !== null).map((x) => x.score);
      if (others.length && !p.game.coop) margins.push(me.score - Math.max(...others));
    }
    if (p.duration) durations.push(p.duration);
  });
  const chrono = [...mineList].reverse();
  const half = Math.floor(chrono.length / 2);
  const early = record(chrono.slice(0, half), name).rate;
  const late = record(chrono.slice(half), name).rate;
  return {
    plays: mineList.length,
    place: average(places.map((x) => x.place)),
    places,
    beaten: opponents ? beaten / opponents : null,
    start: asStart.length >= 3 && notStart.length >= 3 ? { yes: record(asStart, name), no: record(notStart, name) } : null,
    margin: average(margins),
    duration: average(durations),
    durations: durations.length,
    score: average(scores),
    best: scores.length ? Math.max(...scores) : null,
    trend: chrono.length >= 6 && early !== null && late !== null ? late - early : null,
  };
}

const oneDecimal = (value) => (value === null ? "–" : (Math.round(value * 10) / 10).toLocaleString(LOCALE));
function trendLabel(diff) {
  if (diff === null) return '<span class="muted">–</span>';
  const points = Math.round(diff * 100);
  if (Math.abs(points) < 5) return '<span class="D-text" title="Ongeveer gelijk gebleven">= gelijk</span>';
  return points > 0
    ? `<span class="W-text" title="Winratio tweede helft tegen eerste helft van je potjes">▲ +${points}%</span>`
    : `<span class="L-text" title="Winratio tweede helft tegen eerste helft van je potjes">▼ ${points}%</span>`;
}

function performancePanel(rows) {
  const list = rows.filter((r) => r.plays >= 2).map((r) => ({ ...r, stats: gameStats(r.list, state.me) }));
  if (!list.length) return "";
  return `<section class="panel"><div class="panel-head"><div><h2>Hoe goed ben je per spel?</h2>
    <p class="hint">Handig als je vooral tegen onbekenden speelt. "Boven tegenstanders" is het deel van je tegenstanders dat achter je eindigde. De trend vergelijkt je laatste helft potjes met je eerste helft.</p></div></div>
    <div class="table-wrap tall"><table><thead><tr><th>Spel</th><th class="num">Potjes</th><th class="num">Winratio</th><th class="num">Gem. plek</th><th class="num">Boven tegenstanders</th><th class="num">Gem. score</th><th class="num">Beste score</th><th class="num">Trend</th></tr></thead><tbody>
    ${list.map((r) => `<tr><td><button type="button" class="link with-thumb" data-game="${esc(r.name)}">${thumb(r.game)}<span>${esc(r.name)}</span></button></td>
      <td class="num">${num(r.plays)}</td><td class="num">${rate(r.rate)}</td>
      <td class="num">${r.stats.place === null ? "–" : `${oneDecimal(r.stats.place)}e`}</td><td class="num">${rate(r.stats.beaten)}</td>
      <td class="num">${oneDecimal(r.stats.score)}</td><td class="num">${r.stats.best === null ? "–" : num(r.stats.best)}</td><td class="num">${trendLabel(r.stats.trend)}</td></tr>`).join("")}
    </tbody></table></div></section>`;
}

function coverCard(r) {
  return `<button type="button" class="cover" data-game="${esc(r.name)}"><div class="art">${art(r.game)}</div><div class="meta"><strong title="${esc(r.name)}">${esc(r.name)}</strong><small>${num(r.plays)}× · ${rate(r.rate)} gewonnen</small><small>${r.minutes ? `±${duration(r.minutes)} speeltijd` : "Speelduur onbekend"}</small></div></button>`;
}

function viewGames() {
  const rows = gameRows(mine);
  const search = state.gameSearch.toLowerCase();
  const sorters = {
    plays: (a, b) => b.plays - a.plays, rate: (a, b) => (b.rate ?? -1) - (a.rate ?? -1), last: (a, b) => (a.last < b.last ? 1 : -1),
    time: (a, b) => b.minutes - a.minutes, year: (a, b) => (b.game.year || 0) - (a.game.year || 0), name: (a, b) => a.name.localeCompare(b.name, LOCALE),
  };
  const shown = rows.filter((r) => r.name.toLowerCase().includes(search)).sort(sorters[state.gameSort]);
  const designers = new Map();
  rows.forEach((r) => r.game.designers.forEach((d) => {
    if (!designers.has(d)) designers.set(d, { plays: 0, W: 0, L: 0, titles: 0 });
    const row = designers.get(d);
    row.plays += r.plays; row.W += r.W; row.L += r.L; row.titles += 1;
  }));
  const topDesigners = [...designers.entries()].filter(([d]) => d !== "(Uncredited)").sort((a, b) => b[1].plays - a[1].plays).slice(0, 10);
  const decades = new Map();
  rows.forEach((r) => {
    if (!r.game.year || r.game.year < 1950) return;
    const decade = Math.floor(r.game.year / 10) * 10;
    decades.set(decade, (decades.get(decade) || 0) + r.plays);
  });
  const timeRows = rows.filter((r) => r.minutes).sort((a, b) => b.minutes - a.minutes).slice(0, 10);
  charts.scatter = (w) => scatter(w, rows);
  charts.decades = (w) => columns(w, [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ label: `${d}s`, value: n, color: "var(--type)", tip: `Spellen uit de ${d}s: ${plural(n, "potje", "potjes")}` })), { height: 190, label: "Potjes per uitgavedecennium" });
  return `
  ${performancePanel(shown)}
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><div><h2>Liefde tegen talent</h2><p class="hint">Rechts speel je het vaakst, boven win je het vaakst. Klik op een stip.</p></div><div class="legend"><span><i class="dot live"></i>Alleen live</span><span><i class="dot digital"></i>Alleen digitaal</span></div></div><div class="chart" data-chart="scatter"></div></section>
    <section class="panel"><div class="panel-head"><h2>Favoriete ontwerpers</h2></div>${hbars(topDesigners.map(([d, r]) => ({ name: d, total: r.plays, value: `${num(r.plays)}× · ${rate(r.W + r.L ? r.W / (r.W + r.L) : null)}`, tip: `${d}\n${plural(r.titles, "spel", "spellen")}, ${plural(r.plays, "potje", "potjes")}` })), { color: "var(--type)" })}</section>
  </div>
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><div><h2>Waar gaat je tijd heen?</h2><p class="hint">Aantal potjes × gemiddelde speelduur</p></div>${legend()}</div>${hbars(timeRows.map((r) => ({ name: r.name, total: r.minutes, live: r.live * r.game.minutes, digital: (r.plays - r.live) * r.game.minutes, value: `±${duration(r.minutes)}`, game: r.game, tip: `${r.name}\nZo'n ${r.game.minutes} minuten per potje · ${plural(r.plays, "potje", "potjes")}` })))}</section>
    <section class="panel"><div class="panel-head"><h2>Hoe oud zijn je spellen?</h2></div><div class="chart" data-chart="decades"></div></section>
  </div>
  <section class="panel">
    <div class="panel-head"><div><h2>Al je spellen</h2><p class="hint">${plural(shown.length, "spel", "spellen")}. Klik voor records en klassement per spel.</p></div>
      <div class="inline-controls">
        <label><span>Zoeken</span><input type="search" id="game-search" value="${esc(state.gameSearch)}" placeholder="Naam van een spel"></label>
        <label><span>Sorteer op</span><select id="game-sort"><option value="plays">Meest gespeeld</option><option value="rate">Winratio</option><option value="time">Meeste speeltijd</option><option value="last">Laatst gespeeld</option><option value="year">Uitgavejaar</option><option value="name">Naam</option></select></label>
      </div></div>
    <div class="covers">${shown.map(coverCard).join("") || '<p class="empty">Geen spel gevonden.</p>'}</div>
  </section>`;
}

function openGame(name) {
  const list = scoped.filter((p) => p.game.name === name);
  if (!list.length) return;
  const game = list[0].game;
  const r = record(list, state.me);
  const scores = [];
  const people = new Map();
  const roles = new Map();
  const boards = new Map();
  list.forEach((p) => {
    if (p.board) boards.set(p.board, (boards.get(p.board) || 0) + 1);
    p.people.forEach((x) => {
      if (x.score !== null && x.name !== NO_NAME) scores.push({ name: x.name, score: x.score, p });
      if (x.name !== NO_NAME) {
        if (!people.has(x.name)) people.set(x.name, []);
        people.get(x.name).push(p);
      }
      if (x.role && x.name === state.me) roles.set(x.role, (roles.get(x.role) || 0) + 1);
    });
  });
  const myScores = [...list].reverse().map((p) => ({ p, score: p.people.find((x) => x.name === state.me)?.score })).filter((x) => x.score !== null && x.score !== undefined);
  const best = [...scores].sort((a, b) => b.score - a.score).slice(0, 5);
  const avg = myScores.length ? myScores.reduce((sum, x) => sum + x.score, 0) / myScores.length : null;
  const ranking = [...people.entries()].map(([who, plays]) => ({ who, ...record(plays, who) })).sort((a, b) => b.W - a.W || b.plays - a.plays).slice(0, 8);
  if (game.coop) ranking.unshift({ who: THE_GAME, ...gameRecord(list) });
  const split = liveDigital(list);
  const g = gameStats(list, state.me);
  const mineHere = list.filter((p) => p.people.some((x) => x.name === state.me));
  const bySize = [...groupBy(mineHere, (p) => Math.min(p.people.length, 6)).entries()].sort((a, b) => a[0] - b[0])
    .map(([n, plays]) => ({ n, plays, r: record(plays, state.me) }));
  const placeCounts = [...groupBy(g.places, (x) => Math.min(x.place, 5)).entries()].sort((a, b) => a[0] - b[0]);
  const skill = [
    g.place !== null ? stat("Gemiddelde plek", `${oneDecimal(g.place)}e`, `bij ${num(g.places.length)} uitslagen`) : "",
    g.beaten !== null ? stat("Boven tegenstanders", rate(g.beaten), "eindigde achter je") : "",
    g.trend !== null ? stat("Trend", trendLabel(g.trend), "laatste helft tegen eerste helft") : "",
    g.start ? stat("Als startspeler", rate(g.start.yes.rate), `anders ${rate(g.start.no.rate)}`) : "",
    g.margin !== null ? stat("Verschil met beste tegenstander", `${g.margin > 0 ? "+" : ""}${oneDecimal(g.margin)}`, "punten gemiddeld") : "",
    g.duration !== null ? stat("Echte speelduur", `${num(Math.round(g.duration))} min`, `gemeten bij ${plural(g.durations, "potje", "potjes")}`) : "",
    split.live && split.digital ? stat("Live tegen digitaal", `${rate(record(mineHere.filter((p) => !p.digital), state.me).rate)} / ${rate(record(mineHere.filter((p) => p.digital), state.me).rate)}`, "winratio live / digitaal") : "",
  ].filter(Boolean).join("");
  $("game-dialog").innerHTML = `
    <div class="game-head"><div class="art">${art(game)}</div>
      <div><h2>${esc(game.name)}</h2><p class="hint">${esc([game.year, game.designers.slice(0, 3).join(", "), game.coop ? "Coöperatief" : ""].filter(Boolean).join(" · "))}</p>
      ${game.bgg ? `<p class="hint"><a href="https://boardgamegeek.com/boardgame/${esc(game.bgg)}" target="_blank" rel="noopener" style="color:var(--ink)">Bekijk op BoardGameGeek</a></p>` : ""}</div>
      <button type="button" class="button" id="close-game">Sluiten</button></div>
    <div class="game-body">
      <div class="record">
        ${stat("Potjes", num(r.plays), `${num(split.live)} live · ${num(split.digital)} digitaal`)}
        ${stat("Winratio", rate(r.rate), `${num(r.W)} gewonnen, ${num(r.L)} verloren`)}
        ${stat("Speelduur", game.minutes ? `±${num(game.minutes)} min` : "–", r.minutes ? `samen zo'n ${duration(r.minutes)}` : "")}
        ${stat("Gemiddelde score", avg === null ? "–" : num(Math.round(avg * 10) / 10), plural(myScores.length, "score", "scores"))}
        ${stat("Hoogste score", myScores.length ? num(Math.max(...myScores.map((x) => x.score))) : "–", `van ${state.me}`)}
      </div>
      ${skill ? `<div><h3>Hoe goed ben je hierin?</h3><div class="record">${skill}</div></div>` : ""}
      ${bySize.length > 1 || placeCounts.length > 1 ? `<div class="grid-2">
        ${bySize.length > 1 ? `<div><h3>Winratio per aantal spelers</h3>${hbars(bySize.map((x) => ({ name: x.n === 1 ? "Solo" : x.n === 6 ? "6 of meer" : `${x.n} spelers`, total: (x.r.rate ?? 0) * 100, value: `${rate(x.r.rate)} · ${num(x.plays.length)}×` })), { color: "var(--win)" })}</div>` : ""}
        ${placeCounts.length > 1 ? `<div><h3>Eindplaatsen</h3>${hbars(placeCounts.map(([place, items]) => ({ name: place === 5 ? "5e of later" : `${place}e plaats`, total: items.length, value: `${num(items.length)}×` })), { color: "var(--type)" })}</div>` : ""}
      </div>` : ""}
      ${myScores.length >= 3 ? '<div><h3>Scores door de tijd</h3><div class="chart" data-chart="scores"></div></div>' : ""}
      <div class="grid-2">
        <div><h3>Klassement in dit spel</h3>${hbars(ranking.map((x) => ({ name: x.who, total: x.W, value: `${num(x.W)} van ${num(x.plays)}` })), { color: "var(--win)" })}</div>
        <div><h3>Topscores</h3>${best.length ? `<div class="bars">${best.map((x) => `<div class="muted"><b style="color:var(--ink)">${num(x.score)}</b> ${esc(x.name)} · ${dateLabel(x.p)}</div>`).join("")}</div>` : '<p class="muted">Geen scores bekend.</p>'}</div>
      </div>
      ${roles.size ? `<div><h3>Gespeelde rollen</h3><div class="chips-static">${[...roles.entries()].sort((a, b) => b[1] - a[1]).map(([role, n]) => `<span>${esc(role)} · ${num(n)}×</span>`).join("")}</div></div>` : ""}
      ${boards.size ? `<div><h3>Speelborden</h3><div class="chips-static">${[...boards.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([board, n]) => `<span>${esc(board)} · ${num(n)}×</span>`).join("")}</div></div>` : ""}
      <button type="button" class="button" id="filter-game" style="justify-self:start">Filter alles op dit spel</button>
    </div>`;
  charts.scores = (w) => {
    const values = myScores.map((x) => x.score);
    const low = Math.min(...values); const high = Math.max(...values);
    return line(w, [{ color: "var(--type)", points: myScores.map((x) => ({ value: x.score, label: dateLabel(x.p), tip: `${dateLabel(x.p)}: ${num(x.score)} punten` })) }], { height: 150, min: low, max: high === low ? low + 1 : high, format: (v) => num(Math.round(v)), label: "Scores door de tijd" });
  };
  $("close-game").onclick = () => $("game-dialog").close();
  $("filter-game").onclick = () => { state.game = name; $("game-dialog").close(); $("f-game").value = name; render(); };
  $("game-dialog").showModal();
  drawCharts();
}

/* --- Genres ------------------------------------------------------------- */

function genreRows(plays) {
  return Object.entries(db.genres).map(([key, g]) => {
    const list = plays.filter((p) => p.game.genres.includes(key));
    const top = gameRows(list).sort((a, b) => b.plays - a.plays)[0];
    return { key, ...g, list, top, titles: new Set(list.map((p) => p.game.name)).size, ...liveDigital(list), ...record(list, state.me) };
  }).filter((r) => r.plays);
}

function viewGenres() {
  const rows = genreRows(mine).sort((a, b) => b.plays - a.plays);
  if (!rows.length) return emptyView("Geen genres in deze selectie.");
  const enough = Math.min(10, Math.max(3, Math.round(mine.length / 60)));
  const rated = rows.filter((r) => r.plays >= enough && r.rate !== null).sort((a, b) => b.rate - a.rate);
  const fav = rows[0];
  const best = rated[0];
  const worst = rated[rated.length - 1];
  const timeRows = [...rows].sort((a, b) => b.minutes - a.minutes).slice(0, 10);
  const label = (r) => `${r.icon} ${r.label}`;
  return `
  <div class="grid-3">
    <section class="panel">${stat("Favoriete genre", `${fav.icon} ${esc(fav.label)}`, plural(fav.plays, "potje", "potjes"))}</section>
    <section class="panel">${best ? stat("Hier ben je sterk", `${best.icon} ${esc(best.label)}`, `${rate(best.rate)} gewonnen`) : stat("Hier ben je sterk", "–", `minimaal ${enough} potjes nodig`)}</section>
    <section class="panel">${worst && worst !== best ? stat("Hier valt nog te leren", `${worst.icon} ${esc(worst.label)}`, `${rate(worst.rate)} gewonnen`) : stat("Hier valt nog te leren", "–", `minimaal ${enough} potjes nodig`)}</section>
  </div>
  <section class="panel"><div class="panel-head"><div><h2>Al je genres</h2><p class="hint">Een spel kan in meer genres vallen. Klik op een genre om alles daarop te filteren.</p></div></div>
    <div class="genres">${rows.map((r) => `<button type="button" class="genre" data-genre="${esc(r.key)}" title="${esc(r.hint)}">
      <i aria-hidden="true">${r.icon}</i><strong>${esc(r.label)}</strong>
      <small>${num(r.plays)}× · ${plural(r.titles, "spel", "spellen")} · ±${duration(r.minutes)}</small>
      <span class="track" style="--bar:var(--win)"><i style="width:${(r.rate ?? 0) * 100}%"></i></span>
      <small>${r.rate === null ? "Geen winst of verlies" : `${rate(r.rate)} gewonnen`}</small>
      <small class="muted with-thumb">${thumb(r.top.game)}<span>Topper: ${esc(r.top.name)}</span></small>
    </button>`).join("")}</div></section>
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><h2>Wat speel je het meest?</h2>${legend()}</div>${hbars(rows.map((r) => ({ name: label(r), total: r.plays, live: r.live, digital: r.digital, value: `${num(r.plays)}×`, tip: `${r.label}\n${r.hint}\nMeest gespeeld: ${r.top.name}` })))}</section>
    <section class="panel"><div class="panel-head"><div><h2>Waar win je het vaakst?</h2><p class="hint">Genres met minimaal ${num(enough)} potjes</p></div></div>${rated.length ? hbars(rated.map((r) => ({ name: label(r), total: (r.rate ?? 0) * 100, value: `${rate(r.rate)} · ${num(r.plays)}×`, tip: `${r.label}: ${num(r.W)} gewonnen, ${num(r.L)} verloren` })), { color: "var(--win)" }) : '<p class="muted">Nog te weinig potjes.</p>'}</section>
  </div>
  <section class="panel"><div class="panel-head"><div><h2>Waar gaat je tijd heen per genre?</h2><p class="hint">Aantal potjes × gemiddelde speelduur</p></div>${legend()}</div>${hbars(timeRows.map((r) => ({ name: label(r), total: r.minutes, live: minutesOf(r.list.filter((p) => !p.digital)), digital: minutesOf(r.list.filter((p) => p.digital)), value: `±${duration(r.minutes)}` })))}</section>`;
}

/* --- Rivalen ------------------------------------------------------------- */

function viewRivals() {
  const rows = rivals(mine).sort((a, b) => b.plays - a.plays);
  if (!rows.length) return emptyView("Geen medespelers in deze selectie.");
  if (!rows.some((r) => r.name === state.rival)) state.rival = rows[0].name;
  const rival = rows.find((r) => r.name === state.rival);
  const duels = rival.virtual ? rival.list : rival.list.filter((p) => !p.game.coop);
  const perGame = [...groupBy(duels, (p) => p.game.name).entries()].map(([name, list]) => {
    let wins = 0; let losses = 0;
    list.forEach((p) => {
      const iWon = resultFor(p, state.me) === "W";
      const theyWon = rival.virtual ? !p.anyWin : resultFor(p, rival.name) === "W";
      if (iWon && !theyWon) wins += 1; else if (theyWon && !iWon) losses += 1;
    });
    return { name, wins, losses, total: list.length };
  }).sort((a, b) => b.total - a.total).slice(0, 10);
  const named = rows.filter((r) => r.plays >= 3);
  const teams = rows.filter((r) => r.teamWin + r.teamLoss > 0).sort((a, b) => (b.teamWin + b.teamLoss) - (a.teamWin + a.teamLoss)).slice(0, 10);
  return `
  <section class="panel">
    <div class="panel-head"><div><h2>Onderling</h2><p class="hint">Alleen potjes tegen elkaar; gelijke potjes en winst in hetzelfde team tellen niet mee.</p></div>
      <label><span>Tegenstander</span><select id="rival">${named.map((r) => `<option value="${esc(r.name)}" ${r.name === state.rival ? "selected" : ""}>${esc(r.name)} (${num(r.plays)})</option>`).join("") || `<option>${esc(rival.name)}</option>`}</select></label></div>
    <div class="versus"><div><strong>${num(rival.beat)}</strong><span>${esc(state.me)}</span></div><em>tegen</em><div><strong>${num(rival.lost)}</strong><span>${esc(rival.name)}</span></div></div>
    <p class="hint" style="text-align:center">${rival.virtual ? "Het spel wint elk coöperatief potje dat jullie niet winnen. " : ""}${plural(rival.plays, "potje", "potjes")} samen · zo'n ${duration(minutesOf(rival.list))} aan tafel${rival.virtual ? "" : ` · ${num(rival.even)} gelijk · samen in co-op ${num(rival.teamWin)} gewonnen en ${num(rival.teamLoss)} verloren`}</p>
  </section>
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><h2>Per spel tegen ${esc(rival.name)}</h2></div>${perGame.length ? hbars(perGame.map((g) => ({ name: g.name, game: g.name, total: g.total, value: `${num(g.wins)} – ${num(g.losses)}`, tip: `${g.name}: ${num(g.wins)} gewonnen, ${num(g.losses)} verloren, ${num(g.total)} potjes` })), { color: "var(--type)" }) : '<p class="muted">Nog geen potjes tegen elkaar.</p>'}</section>
    <section class="panel"><div class="panel-head"><h2>Beste co-op-teams</h2></div>${teams.length ? hbars(teams.map((r) => ({ name: r.name, total: r.teamWin + r.teamLoss, value: `${num(r.teamWin)} van ${num(r.teamWin + r.teamLoss)}` })), { color: "var(--win)" }) : '<p class="muted">Geen coöperatieve potjes samen.</p>'}</section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Alle tegenstanders</h2></div>
    <div class="table-wrap tall"><table><thead><tr><th>Speler</th><th class="num">Potjes</th><th class="num">Jij wint</th><th class="num">Zij winnen</th><th class="num">Saldo</th></tr></thead><tbody>
    ${named.map((r) => `<tr><td><button type="button" class="link" data-rival="${esc(r.name)}">${esc(r.name)}</button></td><td class="num">${num(r.plays)}</td><td class="num">${num(r.beat)}</td><td class="num">${num(r.lost)}</td><td class="num ${r.beat > r.lost ? "W-text" : r.beat < r.lost ? "L-text" : ""}">${r.beat > r.lost ? "+" : ""}${num(r.beat - r.lost)}</td></tr>`).join("")}
    </tbody></table></div></section>`;
}

/* --- Patronen ------------------------------------------------------------ */

function viewPatterns() {
  const byDay = DAYS.map((label, d) => {
    const list = mine.filter((p) => p.dow === d);
    const split = liveDigital(list);
    return { label, ...split, tip: `${DAY_NAMES[d]}: ${plural(list.length, "potje", "potjes")} · ${rate(record(list, state.me).rate)} gewonnen` };
  });
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const list = mine.filter((p) => p.hour === h);
    return { label: `${h}`, ...liveDigital(list), tip: `${h}:00: ${plural(list.length, "potje", "potjes")} · ${rate(record(list, state.me).rate)} gewonnen` };
  });
  const sizes = [...groupBy(mine, (p) => Math.min(p.people.length, 7)).entries()].sort((a, b) => a[0] - b[0]);
  const chrono = [...mine].reverse();
  const stride = Math.max(1, Math.ceil(chrono.length / 300));
  let live = 0; let digital = 0;
  const liveLine = []; const digitalLine = [];
  chrono.forEach((p, i) => {
    if (p.digital) digital += 1; else live += 1;
    if (i % stride === 0 || i === chrono.length - 1) {
      const tip = `${dateLabel(p)}\n${num(live)} live · ${num(digital)} digitaal`;
      liveLine.push({ value: live, label: dateLabel(p), tip });
      digitalLine.push({ value: digital, label: dateLabel(p), tip });
    }
  });
  const series = [];
  if (state.type !== "Digitaal") series.push({ color: COLORS.live, points: liveLine });
  if (state.type !== "Live") series.push({ color: COLORS.digital, points: digitalLine });
  const seen = new Set();
  const discovered = new Map();
  chrono.forEach((p) => {
    if (seen.has(p.game.name)) return;
    seen.add(p.game.name);
    discovered.set(p.ym, [...(discovered.get(p.ym) || []), p.game.name]);
  });
  const months = monthsBetween(mine);
  const milestones = [1, 50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 20000].filter((n) => n <= chrono.length);
  const timeMonths = months.map((key) => {
    const list = mine.filter((p) => p.ym === key);
    const liveHours = minutesOf(list.filter((p) => !p.digital)) / 60;
    const digitalHours = minutesOf(list.filter((p) => p.digital)) / 60;
    return { label: monthLabel(key), live: liveHours, digital: digitalHours, tip: `${monthLabel(key)}: zo'n ${num(Math.round(liveHours + digitalHours))} uur\n${num(Math.round(liveHours))} uur live · ${num(Math.round(digitalHours))} uur digitaal` };
  });
  charts.time = (w) => columns(w, timeMonths, { height: 190, every: Math.ceil(months.length / Math.max(4, Math.floor(w / 80))), label: "Geschatte speeltijd per maand in uren" });
  charts.days = (w) => columns(w, byDay, { height: 190, label: "Potjes per weekdag" });
  charts.hours = (w) => columns(w, byHour, { height: 190, every: w < 520 ? 3 : 2, label: "Potjes per uur" });
  charts.grid = (w) => dayHourGrid(w, mine);
  charts.total = (w) => (liveLine.length > 1 ? line(w, series, { min: 0, max: Math.max(live, digital, 1), mids: [], format: (v) => num(Math.round(v)), label: "Totaal aantal potjes door de tijd" }) : '<p class="empty">Te weinig potjes.</p>');
  charts.discover = (w) => columns(w, months.map((key) => {
    const names = discovered.get(key) || [];
    return { label: monthLabel(key), value: names.length, color: "var(--type)", tip: `${monthLabel(key)}: ${plural(names.length, "nieuw spel", "nieuwe spellen")}${names.length ? `\n${names.slice(0, 6).join(", ")}` : ""}` };
  }), { height: 170, every: Math.ceil(months.length / Math.max(4, Math.floor(w / 80))), label: "Nieuwe spellen per maand" });
  return `
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><h2>Op welke dag speel je?</h2>${legend()}</div><div class="chart" data-chart="days"></div></section>
    <section class="panel"><div class="panel-head"><h2>Hoe laat speel je?</h2>${legend()}</div><div class="chart" data-chart="hours"></div></section>
  </div>
  <section class="panel"><div class="panel-head"><div><h2>Je speelritme</h2><p class="hint">Uren volgen de tijd die BG Stats bewaart; bij BGA kan die afwijken van je eigen klok.</p></div></div><div class="table-wrap"><div class="chart" data-chart="grid"></div></div></section>
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><h2>Winratio per aantal spelers</h2></div>${hbars(sizes.map(([n, list]) => {
      const r = record(list, state.me);
      return { name: n === 1 ? "Solo" : n === 7 ? "7 of meer" : `${n} spelers`, total: (r.rate ?? 0) * 100, value: `${rate(r.rate)} · ${num(list.length)}×` };
    }), { color: "var(--win)" })}</section>
    <section class="panel"><div class="panel-head"><h2>Mijlpalen</h2></div><div class="table-wrap"><table><tbody>${milestones.map((n) => `<tr><td><b>${num(n)}e potje</b></td><td><span class="with-thumb">${thumb(chrono[n - 1].game)}<span>${esc(chrono[n - 1].game.name)}</span></span></td><td class="num muted">${dateLabel(chrono[n - 1])}</td></tr>`).join("")}</tbody></table></div></section>
  </div>
  <section class="panel"><div class="panel-head"><div><h2>Speeltijd per maand</h2><p class="hint">In uren. Geschat: elk potje telt mee met de gemiddelde speelduur van dat spel.</p></div>${legend()}</div><div class="chart" data-chart="time"></div></section>
  <section class="panel"><div class="panel-head"><h2>Totaal door de tijd</h2>${legend()}</div><div class="chart" data-chart="total"></div></section>
  <section class="panel"><div class="panel-head"><h2>Nieuwe spellen per maand</h2></div><div class="chart" data-chart="discover"></div></section>`;
}

/* --- Plekken ------------------------------------------------------------- */

function viewPlaces() {
  const rows = [...groupBy(mine, (p) => p.location).entries()].map(([name, list]) => {
    const game = gameRows(list).sort((a, b) => b.plays - a.plays)[0];
    return { name, list, top: game.name, ...liveDigital(list), ...record(list, state.me) };
  }).sort((a, b) => b.plays - a.plays);
  if (!rows.length) return emptyView("Geen locaties in deze selectie.");
  const best = rows.filter((r) => r.plays >= 5 && r.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  return `
  <div class="grid-3">
    <section class="panel">${stat("Speelplekken", num(rows.length), "in deze selectie")}</section>
    <section class="panel">${stat("Meest gespeeld", esc(rows[0].name), plural(rows[0].plays, "potje", "potjes"))}</section>
    <section class="panel">${best ? stat("Geluksplek", esc(best.name), `${rate(best.rate)} gewonnen`) : stat("Geluksplek", "–", "minimaal 5 potjes nodig")}</section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Waar speel je?</h2>${legend()}</div>${hbars(rows.slice(0, 15).map((r) => ({ name: r.name, total: r.plays, live: r.live, digital: r.digital, value: `${num(r.plays)}×`, tip: `${r.name}\nMeest gespeeld: ${r.top}` })))}</section>
  <section class="panel"><div class="panel-head"><h2>Alle plekken</h2></div><div class="table-wrap tall"><table><thead><tr><th>Locatie</th><th class="num">Potjes</th><th class="num">Speeltijd</th><th class="num">Winratio</th><th>Meest gespeeld</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><button type="button" class="link" data-loc="${esc(r.name)}">${esc(r.name)}</button></td><td class="num">${num(r.plays)}</td><td class="num">±${duration(r.minutes)}</td><td class="num">${rate(r.rate)}</td><td class="muted"><span class="with-thumb">${thumb(r.top)}<span>${esc(r.top)}</span></span></td></tr>`).join("")}
  </tbody></table></div></section>`;
}

/* --- Logboek ------------------------------------------------------------- */

function viewLog() {
  const q = state.logSearch.toLowerCase();
  const list = mine.filter((p) => !q || p.game.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q) || p.people.some((x) => x.name.toLowerCase().includes(q)));
  const pages = Math.max(Math.ceil(list.length / PAGE_SIZE), 1);
  state.logPage = Math.min(state.logPage, pages);
  const shown = list.slice((state.logPage - 1) * PAGE_SIZE, state.logPage * PAGE_SIZE);
  const labels = { W: "Gewonnen", L: "Verloren", D: "Geen winnaar" };
  return `<section class="panel">
    <div class="panel-head"><div><h2>Logboek</h2><p class="hint">${plural(list.length, "potje", "potjes")}</p></div>
      <label><span>Zoeken</span><input type="search" id="log-search" value="${esc(state.logSearch)}" placeholder="Spel, speler of locatie"></label></div>
    <div class="log">${shown.map((p) => {
      const r = resultFor(p, state.me);
      const people = p.people.map((x) => {
        const score = x.score !== null ? ` ${num(x.score)}` : "";
        const role = x.role ? ` (${x.role})` : "";
        return x.win ? `<b>${esc(x.name + score + role)}</b>` : esc(x.name + score + role);
      }).join(", ") + (p.game.coop && !p.anyWin ? ", <b>🎲 Het spel</b>" : "");
      return `<article class="play ${p.digital ? "digital" : "live"}"><span class="when">${dateLabel(p)}</span><div class="play-main">${thumb(p.game, "md")}<div><button type="button" class="link title" data-game="${esc(p.game.name)}">${esc(p.game.name)}</button><div class="people">${esc(p.location)}${p.duration ? ` · ${num(p.duration)} min` : p.game.minutes ? ` · ±${num(p.game.minutes)} min` : ""} · ${people}${p.table ? ` · <a class="bga-link" href="https://boardgamearena.com/table?table=${esc(p.table)}" target="_blank" rel="noopener">BGA-tafel ↗</a>` : ""}</div></div></div><span class="${r}-text">${labels[r]}</span></article>`;
    }).join("") || '<p class="empty">Geen potjes gevonden.</p>'}</div>
    <div class="pager"><button type="button" class="button" id="log-prev" ${state.logPage <= 1 ? "disabled" : ""}>Vorige</button><span class="muted">Pagina ${num(state.logPage)} van ${num(pages)}</span><button type="button" class="button" id="log-next" ${state.logPage >= pages ? "disabled" : ""}>Volgende</button></div>
  </section>`;
}

/* --- Weergave ------------------------------------------------------------ */

const RENDERERS = { overzicht: viewOverview, klassement: viewLeaderboard, spellen: viewGames, genres: viewGenres, rivalen: viewRivals, patronen: viewPatterns, plekken: viewPlaces, logboek: viewLog };

/* Overzicht toont alle onderdelen onder elkaar; de knoppen tonen er één. */
function viewEverything() {
  return viewOverview() + VIEWS.slice(1).map(([id, label, icon]) => `
    <h2 class="chapter" id="deel-${id}"><span aria-hidden="true">${icon}</span>${label}<a href="#${id}">Alleen dit bekijken</a></h2>
    ${RENDERERS[id]()}`).join("");
}

function render() {
  if (!db) return;
  select();
  syncControls();
  renderChips();
  charts = {};
  const emptyAllowed = state.view === "klassement";
  $("main").innerHTML = mine.length || emptyAllowed
    ? (state.view === "overzicht" ? viewEverything() : RENDERERS[state.view]())
    : '<div class="panel empty">Geen potjes met deze filters.<br><br><button type="button" class="button" data-clear="all">Filters wissen</button></div>';
  if ($("lb-sort")) $("lb-sort").value = state.lbSort;
  if ($("game-sort")) $("game-sort").value = state.gameSort;
  drawCharts();
}

function clearFilter(field) {
  const empty = { period: "all", game: "", mate: "", loc: "", size: "", kind: "", genre: "" };
  const controls = { period: "f-period", game: "f-game", mate: "f-mate", loc: "f-loc", size: "f-size", kind: "f-kind", genre: "f-genre" };
  Object.entries(empty).forEach(([key, value]) => {
    if (field === "all" || field === key) {
      state[key] = value;
      $(controls[key]).value = value;
    }
  });
  render();
}

function setMe(name) {
  state.me = name;
  state.rival = "";
  $("me").value = name;
  storageSet("scoreboard-me", name);
  render();
}

function showRoute() {
  const route = location.hash.slice(1);
  state.view = VIEWS.some(([id]) => id === route) ? route : "overzicht";
  render();
}

function rollDie() {
  const names = [...new Set(mine.map((p) => p.game.name))];
  if (!names.length) return;
  const die = $("die");
  die.classList.remove("rolling");
  void die.offsetWidth;
  die.classList.add("rolling");
  setTimeout(() => openGame(names[Math.floor(Math.random() * names.length)]), 650);
}

function bindEvents() {
  $("type-tokens").addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    state.type = button.dataset.type;
    storageSet("scoreboard-type", state.type);
    state.logPage = 1;
    render();
  });
  $("me").addEventListener("change", (e) => setMe(e.target.value));
  $("die").addEventListener("click", rollDie);
  $("toggle-filters").addEventListener("click", () => {
    const filters = $("filters");
    filters.hidden = !filters.hidden;
    $("toggle-filters").setAttribute("aria-expanded", String(!filters.hidden));
  });
  [["f-period", "period"], ["f-game", "game"], ["f-mate", "mate"], ["f-loc", "loc"], ["f-size", "size"], ["f-kind", "kind"], ["f-genre", "genre"], ["f-from", "from"], ["f-to", "to"]]
    .forEach(([id, field]) => $(id).addEventListener("change", (e) => { state[field] = e.target.value; state.logPage = 1; render(); }));

  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-clear],[data-person],[data-game],[data-rival],[data-loc],[data-genre]");
    if (target) {
      const { clear, person, game, rival, loc, genre } = target.dataset;
      if (genre !== undefined) { state.genre = genre; $("f-genre").value = genre; render(); return; }
      if (clear) clearFilter(clear);
      else if (person) setMe(person);
      else if (game) openGame(game);
      else if (rival) { state.rival = rival; render(); } else if (loc) { state.loc = loc; $("f-loc").value = loc; render(); }
    }
    if (e.target.id === "log-prev") { state.logPage -= 1; render(); }
    if (e.target.id === "log-next") { state.logPage += 1; render(); }
    if (e.target.id === "game-dialog") $("game-dialog").close();
  });

  document.addEventListener("change", (e) => {
    const { id, value } = e.target;
    if (id === "lb-sort") { state.lbSort = value; render(); }
    if (id === "lb-min") { state.lbMin = Math.max(1, Number(value) || 1); render(); }
    if (id === "game-sort") { state.gameSort = value; render(); }
    if (id === "rival") { state.rival = value; render(); }
  });

  let typing;
  document.addEventListener("input", (e) => {
    const { id, value } = e.target;
    if (id !== "game-search" && id !== "log-search") return;
    clearTimeout(typing);
    typing = setTimeout(() => {
      if (id === "game-search") state.gameSearch = value; else { state.logSearch = value; state.logPage = 1; }
      render();
      const field = $(id);
      field.focus();
      field.setSelectionRange(value.length, value.length);
    }, 220);
  });

  document.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG") e.target.replaceWith(e.target.dataset.initials || "");
  }, true);

  const tooltip = $("tooltip");
  document.addEventListener("pointermove", (e) => {
    const target = e.target.closest?.("[data-tip]");
    if (!target || !target.dataset.tip) { tooltip.hidden = true; return; }
    tooltip.textContent = target.dataset.tip;
    tooltip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tooltip.offsetWidth - 8);
    const y = e.clientY - tooltip.offsetHeight - 12;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${y < 8 ? e.clientY + 16 : y}px`;
  });

  let resizing;
  addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(drawCharts, 150); });
  addEventListener("hashchange", showRoute);

  if (IS_PUBLIC) {
    $("upload-label").hidden = false;
    $("upload-label").firstChild.textContent = `${tr("Ander bestand kiezen")} `;
    $("upload").addEventListener("change", (e) => { readLocalFile(e.target.files[0]); e.target.value = ""; });
    addEventListener("dragover", (e) => { e.preventDefault(); document.body.dataset.drop = tr("Laat los om je export in te lezen"); document.body.classList.add("dropping"); });
    addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
    addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dropping"); readLocalFile(e.dataTransfer.files[0]); });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#welcome-demo")) loadDemo();
      if (e.target.closest("#forget-data")) forgetData();
    });
  } else if (!IS_SHARED) {
    $("upload-label").hidden = false;
    $("upload").addEventListener("change", uploadExport);
  }
}

/* --- Laden --------------------------------------------------------------- */

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Fout ${response.status}`);
  return body;
}

function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

async function uploadExport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  showNotice("Bezig met uploaden…");
  try {
    const result = await getJson("/api/upload", { method: "POST", body: form });
    showNotice(`${num(result.plays)} potjes ingelezen.`);
    await poll();
  } catch (error) {
    showNotice(error.message);
  }
  e.target.value = "";
}

function load(raw) {
  db = prepare(raw);
  state.me = storageGet("scoreboard-me") || state.me || db.me;
  const owner = esc(db.me);
  $("scope-note").innerHTML = IS_PUBLIC
    ? `<i aria-hidden="true">🔒</i><div><p>Dit zijn <strong>jouw eigen potjes</strong> uit je BG Stats-export${raw.demo ? " (voorbeeld met verzonnen potjes)" : ""}. Het bestand is alleen in deze browser gelezen; er is niets verstuurd.</p>
    <p>Klopt de naam bij “Bekijk als” niet? Kies daar jezelf. <button type="button" class="link" id="forget-data">Wis mijn gegevens van dit apparaat</button></p></div>`
    : `<i aria-hidden="true">👋</i><div><p>Dit scoreboard bevat <strong>alleen potjes waar ${owner} zelf bij was</strong>. Potjes van anderen onderling staan er niet in.</p>
    <p>Sta je in de lijst? Dan heb je met ${owner} gespeeld. Kies je eigen naam bij “Bekijk als” om je eigen cijfers te zien.</p></div>`;
  $("scope-note").hidden = false;
  $("controls").hidden = false;
  if (IS_PUBLIC) $("upload-label").hidden = false;
  buildFilters();
  showRoute();
}

/* --- Openbare versie: eigen export inlezen -------------------------------- */

function renderWelcome(message = "") {
  db = null;
  $("controls").hidden = true;
  $("scope-note").hidden = true;
  $("upload-label").hidden = true;
  $("source-line").textContent = "Jouw eigen bordspelstatistieken";
  $("main").innerHTML = `<section class="panel welcome">
    <h2>Maak je eigen scoreboard</h2>
    <p class="hint">Gratis en open source. Je bestand wordt alleen in deze browser gelezen en nergens naartoe gestuurd.</p>
    ${message ? `<p class="notice">${esc(message)}</p>` : ""}
    <ol class="steps">
      <li><b>Haal je online potjes binnen.</b> Speel je op Board Game Arena? Importeer die potjes eerst in de BG Stats-app.</li>
      <li><b>Exporteer je gegevens.</b> Maak in BG Stats een export of back-up als bestand (.json) en zet dat op dit apparaat.</li>
      <li><b>Kies het bestand hieronder</b>, of sleep het op deze pagina.</li>
    </ol>
    <div class="welcome-actions">
      <label class="button big">📂 Kies je BG Stats-export<input type="file" id="welcome-file" accept=".json,.bgsplay" hidden></label>
      ${window.DEMO_EXPORT ? '<button type="button" class="button ghost" id="welcome-demo">Eerst een voorbeeld bekijken</button>' : ""}
    </div>
  </section>`;
  $("welcome-file").addEventListener("change", (e) => readLocalFile(e.target.files[0]));
}

function parseExport(data, demo = false) {
  const dataset = parseBGStats(data, window.GAME_INFO || {});
  if (!dataset.plays.length) throw new Error("Er staan geen potjes in dit bestand.");
  dataset.updated = new Date().toISOString().slice(0, 10);
  dataset.demo = demo;
  return dataset;
}

function readLocalFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const dataset = parseExport(JSON.parse(reader.result));
      storageSet(DATASET_KEY, JSON.stringify(dataset));
      try { localStorage.removeItem("scoreboard-me"); } catch { /* optioneel */ }
      state.me = "";
      load(dataset);
      $("source-line").textContent = `Je eigen export · ${plural(dataset.plays.length, "potje", "potjes")} · ingelezen op ${dataset.updated.split("-").reverse().join("-")}`;
      showNotice("");
    } catch (error) {
      renderWelcome(error instanceof SyntaxError ? "Dit bestand kan ik niet lezen. Kies het .json-bestand uit BG Stats." : error.message);
    }
  };
  reader.onerror = () => renderWelcome("Het bestand kon niet worden geopend.");
  reader.readAsText(file);
}

function loadDemo() {
  state.me = "";
  load(parseExport(window.DEMO_EXPORT, true));
  $("source-line").textContent = "Voorbeeld met verzonnen potjes · kies bovenaan je eigen bestand";
}

function forgetData() {
  try { localStorage.removeItem(DATASET_KEY); localStorage.removeItem("scoreboard-me"); } catch { /* optioneel */ }
  state.me = "";
  renderWelcome("Je gegevens zijn van dit apparaat gewist.");
}

function startPublic() {
  let saved = null;
  try { saved = JSON.parse(storageGet(DATASET_KEY) || "null"); } catch { saved = null; }
  if (saved && Array.isArray(saved.plays) && saved.plays.length) {
    load(saved);
    $("source-line").textContent = `Je eigen export · ${plural(saved.plays.length, "potje", "potjes")} · ingelezen op ${saved.updated.split("-").reverse().join("-")}`;
  } else {
    renderWelcome();
  }
}

async function poll() {
  try {
    const status = await getJson("/api/status");
    const extra = status.bgg_added ? ` + ${num(status.bgg_added)} nieuwe via BGG` : "";
    const labels = { bgstats: `BG Stats-export${extra}`, bgg: "BoardGameGeek", demo: "Demodata" };
    const imported = status.last_import
      ? ` · Automatisch ingelezen ${new Date(status.last_import.at * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "";
    $("source-line").textContent = `Bron: ${labels[status.source]}${imported} · BGG: ${status.bgg}`;
    if (status.error) showNotice(`Bestand niet gelezen. ${status.error}`);
    else if (status.source === "demo") showNotice("Dit zijn verzonnen demogegevens. Upload je BG Stats-export om je eigen potjes te zien.");
    if (status.version !== version) {
      version = status.version;
      load(await getJson("/api/data"));
    }
  } catch {
    $("source-line").textContent = "Geen verbinding met de server";
  }
}

const savedType = storageGet("scoreboard-type");
if (["Alles", "Live", "Digitaal"].includes(savedType)) state.type = savedType;
bindEvents();

if (IS_PUBLIC) {
  startPublic();
} else if (IS_SHARED) {
  load(window.SCOREBOARD_DATA);
  $("source-line").textContent = `Bijgewerkt op ${db.updated.split("-").reverse().join("-")}`;
} else {
  poll();
  setInterval(poll, POLL_MS);
}
