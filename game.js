/* ============================================================
   SNAKE · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Zustand: Die Schlange ist ein Array aus Zellen {x, y}, der Kopf
      steht an Index 0. Dazu kommen Richtung, Futter, Punkte und eine
      "phase" (bereit / laeuft / pause / vorbei) als einfache
      Zustandsmaschine. Alles andere leitet sich daraus ab.
   2. Spielschleife: requestAnimationFrame ruft einzelbild() einmal
      pro Bildschirm-Frame auf. Die Logik (tick) läuft aber NICHT
      bei jedem Frame, sondern nach dem Muster "Akkumulator mit
      festem Zeitschritt" (Erklärung bei einzelbild()).
   3. Eingabe: Tastatur (Pfeile/WASD) und Wischgesten schreiben nur in
      eine kleine Warteschlange. tick() holt sich daraus die nächste
      Richtung. So gehen schnelle Doppel-Eingaben nicht verloren und
      eine 180°-Wende bleibt unmöglich.
   4. Zeichnen: Das Canvas wird in jedem Frame komplett neu gemalt
      (Raster, Futter, Schlange, Partikel, Overlays). Die Schlange wird
      zwischen zwei Ticks weich interpoliert.
   5. Ende: Bei Kollision blitzt das Feld kurz auf, danach übernimmt
      gameOverDialog() aus ui.js (Initialen, Topliste, "Nochmal").
   ============================================================ */

import { topliste, spielZuruecksetzen } from "./assets/storage.js";
import {
  bewegungReduziert,
  gameOverDialog,
  toplisteAnzeigen,
  zahlHochzaehlen,
} from "./assets/ui.js";
import { spielSeite, text, TASTE, ansage } from "./assets/mobil.js";
import { levelWahl } from "./assets/levelwahl.js";

/* ---------- Konstanten (Stellschrauben des Spiels) ----------
   Alles, was man zum Ausbalancieren ändern möchte, steht hier oben
   an einer Stelle statt als "magische Zahl" im Code verstreut. */
const SPIEL = "snake"; // Schlüssel für den Speicher (storage.js)
const ZELLEN = 20; // Raster: 20 x 20 Zellen
const ZELLGROESSE = 20; // Pixel pro Zelle -> Canvas 400 x 400
const FELDGROESSE = ZELLEN * ZELLGROESSE;
const START_TEMPO = 7; // Ticks pro Sekunde zu Beginn
const MAX_TEMPO = 15; // schneller wird es nie
const TEMPO_SCHRITT = 0.5; // so viel kommt pro Stufe dazu
const HAPPEN_PRO_STUFE = 5; // alle 5 Happen eine Stufe schneller
const PUNKTE_PRO_HAPPEN = 10;
const MAX_WARTESCHLANGE = 2; // max. vorgemerkte Richtungswechsel
const ZIEL_HAPPEN = 10; // so viele Happen bis zum nächsten Level
const PUNKTE_LEVELBONUS = 50; // mal Levelnummer
const TEMPO_PRO_LEVEL = 0.4; // Grundtempo steigt je Level
const MAX_FRAME_ABSTAND_MS = 250; // siehe einzelbild()
const BLITZ_DAUER_MS = 650; // Länge des Kollisions-Aufblitzens
const WISCH_SCHWELLE = 24; // ab so vielen Pixeln zählt es als Wischen
const ZAEHLER_DAUER_MS = 300; // Dauer des HUD-Hochzählens

// Richtungen als Vektoren: x/y geben an, wohin sich der Kopf pro Tick bewegt.
const HOCH = { x: 0, y: -1 };
const RUNTER = { x: 0, y: 1 };
const LINKS = { x: -1, y: 0 };
const RECHTS = { x: 1, y: 0 };

// Tastatur-Zuordnung. Kleinbuchstaben, damit "W" und "w" gleich behandelt werden.
const TASTEN_RICHTUNG = {
  arrowup: HOCH,
  w: HOCH,
  arrowdown: RUNTER,
  s: RUNTER,
  arrowleft: LINKS,
  a: LINKS,
  arrowright: RECHTS,
  d: RECHTS,
};

/* ---------- Level ----------
   8 feste Karten, je 20 Zeilen mit 20 Zeichen: "#" = Mauer, "." = frei.
   Zeile 10 ist ab Spalte 3 immer frei, dort startet die Schlange nach
   rechts. Alle freien Felder hängen zusammen (vom Generator geprüft),
   das Futter ist also immer erreichbar. Nach Level 8 wiederholen sich
   die Karten mit höherem Grundtempo. */
