"use strict";
/* Zet een BG Stats-export in de browser om naar de compacte dataset van het scoreboard.
   Zelfde uitkomst als parse_bgstats + build_dataset in app.py, zodat beide versies
   dezelfde statistieken tonen. Niets verlaat het apparaat. */

const BGS_DIGITAL_RE = /\b(board game arena|boardgamearena|bga|yucata|tabletop simulator)\b/i;
const BGS_ANONYMOUS_RE = /\b(anoniem\w*|anonymous)\b/i;
const BGS_UNKNOWN = "Onbekende speler";
const BGS_QUICK_MINUTES = 20;

function bgsGameDetails(game, info) {
  const name = (game.name || "").toLowerCase();
  const meta = info.metadata || { by_name: {}, by_bgg: {} };
  const genreList = info.genres || { by_name: {}, by_bgg: {} };
  const extra = meta.by_name[name] || meta.by_bgg[String(game.bggId)] || {};
  const times = [game.minPlayTime, game.maxPlayTime].filter(Boolean);
  const bgg = game.bggId || extra.bgg || null;
  const coop = Boolean(game.cooperative || extra.coop);
  const minutes = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : (extra.minutes || 0);
  const genres = [...(genreList.by_name[name] || genreList.by_bgg[String(bgg)] || [])];
  if (coop) genres.unshift("coop");
  if (minutes && minutes <= BGS_QUICK_MINUTES) genres.push("snel");
  return {
    bgg, coop, genres, minutes,
    year: game.bggYear || extra.year || null,
    designers: game.designers || extra.designers || "",
    image: game.urlThumb || extra.image || "",
  };
}

function bgsNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bgsFindMe(data) {
  const ref = data.userInfo && data.userInfo.meRefId;
  if (ref !== undefined && ref !== null) return ref;
  const counts = new Map();
  data.plays.forEach((p) => (p.playerScores || []).forEach((s) => counts.set(s.playerRefId, (counts.get(s.playerRefId) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function bgsMeta(text) {
  if (!text) return {};
  if (typeof text === "object") return text;
  try { return JSON.parse(text) || {}; } catch { return {}; }
}

/* info = { genres: game_genres.json, metadata: game_metadata.json } */
function parseBGStats(data, info = {}) {
  if (!data || typeof data !== "object" || !Array.isArray(data.plays)) {
    throw new Error("Dit is geen BG Stats-export: het onderdeel 'plays' ontbreekt.");
  }
  const games = new Map((data.games || []).map((g) => [g.id, g]));
  const locations = new Map((data.locations || []).map((l) => [l.id, l.name || ""]));
  const names = new Map((data.players || []).map((p) => [p.id,
    p.isAnonymous || BGS_ANONYMOUS_RE.test(p.name || "") ? BGS_UNKNOWN : (p.name || "Onbekend")]));
  const meId = bgsFindMe(data);

  const players = new Map();
  const gameIndex = new Map();
  const locIndex = new Map();
  const index = (table, key) => { if (!table.has(key)) table.set(key, table.size); return table.get(key); };
  const details = new Map();

  const rows = [];
  data.plays.forEach((raw) => {
    if (raw.ignored) return;
    const game = games.get(raw.gameRefId) || { name: "Onbekend spel" };
    const gameName = game.name || "Onbekend spel";
    if (!details.has(gameName)) details.set(gameName, bgsGameDetails(game, info));
    const location = locations.get(raw.locationRefId) || "";
    const meta = bgsMeta(raw.metaData);
    const fromBga = /board game arena/i.test(meta.MetaDataImportSourceName || "");
    const people = (raw.playerScores || []).map((s) => {
      const name = names.get(s.playerRefId) || "Onbekend";
      return [
        name === BGS_UNKNOWN ? -1 : index(players, name),
        bgsNumber(s.score), s.winner ? 1 : 0, s.role || null, s.newPlayer ? 1 : 0,
        s.rank || 0, s.startPlayer ? 1 : 0,
      ];
    });
    rows.push([
      String(raw.playDate || "").slice(0, 19), index(gameIndex, gameName), index(locIndex, location),
      BGS_DIGITAL_RE.test(location) || Number(meta.isOnlinePlay) === 1 ? 1 : 0, raw.board || null, people, raw.durationMin || 0,
      fromBga && meta.sourceId ? String(meta.sourceId) : null,
    ]);
  });
  rows.sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const meName = meId !== null && names.get(meId);
  return {
    me: meName && meName !== BGS_UNKNOWN ? meName : ([...players.keys()][0] || ""),
    players: [...players.keys()],
    games: [...gameIndex.keys()].map((name) => {
      const d = details.get(name);
      return [name, d.bgg, d.coop, d.year, d.designers, d.image, d.minutes, d.genres];
    }),
    locations: [...locIndex.keys()],
    genres: (info.genres && info.genres.genres) || {},
    plays: rows,
  };
}
