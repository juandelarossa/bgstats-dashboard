"use strict";
/* Meertaligheid. De Nederlandse tekst is de sleutel; vertalingen staan in static/translations.js.
   {0}, {1}, … zijn plekken voor getallen, namen en datums; {#0} accepteert alleen een getal. De vertaler werkt op alles wat op de
   pagina verschijnt (ook grafieken en tooltips), zodat de rekencode Nederlands kan blijven. */

const LANGUAGES = [
  ["en", "English", "en-GB"], ["nl", "Nederlands", "nl-NL"], ["de", "Deutsch", "de-DE"], ["fr", "Français", "fr-FR"],
  ["es", "Español", "es-ES"], ["it", "Italiano", "it-IT"], ["pt", "Português", "pt-BR"],
];
const LANG_KEY = "scoreboard-lang";
const LANG = (() => {
  const known = (code) => LANGUAGES.some(([id]) => id === code);
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* optioneel */ }
  if (known(saved)) return saved;
  const browser = (navigator.languages || [navigator.language || ""]).map((l) => String(l).slice(0, 2).toLowerCase()).find(known);
  return browser || (window.PUBLIC_MODE ? "en" : "nl");
})();
const LOCALE = LANGUAGES.find(([id]) => id === LANG)[2];
document.documentElement.lang = LANG;
const I18N = {};

const I18N_ATTRS = ["title", "placeholder", "aria-label"];
let translator = null;

function compileTranslations(dict) {
  const exact = new Map();
  const patterns = [];
  Object.entries(dict).forEach(([key, value]) => {
    if (!/\{#?\d+\}/.test(key)) { exact.set(key, value); return; }
    const parts = key.split(/(\{#?\d+\})/);
    const order = [];
    const source = parts.map((part) => {
      const slot = part.match(/^\{(#?)(\d+)\}$/);
      if (slot) { order.push(slot[2]); return slot[1] ? "([−+±-]?\\d[\\d.,\\u00a0\\u202f]*)" : "(.+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    const literal = parts.filter((part) => !/^\{#?\d+\}$/.test(part)).sort((a, b) => b.length - a.length)[0] || "";
    patterns.push({ re: new RegExp(`^${source}$`), order, value, literal, size: key.length });
  });
  patterns.sort((a, b) => b.size - a.size);
  return { exact, patterns };
}

/* Vertaal één regel. Ingevulde stukjes worden ook vertaald (bijv. een genre in een zin),
   en een voorvoegsel zonder letters (zoals een emoji) blijft staan. */
function translateCore(core, depth = 0) {
  if (!core || depth > 2 || !/\p{L}/u.test(core)) return undefined;
  const direct = translator.exact.get(core);
  if (direct !== undefined) return direct;
  for (const p of translator.patterns) {
    if (p.literal && !core.includes(p.literal)) continue;
    const found = core.match(p.re);
    if (found) {
      const values = {};
      p.order.forEach((slot, i) => { values[slot] = translateCore(found[i + 1], depth + 1) ?? found[i + 1]; });
      return p.value.replace(/\{(\d+)\}/g, (_, slot) => (slot in values ? values[slot] : ""));
    }
  }
  const prefix = core.match(/^([^\p{L}\d]+)(\p{L}[\s\S]*)$/u);
  if (prefix) {
    const rest = translateCore(prefix[2], depth + 1);
    if (rest !== undefined) return prefix[1] + rest;
  }
  return undefined;
}

function translateLine(line) {
  const match = line.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const out = translateCore(match[2]);
  return out === undefined ? line : match[1] + out + match[3];
}

const tr = (text) => (translator && text ? String(text).split("\n").map(translateLine).join("\n") : text);

function translateTree(root) {
  if (!translator || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const next = tr(root.nodeValue);
    if (next !== root.nodeValue) root.nodeValue = next;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest?.("script,style")) return;
  const elements = [root, ...root.querySelectorAll("*")];
  elements.forEach((el) => I18N_ATTRS.forEach((attr) => {
    const value = el.getAttribute(attr);
    if (value) { const next = tr(value); if (next !== value) el.setAttribute(attr, next); }
  }));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("script,style")) continue;
    const next = tr(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}

function setupLanguagePicker() {
  const select = document.getElementById("lang");
  if (!select) return;
  select.replaceChildren(...LANGUAGES.map(([id, name]) => new Option(name, id)));
  select.value = LANG;
  select.addEventListener("change", () => {
    try { localStorage.setItem(LANG_KEY, select.value); } catch { /* optioneel */ }
    location.reload();
  });
}

/* Na translations.js aanroepen: vertaalt de pagina en alles wat later verschijnt. */
function startTranslation() {
  setupLanguagePicker();
  if (LANG === "nl" || !I18N[LANG]) return;
  translator = compileTranslations(I18N[LANG]);
  document.title = tr(document.title);
  translateTree(document.body);
  new MutationObserver((mutations) => mutations.forEach((m) => m.addedNodes.forEach(translateTree)))
    .observe(document.body, { childList: true, subtree: true });
}