const LEVEL = [
  {
    name: "Offenes Feld",
    karte: [
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
  },
  {
    name: "Ecken",
    karte: [
      "....................",
      "....................",
      "..####........####..",
      "..#..............#..",
      "..#..............#..",
      "..#..............#..",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "..#..............#..",
      "..#..............#..",
      "..#..............#..",
      "..####........####..",
      "....................",
      "....................",
    ],
  },
  {
    name: "Kreuz",
    karte: [
      "....................",
      "....................",
      "....................",
      ".........##.........",
      ".........##.........",
      ".........##.........",
      ".....##########.....",
      ".....##########.....",
      ".........##.........",
      "....................",
      "....................",
      "....................",
      ".........##.........",
      ".........##.........",
      ".........##.........",
      ".........##.........",
      ".........##.........",
      "....................",
      "....................",
      "....................",
    ],
  },
  {
    name: "Säulen",
    karte: [
      "....................",
      "....................",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....................",
      "....................",
      "....................",
      "....................",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....#...#...#...#...",
      "....................",
      "....................",
    ],
  },
  {
    name: "Kammern",
    karte: [
      ".........#..........",
      ".........#..........",
      ".........#..........",
      "....................",
      ".........#..........",
      ".........#..........",
      "####..########..####",
      ".........#..........",
      ".........#..........",
      "....................",
      "....................",
      ".........#..........",
      ".........#..........",
      "####..########..####",
      ".........#..........",
      ".........#..........",
      "....................",
      ".........#..........",
      ".........#..........",
      ".........#..........",
    ],
  },
  {
    name: "Spirale",
    karte: [
      "....................",
      "....................",
      "...###############..",
      ".................#..",
      "....############.#..",
      "....#..........#.#..",
      "....#..........#.#..",
      "....#..######..#.#..",
      "....#..#....#..#.#..",
      "....#..#....#..#.#..",
      "...............#.#..",
      "....#..#....#..#.#..",
      "....#..#....#..#.#..",
      "....#..#.......#.#..",
      "....#..#.......#.#..",
      "....#..########..#..",
      "....#............#..",
      ".....#############..",
      "....................",
      "....................",
    ],
  },
  {
    name: "Gitter",
    karte: [
      "....................",
      "....................",
      "..##..##..##..##....",
      "..##..##..##..##....",
      "....................",
      "....................",
      "..##..##..##..##....",
      "..##..##..##..##....",
      "....................",
      "....................",
      "....................",
      "..##..##..##..##....",
      "....................",
      "....................",
      "..##..##..##..##....",
      "..##..##..##..##....",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
  },
  {
    name: "Labyrinth",
    karte: [
      "....................",
      "....................",
      "..#######..#######..",
      "..#..............#..",
      "..#..............#..",
      "..#..##########..#..",
      "..#..#........#..#..",
      "..#..#........#..#..",
      "..#..#........#..#..",
      "....................",
      "....................",
      "....................",
      "..#..#........#..#..",
      "..#..#........#..#..",
      "..#..##########..#..",
      "..#..............#..",
      "..#..............#..",
      "..#######..#######..",
      "....................",
      "....................",
    ],
  },
];

/* ---------- Elemente der Seite ---------- */
const leinwand = document.getElementById("leinwand");
const zeichner = leinwand.getContext("2d");
const hudPunkte = document.getElementById("hud-punkte");
const hudRekord = document.getElementById("hud-rekord");
const hudLevel = document.getElementById("hud-level");
const hudZiel = document.getElementById("hud-ziel");
const toplisteBox = document.getElementById("topliste");
const resetKnopf = document.getElementById("reset");

// Das Canvas hat intern immer 400x400 Pixel. CSS skaliert es nur.
leinwand.width = FELDGROESSE;
leinwand.height = FELDGROESSE;
// Sonst würde der Browser beim Wischen auf dem Spielfeld die Seite
// scrollen oder zoomen und uns die Touch-Events "wegnehmen".
leinwand.style.touchAction = "none";

/* ---------- Farben aus dem Design lesen ----------
   Statt "#ff2d78" hart in den Code zu schreiben, fragen wir die
   CSS-Variablen ab. So bleibt style.css die einzige Quelle für das
   Aussehen. Das zweite Argument ist ein Notnagel, falls die Variable
   (aus welchem Grund auch immer) leer ist. */
const bodyStil = getComputedStyle(document.body);
function lesFarbe(name, notfall) {
  return bodyStil.getPropertyValue(name).trim() || notfall;
}

/**
 * Mischt eine #rrggbb-Farbe mit Weiß. `anteil` 0 = unverändert, 1 = weiß.
 * Wir brauchen das für den helleren Schlangenkopf. Canvas versteht
 * zwar CSS-Farben, kann sie aber nicht "aufhellen" wie color-mix().
 */
function mischeMitWeiss(farbe, anteil) {
  const treffer = /^#([0-9a-f]{6})$/i.exec(farbe);
  if (!treffer) return farbe; // unbekanntes Format: unverändert lassen
  const zahl = parseInt(treffer[1], 16);
  // Ein 24-Bit-Wert besteht aus drei Bytes: Rot, Grün, Blau. Mit
  // Bit-Verschiebung (>>) und Maske (& 255) holen wir sie einzeln heraus.
  const kanaele = [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255].map((k) =>
    Math.round(k + (255 - k) * anteil),
  );
  return `rgb(${kanaele.join(",")})`;
}

const farben = {
  hintergrund: lesFarbe("--bg", "#07070f"),
  gitter: lesFarbe("--line", "#2b2b52"),
  schlange: lesFarbe("--pink", "#ff2d78"),
  futter: lesFarbe("--cyan", "#00e5ff"),
  text: lesFarbe("--txt", "#eef0ff"),
  gedaempft: lesFarbe("--mut", "#9aa0c6"),
  schriftPixel: lesFarbe("--pixel", "monospace"),
  schriftText: lesFarbe("--sans", "sans-serif"),
};
farben.kopf = mischeMitWeiss(farben.schlange, 0.45);

/* LCD-Look der Handy-Ära: Im Spielfeld gelten feste Farben eines
   grünlichen Flüssigkristall-Displays (dunkle Pixel auf hellem Grund).
   Rahmen, HUD und Knöpfe außerhalb bleiben im Neon-Design. */
const LCD = { grund: "#b4c49b", schatten: "#a3b38a", pixel: "#2c3826", mittel: "#5d6b52" };
Object.assign(farben, {
  hintergrund: LCD.grund,
  gitter: LCD.schatten,
  schlange: LCD.pixel,
  futter: LCD.pixel,
  kopf: LCD.pixel,
  text: LCD.pixel,
  gedaempft: LCD.mittel,
  mauer: LCD.pixel,
});
/* ---------- Spielzustand ----------
   Wird in neuesSpiel() zurückgesetzt. `let`, weil sich die Werte ändern. */
let schlange; // [{x,y}, …] Kopf zuerst
let vorherigeSchlange; // Zustand VOR dem letzten Tick (für weiche Animation)
let richtung; // Richtung, in die der letzte Tick gelaufen ist
let warteschlange; // vorgemerkte Richtungswechsel (siehe richtungSetzen)
let futter; // {x,y} der Futterzelle
let futterSeit; // Zeitstempel, wann das Futter erschien (Einblend-Effekt)
let punkte;
let happen; // Anzahl gefressener Happen im aktuellen Level, steuert das Tempo
let level = 1; // aktuelles Level (ab 9: Karten wiederholen sich)
let startLevel = 1; // in der Level-Auswahl gewähltes Start-Level
let mauern = new Set(); // Mauerzellen als Zahl y * ZELLEN + x
let rekordGespeichert = 0; // bester Topliste-Eintrag aus dem Speicher
let phase; // "bereit" | "laeuft" | "pause" | "vorbei"
let gewonnen; // true, wenn das Feld komplett voll ist
let akkumulator = 0; // angesammelte, noch nicht "verbrauchte" Zeit in ms
let letzteZeit = 0; // Zeitstempel des vorigen Frames
let blitzStart = 0;
let dialogGezeigt = false;
let partikel = []; // kleine Funken beim Fressen (nur Deko)
let ruhigerModus = bewegungReduziert(); // wird jeden Frame aktualisiert

/* ============================================================
   HUD: weich hochzählende Anzeigen
   ============================================================ */

/**
 * zahlHochzaehlen() aus ui.js animiert ein Element von seinem alten zum
 * neuen Wert. Frisst die Schlange aber zwei Happen kurz hintereinander
 * (bei hohem Tempo möglich), laufen zwei Animationen am selben Element
 * gleichzeitig und überschreiben sich gegenseitig, die Zahl flackert.
 *
 * Diese Funktion baut deshalb eine kleine "Bremse" drumherum: Läuft noch
 * eine Animation, wird der neueste Zielwert nur vorgemerkt und gestartet,
 * sobald die laufende fertig ist. Das ist eine "Closure": Die inneren
 * Funktionen merken sich startZeit, wartet und ziel über Aufrufe hinweg.
 */
function erzeugeZaehler(element) {
  let startZeit = -Infinity; // wann die letzte Animation begann
  let wartet = null; // Timer-ID, falls ein Update vorgemerkt ist
  let ziel = 0; // zuletzt gewünschter Wert

  function setze(neuerWert) {
    ziel = neuerWert;
    const vergangen = performance.now() - startZeit;
    if (vergangen >= ZAEHLER_DAUER_MS) {
      startZeit = performance.now();
      zahlHochzaehlen(element, ziel, ZAEHLER_DAUER_MS);
    } else if (wartet === null) {
      // Noch beschäftigt: später nochmal versuchen, dann mit dem dann
      // aktuellen Ziel. Die +20 ms sind ein kleiner Sicherheitspuffer.
      wartet = setTimeout(
        () => {
          wartet = null;
          setze(ziel);
        },
        ZAEHLER_DAUER_MS - vergangen + 20,
      );
    }
  }

  /** Setzt den Wert ohne Animation (z. B. bei Neustart oder Reset). */
  function sofort(wert) {
    clearTimeout(wartet);
    wartet = null;
    startZeit = -Infinity;
    ziel = wert;
    element.textContent = wert;
  }

  return { setze, sofort };
}

const punkteZaehler = erzeugeZaehler(hudPunkte);
const rekordZaehler = erzeugeZaehler(hudRekord);

/** Tempo in Ticks pro Sekunde: Grundtempo des Levels, alle 5 Happen +0,5, maximal 15. */
function ticksProSekunde() {
  const stufe = Math.floor(happen / HAPPEN_PRO_STUFE);
  const grund = START_TEMPO + Math.min(level - 1, 12) * TEMPO_PRO_LEVEL;
  return Math.min(MAX_TEMPO, grund + stufe * TEMPO_SCHRITT);
}

function karteFuer(n) {
  return LEVEL[(n - 1) % LEVEL.length];
}

/** HUD: Level und Fortschritt zum nächsten Level (z. B. "3/10"). */
function tempoAnzeigen() {
  hudLevel.textContent = String(level);
  hudZiel.textContent = `${happen}/${ZIEL_HAPPEN}`;
}

/** Liest den besten Eintrag der Topliste (sie ist bereits absteigend sortiert). */
function toplisteAktualisieren() {
  const liste = topliste(SPIEL);
  rekordGespeichert = liste.length > 0 ? liste[0].punkte : 0;
  toplisteAnzeigen(toplisteBox, SPIEL, (p) => `${p} Punkte`);
}

/** Rekord "live": sobald die aktuellen Punkte ihn übertreffen, zieht er mit. */
function rekordLive() {
  return Math.max(rekordGespeichert, punkte);
}

/** Kurzer Puls am Rekordfeld, genau in dem Moment, in dem er geknackt wird. */
function rekordPulsen() {
  hudRekord.classList.remove("rekord-puls");
  void hudRekord.offsetWidth; // erzwingt Neuberechnung des Layouts, damit die Animation neu startet
  hudRekord.classList.add("rekord-puls");
  hudRekord.addEventListener("animationend", () => hudRekord.classList.remove("rekord-puls"), {
    once: true,
  });
}

/* ============================================================
   Spielablauf
   ============================================================ */

/** Setzt alles auf Anfang. Wird beim Laden und bei "Nochmal" aufgerufen. */
/**
 * Baut das aktuelle Level auf: Mauern aus der Karte lesen, Schlange
 * (wieder) auf 3 Segmente am Start, neues Futter. Punkte bleiben.
 */
function levelStarten() {
  mauern = new Set();
  karteFuer(level).karte.forEach((zeile, y) => {
    [...zeile].forEach((zeichen, x) => {
      if (zeichen === "#") mauern.add(y * ZELLEN + x);
    });
  });
  // Startschlange: 3 Segmente, Kopf vorn, Blick nach rechts.
  schlange = [
    { x: 6, y: 10 },
    { x: 5, y: 10 },
    { x: 4, y: 10 },
  ];
  vorherigeSchlange = schlange.map((zelle) => ({ ...zelle }));
  richtung = RECHTS;
  warteschlange = [];
  happen = 0;
  akkumulator = 0;
  phase = "bereit";
  futterPlatzieren();
  wahl.erreicht(level);
  wahl.aktiv(level);
  tempoAnzeigen();
}

function neuesSpiel(ab = startLevel) {
  startLevel = ab;
  level = ab;
  punkte = 0;
  gewonnen = false;
  partikel = [];
  dialogGezeigt = false;
  levelStarten();

  // Topliste und Rekord neu laden: Der Dialog des letzten Spiels hat
  // eventuell gerade einen neuen Eintrag gespeichert.
  toplisteAktualisieren();
  punkteZaehler.sofort(0);
  rekordZaehler.sofort(rekordGespeichert);
  tempoAnzeigen();
}

/**
 * Platziert das Futter auf einer zufälligen FREIEN Zelle.
 * Würfeln wir einfach (x, y) und prüfen dann, kann das bei einer langen
 * Schlange viele Fehlversuche geben. Besser: erst alle freien Zellen
 * sammeln, dann daraus eine auswählen. Das braucht immer genau einen Durchlauf.
 * Gibt false zurück, wenn keine freie Zelle mehr existiert (= Spiel gewonnen).
 */
function futterPlatzieren() {
  // Ein Set kann schnell prüfen "ist diese Zahl enthalten?". Jede Zelle
  // wird zu einer einzigen Zahl (y * ZELLEN + x), das macht den Vergleich simpel.
  const belegt = new Set([...mauern, ...schlange.map((zelle) => zelle.y * ZELLEN + zelle.x)]);
  const frei = [];
  for (let y = 0; y < ZELLEN; y++) {
    for (let x = 0; x < ZELLEN; x++) {
      if (!belegt.has(y * ZELLEN + x)) frei.push({ x, y });
    }
  }
  if (frei.length === 0) return false;
  futter = frei[Math.floor(Math.random() * frei.length)];
  futterSeit = performance.now();
  return true;
}

/**
 * Merkt eine Richtungsänderung vor (statt sie sofort anzuwenden).
 *
 * WARUM EINE WARTESCHLANGE? Zwischen zwei Ticks vergehen bis zu 140 ms.
 * Drückt jemand in dieser Zeit "hoch" und gleich danach "links", würde
 * eine einzelne Variable das "hoch" überschreiben. Schlimmer noch: Läuft
 * die Schlange nach rechts, und man drückt schnell "hoch", dann "links",
 * wäre "links" gegenüber der gespeicherten Richtung (hoch) erlaubt, aber
 * gegenüber der tatsächlichen Bewegung (rechts) eine 180°-Wende, und der
 * Kopf liefe in den eigenen Hals. Deshalb vergleichen wir immer mit der
 * zuletzt VORGEMERKTEN Richtung und verbrauchen pro Tick nur eine.
 */
function richtungSetzen(neueRichtung) {
  const bezug = warteschlange.length > 0 ? warteschlange[warteschlange.length - 1] : richtung;
  const istGegenteil = neueRichtung.x === -bezug.x && neueRichtung.y === -bezug.y;
  const istGleich = neueRichtung.x === bezug.x && neueRichtung.y === bezug.y;
  if (istGegenteil || istGleich) return; // sinnlos oder verboten
  if (warteschlange.length >= MAX_WARTESCHLANGE) return; // Eingabeflut abfangen
  warteschlange.push(neueRichtung);
}

/**
 * Ein einzelner Spielschritt: Die Schlange rückt genau eine Zelle vor.
 * Hier steckt die gesamte Spielregel-Logik, ganz ohne Zeichnen.
 * Logik und Darstellung zu trennen macht beides leichter zu verstehen.
 */
function tick() {
  // Nächste vorgemerkte Richtung übernehmen (falls vorhanden).
  if (warteschlange.length > 0) richtung = warteschlange.shift();

  // Zustand vor dem Zug merken. zeichneSchlange() blendet zwischen
  // "vorher" und "jetzt" über, damit die Bewegung nicht ruckelt.
  vorherigeSchlange = schlange.map((zelle) => ({ ...zelle }));

  const kopf = schlange[0];
  const neuerKopf = { x: kopf.x + richtung.x, y: kopf.y + richtung.y };

  // 1) Wand getroffen?
  const ausserhalb =
    neuerKopf.x < 0 || neuerKopf.x >= ZELLEN || neuerKopf.y < 0 || neuerKopf.y >= ZELLEN;
  if (ausserhalb || mauern.has(neuerKopf.y * ZELLEN + neuerKopf.x)) {
    spielBeenden(false);
    return;
  }

  // 2) Eigenen Körper getroffen?
  // Frisst die Schlange nicht, rückt das Schwanzende gleichzeitig weg und
  // die Zelle wird frei. Dann darf der Kopf dort hinein (so läuft man
  // sich im Kreis hinterher). Wir prüfen es deshalb nur ohne das letzte Segment.
  const frisstFutter = neuerKopf.x === futter.x && neuerKopf.y === futter.y;
  const zuPruefen = frisstFutter ? schlange.length : schlange.length - 1;
  for (let i = 0; i < zuPruefen; i++) {
    if (schlange[i].x === neuerKopf.x && schlange[i].y === neuerKopf.y) {
      spielBeenden(false);
      return;
    }
  }

  // 3) Bewegen: neuer Kopf vorn dran …
  schlange.unshift(neuerKopf);

  if (frisstFutter) {
    // … und beim Fressen das Schwanzende BEHALTEN → Schlange wächst.
    punkte += PUNKTE_PRO_HAPPEN;
    happen += 1;
    partikelErzeugen(futter);
    punkteZaehler.setze(punkte);
    tempoAnzeigen();

    // Rekord live nachziehen; Puls nur im Moment des Überholens.
    // (Bei Rekord 0 gibt es nichts zu überbieten, dann kein Puls.)
    const gerade =
      rekordGespeichert > 0 &&
      punkte > rekordGespeichert &&
      punkte - PUNKTE_PRO_HAPPEN <= rekordGespeichert;
    rekordZaehler.setze(rekordLive());
    if (gerade && !ruhigerModus) rekordPulsen();

    if (happen >= ZIEL_HAPPEN) {
      // Level geschafft: Bonus, nächste Karte, kurz durchatmen (Phase "bereit")
      punkte += PUNKTE_LEVELBONUS * level;
      punkteZaehler.setze(punkte);
      rekordZaehler.setze(rekordLive());
      level += 1;
      levelStarten();
      ansage(`Level ${level}: ${karteFuer(level).name}`);
      return;
    }
    if (!futterPlatzieren()) spielBeenden(true); // kein Platz mehr = gewonnen
  } else {
    // … sonst das Schwanzende abschneiden → Länge bleibt gleich.
    schlange.pop();
  }
}

function spielBeenden(hatGewonnen) {
  gewonnen = hatGewonnen;
  phase = "vorbei";
  blitzStart = performance.now();
  // Beim Kollisions-Tick bewegt sich nichts mehr: Die Anzeige soll exakt
  // den letzten Stand zeigen und nicht noch zwischen alt und neu hängen.
  vorherigeSchlange = schlange.map((zelle) => ({ ...zelle }));
  // Wer Bewegung reduziert haben möchte, bekommt keinen Blitz: sofort Dialog.
  if (bewegungReduziert()) dialogAnzeigen();
}

function dialogAnzeigen() {
  if (dialogGezeigt) return;
  dialogGezeigt = true;
  const dialog = gameOverDialog({
    spiel: SPIEL,
    titel: gewonnen ? "GEWONNEN!" : "GAME OVER",
    punkte,
    punkteText: `${punkte} Punkte`,
    richtung: "hoch", // bei Snake ist MEHR besser
    format: (p) => `${p} Punkte`,
    neustart: () => neuesSpiel(startLevel),
  });
  // Auch beim Schließen mit Esc (ohne "Nochmal") soll die Topliste auf
  // der Seite den neuen Stand zeigen.
  dialog.addEventListener("close", () => {
    toplisteAktualisieren();
    rekordZaehler.sofort(rekordLive());
  });
}

/* ---------- Start / Pause ---------- */

function spielStarten() {
  phase = "laeuft";
  akkumulator = 0;
}

function pauseUmschalten() {
  if (phase === "laeuft") phase = "pause";
  else if (phase === "pause") phase = "laeuft";
}

/**
 * Leertaste, Enter oder Tippen: je nach Phase starten, weitermachen
 * oder (nach einem mit Esc geschlossenen Dialog) neu beginnen.
 */
function bestaetigen() {
  if (phase === "bereit") spielStarten();
  else if (phase === "pause") phase = "laeuft";
  else if (phase === "vorbei" && dialogGezeigt && !document.getElementById("spiel-dialog"))
    neuesSpiel(startLevel);
}

/** Gemeinsame Richtungs-Eingabe für Tastatur und Wischen. */
function richtungsEingabe(neueRichtung) {
  if (phase === "bereit") {
    richtungSetzen(neueRichtung); // die erste Taste lenkt UND startet
    spielStarten();
  } else if (phase === "pause") {
    richtungSetzen(neueRichtung);
    phase = "laeuft";
  } else if (phase === "laeuft") {
    richtungSetzen(neueRichtung);
  } else {
    bestaetigen(); // "vorbei": evtl. Neustart nach Esc
  }
}

/* ============================================================
   Eingabe: Tastatur
   ============================================================ */
document.addEventListener("keydown", (ereignis) => {
  // Browser-Kürzel (Strg+R, Cmd+W …) nicht stören.
  if (ereignis.ctrlKey || ereignis.metaKey || ereignis.altKey) return;
  // Offener Game-Over-Dialog: Dort tippt man Initialen. "WASD" darf
  // dann nicht als Steuerung gelten.
  if (document.getElementById("spiel-dialog")) return;

  const ziel = ereignis.target;
  if (ziel instanceof HTMLElement && ziel.matches("input, textarea, select")) return;

  const taste = ereignis.key.toLowerCase();
  const neueRichtung = TASTEN_RICHTUNG[taste];

  if (taste === "p") {
    if (phase === "laeuft" || phase === "pause") pauseUmschalten();
    return;
  }

  const istStartTaste = taste === " " || taste === "enter";
  if (!neueRichtung && !istStartTaste) return;
  // Leertaste/Enter auf einem fokussierten Knopf oder Link soll weiterhin
  // diesen bedienen (Reset-Knopf, Zusammenklappbox), nicht das Spiel.
  if (istStartTaste && ziel instanceof HTMLElement && ziel.matches("button, a, summary")) return;

  // Pfeile und Leertaste würden sonst die Seite scrollen.
  ereignis.preventDefault();

  if (neueRichtung) richtungsEingabe(neueRichtung);
  else bestaetigen();
});

/* ============================================================
   Eingabe: Wischen und Tippen (Pointer Events)
   ============================================================ */
let wischStart = null; // Punkt, ab dem die aktuelle Geste gemessen wird
let hatGewischt = false; // war die Geste ein Wischen (sonst: ein Tippen)?

leinwand.addEventListener("pointerdown", (ereignis) => {
  wischStart = { x: ereignis.clientX, y: ereignis.clientY };
  hatGewischt = false;
  // "Capture": Auch wenn der Finger das Canvas verlässt, bekommen wir
  // weiter alle Bewegungen und das Loslassen.
  leinwand.setPointerCapture(ereignis.pointerId);
});

leinwand.addEventListener("pointermove", (ereignis) => {
  if (!wischStart) return;
  const dx = ereignis.clientX - wischStart.x;
  const dy = ereignis.clientY - wischStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < WISCH_SCHWELLE) return; // noch zu kurz

  // Die Achse mit der größeren Bewegung gewinnt (diagonal wird so eindeutig).
  const neueRichtung =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RECHTS : LINKS) : dy > 0 ? RUNTER : HOCH;
  hatGewischt = true;
  // Messpunkt zurücksetzen: Wer ohne Absetzen im Zickzack wischt, kann
  // mehrfach hintereinander abbiegen.
  wischStart = { x: ereignis.clientX, y: ereignis.clientY };
  richtungsEingabe(neueRichtung);
});

leinwand.addEventListener("pointerup", () => {
  // Kein Wischen = ein Tippen. Während des Spiels pausiert es, sonst
  // startet/setzt es fort. (Ein Wisch pausiert nie versehentlich.)
  if (wischStart && !hatGewischt) {
    if (phase === "laeuft") pauseUmschalten();
    else bestaetigen();
  }
  wischStart = null;
});
leinwand.addEventListener("pointercancel", () => {
  wischStart = null;
});

// Wechselt jemand den Tab, läuft das Spiel nicht weiter, sonst stirbt die
// Schlange im Hintergrund. (Der Browser bremst dort requestAnimationFrame ohnehin.)
document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "laeuft") phase = "pause";
});

/* ---------- Reset-Knopf ---------- */
resetKnopf.addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  wahl.neuLaden();
  toplisteAktualisieren(); // Liste leer, Rekord wieder 0
  rekordZaehler.sofort(rekordLive()); // läuft gerade ein Spiel, gilt dessen Punktzahl
  if (phase === "laeuft") phase = "pause"; // nicht im Hintergrund weiterspielen
  // Den Knopf wieder abgeben: Sonst würde die nächste Leertaste/Enter
  // erneut ihn "drücken", statt das Spiel zu starten.
  resetKnopf.blur();
});

/* ============================================================
   Hauptschleife
   ============================================================ */

/**
 * Wird vom Browser einmal pro Bildschirm-Frame aufgerufen.
 *
 * MUSTER "AKKUMULATOR / FESTER ZEITSCHRITT":
 * Ein 60-Hz-Monitor liefert 60 Frames pro Sekunde, ein 144-Hz-Monitor 144,
 * ein überlasteter Rechner vielleicht nur 20. Bewegten wir die Schlange
 * bei jedem Frame, liefe das Spiel überall anders schnell.
 * Stattdessen:
 *   1. Wir messen, wie viel Zeit seit dem letzten Frame vergangen ist.
 *   2. Diese Zeit kommt in einen "Akkumulator" (ein Sparschwein).
 *   3. Solange im Sparschwein mindestens die Dauer EINES Ticks steckt
 *      (z. B. 1000 / 7 ≈ 143 ms), führen wir einen Tick aus und nehmen
 *      diese Zeit wieder heraus.
 * Ergebnis: Die Logik läuft auf jedem Gerät exakt gleich schnell. Bei
 * langsamen Frames werden einfach mehrere Ticks nachgeholt (while-Schleife),
 * bei schnellen Frames gar keiner. Der Rest im Sparschwein (0 bis 1 Tick)
 * ist zugleich der Fortschritt für die weiche Animation.
 */
function einzelbild(jetzt) {
  // Abstand begrenzen: Kommt man nach langer Pause (Tab im Hintergrund,
  // Debugger) zurück, wären sonst Dutzende Ticks auf einmal "fällig".
  const abstand = Math.min(jetzt - letzteZeit, MAX_FRAME_ABSTAND_MS);
  letzteZeit = jetzt;
  ruhigerModus = bewegungReduziert(); // Nutzer kann die Einstellung jederzeit ändern

  if (phase === "laeuft") {
    akkumulator += abstand;
    let tickDauer = 1000 / ticksProSekunde();
    while (phase === "laeuft" && akkumulator >= tickDauer) {
      akkumulator -= tickDauer;
      tick();
      // Das Tempo kann sich im Tick ändern (Happen gefressen) → neu berechnen.
      tickDauer = 1000 / ticksProSekunde();
    }
  }

  // Partikel unabhängig von der Spiellogik bewegen (reine Optik).
  partikelBewegen(abstand / 1000);

  // Nach dem Aufblitzen den Dialog zeigen (genau einmal).
  if (phase === "vorbei" && !dialogGezeigt && jetzt - blitzStart >= BLITZ_DAUER_MS) {
    dialogAnzeigen();
  }

  // Fortschritt zwischen zwei Ticks: 0 = gerade bewegt, 1 = nächster Tick fällig.
  const sichtbarBewegt = phase === "laeuft" || phase === "pause";
  const fortschritt = sichtbarBewegt ? Math.min(akkumulator / (1000 / ticksProSekunde()), 1) : 1;

  zeichneAlles(jetzt, fortschritt);
  requestAnimationFrame(einzelbild);
}

/* ============================================================
   Zeichnen
   ============================================================ */

function zeichneAlles(jetzt, fortschritt) {
  const z = zeichner;
  z.globalAlpha = 1;
  z.shadowBlur = 0;

  // Hintergrund: In jedem Frame alles übermalen, sonst blieben alte Bilder stehen.
  z.fillStyle = farben.hintergrund;
  z.fillRect(0, 0, FELDGROESSE, FELDGROESSE);

  zeichneGitter();
  zeichneMauern();
  zeichneFutter(jetzt);
  zeichneSchlange(fortschritt);
  zeichnePartikel();

  // Overlays je nach Phase
  if (phase === "bereit") {
    zeichneOverlay(
      `LEVEL ${level}`,
      karteFuer(level).name,
      jetzt,
      text("Pfeiltaste, Leertaste oder Tippen", "Tippen oder Richtung wählen"),
    );
  } else if (phase === "pause") {
    zeichneOverlay("PAUSE", text("P oder Leertaste: weiter", "Antippen: weiter"), jetzt);
  } else if (phase === "vorbei" && !ruhigerModus) {
    zeichneBlitz(jetzt);
  }
}

/** Dezentes Zellraster: nur Linien dazwischen, nicht am äußeren Rand. */
/** Mauern: dunkle Blöcke mit hellem Kreuzmuster, wie auf einem LCD. */
function zeichneMauern() {
  const z = zeichner;
  z.save();
  for (const zahl of mauern) {
    const x = (zahl % ZELLEN) * ZELLGROESSE;
    const y = Math.floor(zahl / ZELLEN) * ZELLGROESSE;
    z.fillStyle = farben.mauer;
    z.fillRect(x + 1, y + 1, ZELLGROESSE - 2, ZELLGROESSE - 2);
    z.fillStyle = farben.hintergrund;
    z.fillRect(x + 5, y + 5, 4, 4);
    z.fillRect(x + 11, y + 11, 4, 4);
  }
  z.restore();
}

function zeichneGitter() {
  const z = zeichner;
  z.save();
  z.strokeStyle = farben.gitter;
  z.globalAlpha = 0.6;
  z.lineWidth = 1;
  z.beginPath();
  for (let i = 1; i < ZELLEN; i++) {
    // +0.5, damit die 1-Pixel-Linie genau auf einem Pixel liegt und scharf bleibt
    const p = i * ZELLGROESSE + 0.5;
    z.moveTo(p, 0);
    z.lineTo(p, FELDGROESSE);
    z.moveTo(0, p);
    z.lineTo(FELDGROESSE, p);
  }
  z.stroke();
  z.restore();
}

/** Zeichnet ein Rechteck mit runden Ecken (mit Notlösung für alte Browser). */
function rundesRechteck(x, y, breite, hoehe, radius) {
  zeichner.beginPath();
  if (zeichner.roundRect) zeichner.roundRect(x, y, breite, hoehe, radius);
  else zeichner.rect(x, y, breite, hoehe);
}

function zeichneFutter(jetzt) {
  const z = zeichner;
  // Beim Erscheinen wächst das Futter in 180 ms von 0 auf volle Größe
  // ("easeOut": am Anfang schnell, am Ende sanft, wie in ui.js).
  const t = ruhigerModus ? 1 : Math.min((jetzt - futterSeit) / 180, 1);
  const eingeblendet = 1 - Math.pow(1 - t, 3);
  // Leichtes Pulsieren als Aufmerksamkeits-Deko (nur ohne reduzierte Bewegung)
  const puls = ruhigerModus ? 0 : Math.sin(jetzt / 220);
  // LCD-Futter: vier Pixel als kleine Raute, blinkt beim Erscheinen kurz
  const p = 4 * eingeblendet + (puls > 0.6 ? 0.5 : 0);
  const mx = (futter.x + 0.5) * ZELLGROESSE;
  const my = (futter.y + 0.5) * ZELLGROESSE;
  z.save();
  z.fillStyle = farben.futter;
  z.fillRect(mx - p / 2, my - p * 1.5, p, p);
  z.fillRect(mx - p * 1.5, my - p / 2, p, p);
  z.fillRect(mx + p / 2, my - p / 2, p, p);
  z.fillRect(mx - p / 2, my + p / 2, p, p);
  z.restore();
}

/**
 * Zeichnet die Schlange. Jedes Segment wird zwischen seiner Zelle VOR dem
 * letzten Tick und seiner Zelle JETZT überblendet (lineare Interpolation):
 *     position = von + (nach - von) * fortschritt
 * Segment i ist beim Zug an die Stelle von Segment i-1 gerückt. Ein neu
 * gewachsenes letztes Segment hat keinen Vorgänger im alten Array, es
 * bleibt deshalb einfach auf der Stelle des alten Schwanzendes stehen.
 */
function zeichneSchlange(fortschritt) {
  const z = zeichner;
  const rand = 1.5; // kleiner Abstand zwischen den Segmenten
  const kante = ZELLGROESSE - rand * 2;
  const anzahl = schlange.length;

  // Von hinten nach vorn zeichnen, damit der Kopf oben liegt.
  for (let i = anzahl - 1; i >= 0; i--) {
    const nach = schlange[i];
    const von = vorherigeSchlange[i] ?? vorherigeSchlange[vorherigeSchlange.length - 1];
    const x = (von.x + (nach.x - von.x) * fortschritt) * ZELLGROESSE;
    const y = (von.y + (nach.y - von.y) * fortschritt) * ZELLGROESSE;
    const istKopf = i === 0;

    z.save();
    // LCD: volle, eckige Pixelblöcke. Jedes zweite Segment bekommt ein
    // helles Loch in der Mitte, so sieht man Länge und Bewegung besser.
    z.fillStyle = istKopf ? farben.kopf : farben.schlange;
    z.fillRect(x + rand, y + rand, kante, kante);
    if (!istKopf && i % 2 === 0) {
      z.fillStyle = farben.hintergrund;
      z.fillRect(x + ZELLGROESSE / 2 - 2, y + ZELLGROESSE / 2 - 2, 4, 4);
    }
    z.restore();

    if (istKopf) zeichneAugen(x + ZELLGROESSE / 2, y + ZELLGROESSE / 2);
  }
}

/** Zwei Augen, ausgerichtet an der Blickrichtung. */
function zeichneAugen(mitteX, mitteY) {
  const z = zeichner;
  // Die Senkrechte zu einem Vektor (x, y) ist (-y, x). Damit liegen die
  // Augen quer zur Blickrichtung nebeneinander.
  const quer = { x: -richtung.y, y: richtung.x };
  z.save();
  z.fillStyle = farben.hintergrund;
  for (const seite of [-1, 1]) {
    z.fillRect(
      mitteX + richtung.x * 3 + quer.x * 4 * seite - 2,
      mitteY + richtung.y * 3 + quer.y * 4 * seite - 2,
      4,
      4,
    );
  }
  z.restore();
}

/* ---------- Partikel (kleine Funken beim Fressen) ---------- */

function partikelErzeugen(zelle) {
  if (ruhigerModus) return; // reine Deko → bei reduzierter Bewegung weglassen
  const mitteX = (zelle.x + 0.5) * ZELLGROESSE;
  const mitteY = (zelle.y + 0.5) * ZELLGROESSE;
  for (let i = 0; i < 10; i++) {
    const winkel = Math.random() * Math.PI * 2; // zufällige Flugrichtung
    const tempo = 40 + Math.random() * 90; // Pixel pro Sekunde
    partikel.push({
      x: mitteX,
      y: mitteY,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo,
      leben: 1, // 1 = frisch, 0 = verschwunden
    });
  }
}

/** `sekunden` ist die echte Zeit seit dem letzten Frame, also läuft die Animation auf jedem Gerät gleich schnell. */
function partikelBewegen(sekunden) {
  for (const p of partikel) {
    p.x += p.vx * sekunden;
    p.y += p.vy * sekunden;
    p.leben -= sekunden * 2.2; // in ca. 0,45 s ausgeblendet
  }
  partikel = partikel.filter((p) => p.leben > 0); // Abgelaufene aussortieren
}

function zeichnePartikel() {
  const z = zeichner;
  z.save();
  z.fillStyle = farben.futter;
  for (const p of partikel) {
    if (p.leben < 0.15) continue;
    const g = Math.round(2 + 3 * p.leben);
    z.fillRect(Math.round(p.x - g / 2), Math.round(p.y - g / 2), g, g);
  }
  z.restore();
}

/* ---------- Overlays ---------- */

/** Abgedunkelte Fläche mit zwei Textzeilen (Start- und Pause-Anzeige). */
function zeichneOverlay(titel, untertitel, jetzt, hinweis = "") {
  const z = zeichner;
  z.save();
  z.globalAlpha = 0.8;
  z.fillStyle = farben.hintergrund;
  z.fillRect(0, 0, FELDGROESSE, FELDGROESSE);

  z.globalAlpha = 1;
  z.textAlign = "center";
  z.textBaseline = "middle";
  z.fillStyle = farben.text;
  z.font = `18px ${farben.schriftPixel}`;
  z.fillText(titel, FELDGROESSE / 2, FELDGROESSE / 2 - 22);

  z.font = `16px ${farben.schriftText}`;
  z.fillText(untertitel, FELDGROESSE / 2, FELDGROESSE / 2 + 12);
  if (hinweis) {
    // Die Hinweiszeile "atmet" leicht, damit klar ist: Hier wird auf dich gewartet.
    z.globalAlpha = ruhigerModus ? 1 : 0.75 + 0.25 * Math.sin(jetzt / 350);
    z.font = `14px ${farben.schriftText}`;
    z.fillText(hinweis, FELDGROESSE / 2, FELDGROESSE / 2 + 42);
  }
  z.restore();
}

/**
 * Weißes Aufblitzen nach der Kollision: dreimal an- und abschwellend.
 * |sin| ist immer positiv und "pocht" dreimal, wenn t von 0 bis 1 läuft.
 * Der Faktor (1 - t) lässt das Aufblitzen gleichzeitig ausklingen.
 */
function zeichneBlitz(jetzt) {
  const t = (jetzt - blitzStart) / BLITZ_DAUER_MS;
  if (t >= 1) return;
  // EIN weicher Puls (nicht mehrere): Mehr als 3 Blitze pro Sekunde
  // können bei Fotosensibilität Anfälle auslösen (WCAG 2.3.1).
  const staerke = Math.sin(t * Math.PI) * 0.6;
  zeichner.save();
  zeichner.globalAlpha = staerke;
  zeichner.fillStyle = farben.text;
  zeichner.fillRect(0, 0, FELDGROESSE, FELDGROESSE);
  zeichner.restore();
}

/* ============================================================
   Start
   ============================================================ */
const wahl = levelWahl({
  spiel: SPIEL,
  namen: LEVEL.map((l) => l.name),
  nach: document.querySelector(".steuerung"),
  gesperrt: () => phase === "laeuft",
  beiWahl: (n) => neuesSpiel(n),
});
neuesSpiel(1);
letzteZeit = performance.now();
requestAnimationFrame(einzelbild);

// Handy: Steuerkreuz, Einpassen, Scroll-Sperre, Spielmodus (assets/mobil.js)
spielSeite({
  phase: () => phase,
  gamepad: {
    links: "kreuz",
    rechts: [
      { key: "p", zeichen: "B", name: "Pause", beschriftung: "PAUSE" },
      { key: " ", zeichen: "A", name: "Start", beschriftung: "START" },
    ],
  },
});
// Strom-LED leuchtet, solange eine Runde läuft
setInterval(
  () => document.getElementById("handheld")?.classList.toggle("an", phase === "laeuft"),
  300,
);
