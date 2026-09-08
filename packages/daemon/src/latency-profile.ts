/**
 * Das gelernte Latenzprofil des dichten Arms (#491) — AUSSCHLIESSLICH IM SCHATTEN.
 *
 * Jede Deadline des dichten Arms ist heute eine von Hand getippte Zahl:
 *
 *   http-hook-routes.ts:67   150 ms   Endpunkt-Default aller Hook-Lanes
 *   session-lane.ts:93       350 ms   feste Konstante, bewusst ohne Env-Schalter
 *   mcp-forwarder.ts:525    1500 ms   Default für modellgetriebene Recalls
 *
 * Jede wurde EINMAL gemessen, auf EINER Maschine, mit EINEM Modell. Keine davon
 * kennt die vier Größen, die die Antwort tatsächlich bestimmen: Hardware,
 * Modell, Residenz und Eingabelänge. Wer auf langsamerer Hardware arbeitet oder
 * `embeddinggemma` gegen ein größeres Modell tauscht, erbt unsere Zahlen.
 *
 * Dieses Modul lernt sie statt sie zu tippen — und ändert dabei NICHTS. Die
 * festen Zahlen bleiben in Kraft; die gelernte wird berechnet und neben der
 * tatsächlich verwendeten protokolliert. Das Scharfschalten ist #492 und steht
 * hinter einem Zeit-Tor.
 *
 * WAS GELERNT WIRD, und warum ausgerechnet das. Die Stichprobe ist die
 * GESAMTZEIT des Arms — vom Abfeuern bis zum echten Settle. Nicht die
 * Wartezeit: die ist bei einem aufgegebenen Arm exakt die Deadline, und ein
 * Lerner, der daraus lernt, lernt die Grenze nach, die schon gilt (#489:
 * `session-context` las p95 312 ms gegen eine 350-ms-Deadline — das ist keine
 * Verteilung, das ist eine Wand). Die echte Gesamtzeit gibt es deshalb in zwei
 * Formen:
 *
 *   · Der Arm settelte im Aufruf → `vector_search_ms` IST die Gesamtzeit.
 *   · Der Arm wurde aufgegeben   → Überlapp + `settle_ms` der späten
 *     Stichprobe (`vector_late_settle`, #489). Nur diese Zeilen sehen den
 *     kalten Schwanz, um den sich der ganze Entwurf dreht.
 *
 * DIMENSIONEN. Residenz × Eingabelänge × Nebenläufigkeit. Nicht bloß warm/kalt:
 * Die Lanes unterscheiden sich um zwei Größenordnungen in der Querylänge
 * (SessionStart p50 40 Zeichen, Prompt-Lane p50 3671), und die Residenz trennt
 * 33–54 ms von 585 ms (gemessen 08.09.2026, M4 Pro, Ollama, `embeddinggemma`).
 * Die Residenz kommt vom Warmup-Koordinator (#490, `embedding-warmup.ts`) —
 * eine zweite Quelle dafür gibt es bewusst nicht.
 *
 * FRISCH BEI MODELLWECHSEL. Das Profil ist nach `provider:model` geschlüsselt
 * (`EmbeddingProvider.id`, dieselbe Kennung, an der schon Vektor-Persistenz und
 * Embed-Cache invalidieren). Ein anderes Modell findet seinen Schlüssel leer
 * vor und erbt nichts — genau die Zusage aus #491.
 *
 * KEINE ENV-SCHALTER. Aus demselben Grund, den `SESSION_VECTOR_DEADLINE_MS`
 * (session-lane.ts:85-92) ausführlich nennt: Eine geerbte Dienstkonfiguration
 * hatte dort die Entscheidung still zurückgedreht, und keine Zeile Telemetrie
 * sagte es. Der Dateipfad ist eine Injektion für Tests, kein Schalter.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Residency } from "./embedding-warmup.js";

/**
 * Die Untergrenze, die `http-hook-routes.ts` überhaupt durchlässt (`clampInt(…,
 * 50, 10_000, …)`). Eine abgeleitete Deadline darunter wäre eine Zahl, die der
 * Endpunkt nie annehmen würde — der Schatten muss dieselbe Grenze kennen, sonst
 * prognostiziert er etwas, das #492 gar nicht scharf schalten könnte.
 */
export const MIN_DEADLINE_MS = 50;
/** Obergrenze desselben Clamps. */
export const MAX_DEADLINE_MS = 10_000;

/**
 * Wie viele Stichproben ein Eimer hält. Das gleitende Fenster IST diese Grenze:
 * Die 33. Stichprobe verdrängt die erste, also folgt das p95 einer Maschine,
 * die gerade langsamer wird, ohne dass irgendwo ein Zerfallsfaktor gepflegt
 * werden müsste. 32 ist groß genug, dass ein p95 nicht auf einem einzigen
 * Ausreißer steht (nearest-rank braucht dafür ≥ 20), und klein genug, dass die
 * Datei bei allen Eimern zusammen im zweistelligen Kilobyte-Bereich bleibt.
 */
const SAMPLES_PER_BUCKET = 32;

/**
 * Die ALTERUNG. Eine Stichprobe, die älter ist als das, beschreibt eine
 * Maschine, die es so nicht mehr gibt — anderes Ollama, andere Last, anderes
 * Betriebssystem. Sie zählt nicht mehr mit und fällt beim nächsten Schreiben
 * aus der Datei.
 *
 * Sieben Tage, weil das Messfenster aus #492 fünf Tage lang ist: Kürzer, und
 * die Auswertung am 13.09. stünde auf einem Profil, das seinen eigenen
 * Fensteranfang schon vergessen hat.
 */
export const SAMPLE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Ab wann ein Eimer für sich allein spricht. Darunter wird über ALLE Eimer
 * desselben Profils gerechnet.
 *
 * Ohne diese Rückfallebene wäre jeder der 48 Eimer (4 Residenzen × 4
 * Längenbänder × 3 Nebenläufigkeiten) einzeln kalt zu starten — 48 lexikalische
 * Antworten für eine Maschine, die längst weiß, wie schnell ihr Modell ist. Die
 * gröbere Zahl ist schlechter als die feine, aber ungleich besser als keine;
 * `basis` sagt in der Telemetrie, welche von beiden gegolten hat.
 */
const MIN_BUCKET_SAMPLES = 5;

/**
 * Wie viele `provider:model`-Profile die Datei hält. Wer zwischen zwei Modellen
 * hin- und herwechselt, soll beim Zurückwechseln nicht bei null anfangen; wer
 * zwanzig durchprobiert, soll keine unbegrenzt wachsende Datei erben. Verdrängt
 * wird das am längsten nicht aktualisierte.
 */
const MAX_PROFILES = 8;

/** Schreib-Entprellung. Stichproben fallen im Sekundentakt an, die Datei ist
 *  reine Ableitung — ein Schreibvorgang pro Stichprobe wäre Plattenlast für
 *  nichts. Beim sauberen Herunterfahren erzwingt `flush()` den letzten. */
const PERSIST_DEBOUNCE_MS = 5_000;

const FILE_VERSION = 1;

/**
 * Längenband der Eingabe. Die Grenzen liegen dort, wo die Lanes liegen:
 * SessionStart p50 40 Zeichen (`xs`), Prompt-Lane p50 3671 (`l`). Ein Band, das
 * beide in denselben Eimer legte, würde für keine von beiden etwas aussagen.
 */
export type LengthBucket = "xs" | "s" | "m" | "l";

export function lengthBucket(chars: number): LengthBucket {
  if (!Number.isFinite(chars) || chars < 256) return "xs";
  if (chars < 1024) return "s";
  if (chars < 4096) return "m";
  return "l";
}

/**
 * Nebenläufigkeit: wie viele dichte Arme beim Abfeuern DIESES Arms schon
 * liefen. Ein Ollama beantwortet Embeds nicht parallel schneller — ein
 * 3er-Batch (#351) serialisiert auf einem Modell, und genau das machte 15 von
 * 19 MCP-Recalls am 20.08. einarmig. Eine Prognose, die den Unterschied nicht
 * kennt, ist für die MCP-Lane systematisch zu kurz.
 */
export type ConcurrencyBucket = "1" | "2-3" | "4+";

export function concurrencyBucket(inFlight: number): ConcurrencyBucket {
  if (!Number.isFinite(inFlight) || inFlight <= 1) return "1";
  if (inFlight <= 3) return "2-3";
  return "4+";
}

export function bucketKey(
  residency: Residency,
  chars: number,
  inFlight: number,
): string {
  return `${residency}|${lengthBucket(chars)}|${concurrencyBucket(inFlight)}`;
}

/**
 * Warum die abgeleitete Zahl am Ende so aussieht, wie sie aussieht.
 *
 *   `profile-empty`   — noch keine Stichprobe. Antwort: die Untergrenze, also
 *                       einmal lexikalisch. Der aufgegebene Embed läuft ohnehin
 *                       weiter (`abandonAfter` bricht nicht ab) und liefert die
 *                       erste Stichprobe: der Kaltstart finanziert seine eigene
 *                       Kalibrierung.
 *   `lane-wall-clock` — die Lane hatte weniger Wanduhr übrig als das Profil
 *                       wollte. Die Wanduhr ist ein Vertrag, keine Schätzung.
 *   `floor`           — das Profil wollte weniger als die 50 ms, die der
 *                       Endpunkt zulässt.
 *   `none`            — ungedeckelt, die Zahl kommt direkt aus dem Profil.
 */
export type CapReason = "profile-empty" | "lane-wall-clock" | "floor" | "none";

export interface DerivedDeadline {
  /** Die Zahl, die gegolten HÄTTE. Ändert in diesem Auftrag nichts. */
  predicted_deadline_ms: number;
  cap_reason: CapReason;
  /** Stand die Zahl auf dem genauen Eimer, auf dem ganzen Profil, oder auf
   *  nichts? Ohne das Feld sähe eine grobe Prognose aus wie eine feine. */
  basis: "bucket" | "profile-wide" | "empty";
  /** Wie viele Stichproben sie trägt. */
  samples: number;
  /** Das p95 der Gesamtzeit, aus dem sie abgeleitet wurde. */
  expected_total_ms: number | null;
  /** Der Eimer, in dem dieser Aufruf lag. */
  bucket: string;
}

export interface DeriveInput {
  /** `provider:model`. */
  key: string;
  residency: Residency;
  /** Zeichen der Query, die an den dichten Arm ging (die ungekappte, #362). */
  queryChars: number;
  /** Dichte Arme in Flug beim Abfeuern DIESES Arms, inklusive seiner selbst. */
  concurrency: number;
  /**
   * Was der Arm bis zum Beginn des Wartens schon verbraucht hat — die
   * Überlappung mit BM25. Die Ableitung passiert NACH BM25, dort wo das Warten
   * beginnt: erwartete Gesamtzeit minus bereits verbrauchte Überlappung.
   */
  overlapMs: number;
  /**
   * Die verbleibende Wanduhr der Lane an derselben Stelle. `Infinity` = keine
   * (offline-Aufrufer ohne Budget). SessionStart 500 ms, Prompt-Lane 200 ms.
   */
  laneRemainingMs: number;
}

export interface RecordInput {
  key: string;
  residency: Residency;
  queryChars: number;
  concurrency: number;
  /** Gesamtzeit des Arms, vom Abfeuern bis zum ECHTEN Settle. */
  totalMs: number;
}

/** Eine Stichprobe auf Platte: [Zeitstempel, Gesamtzeit] — Paare statt Objekte,
 *  weil davon tausende in der Datei stehen. */
type StoredSample = [number, number];

interface StoredProfile {
  updated_at: number;
  buckets: Record<string, StoredSample[]>;
}

interface StoredFile {
  version: number;
  profiles: Record<string, StoredProfile>;
}

export interface LatencyProfile {
  /** Liest die persistierte Datei. Fehlt sie oder ist sie kaputt: leeres
   *  Profil, der Daemon läuft weiter. */
  load: () => Promise<void>;
  /** Eine echte Gesamtzeit dazulernen. Ignoriert alles Unbrauchbare. */
  record: (input: RecordInput) => void;
  /** Die Zahl, die gegolten hätte. Reine Rechnung, kein Nebeneffekt. */
  derive: (input: DeriveInput) => DerivedDeadline;
  /** Ein dichter Arm wird abgefeuert. Liefert die Nebenläufigkeit inklusive
   *  seiner selbst — genau die Zahl, unter der er später einsortiert wird. */
  beginArm: () => number;
  /** Der Arm ist beantwortet oder aufgegeben (nicht: gesettelt — der Aufrufer
   *  wartet ab hier nicht mehr, und um seine Sicht geht es). */
  endArm: () => void;
  /** Erzwingt den ausstehenden Schreibvorgang. */
  flush: () => Promise<void>;
  /** Nur für Tests und `/health`: wie viele Stichproben ein Schlüssel trägt. */
  sampleCount: (key: string) => number;
}

export interface LatencyProfileOptions {
  /** Ablage. Default `~/.bastra/latency-profile.json`, neben `floors.json`,
   *  `providers.json` und `update-check.json`. */
  path?: string;
  /** Injizierte Uhr — Alterung und Fenster sind hermetisch prüfbar. */
  now?: () => number;
}

export function latencyProfilePath(): string {
  return join(homedir(), ".bastra", "latency-profile.json");
}

/** Nearest-rank-p95 über eine unsortierte Liste. Kein Interpolieren: bei 32
 *  Werten ist die interpolierte Zahl eine Genauigkeit, die die Stichprobe nicht
 *  hergibt. */
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export function createLatencyProfile(opts: LatencyProfileOptions = {}): LatencyProfile {
  const now = opts.now ?? Date.now;
  const path = opts.path ?? latencyProfilePath();
  /** key → bucket → Stichproben, älteste zuerst. */
  const profiles = new Map<string, Map<string, StoredSample[]>>();
  const updatedAt = new Map<string, number>();
  let inFlight = 0;
  let persistTimer: NodeJS.Timeout | null = null;
  let persisting: Promise<void> = Promise.resolve();

  const bucketsFor = (key: string): Map<string, StoredSample[]> => {
    let b = profiles.get(key);
    if (!b) {
      b = new Map();
      profiles.set(key, b);
    }
    return b;
  };

  /** Alles, was jünger ist als {@link SAMPLE_MAX_AGE_MS}. Gefiltert beim LESEN,
   *  nicht per Timer: Ein Daemon, der zwei Wochen stand, hätte sonst beim
   *  ersten Recall nach dem Start ein Profil aus einer anderen Woche. */
  const fresh = (samples: StoredSample[] | undefined): number[] => {
    if (!samples) return [];
    const cutoff = now() - SAMPLE_MAX_AGE_MS;
    const out: number[] = [];
    for (const [at, ms] of samples) if (at >= cutoff) out.push(ms);
    return out;
  };

  const schedulePersist = (): void => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persisting = persist();
    }, PERSIST_DEBOUNCE_MS);
    // Ein Profil-Schreibvorgang darf keinen Prozess offen halten.
    persistTimer.unref?.();
  };

  const snapshot = (): StoredFile => {
    const cutoff = now() - SAMPLE_MAX_AGE_MS;
    // Nur die jüngsten MAX_PROFILES überleben; verdrängt wird nach
    // Aktualisierungszeit, damit ein Rückwechsel auf ein kürzlich benutztes
    // Modell sein Profil wiederfindet.
    const keys = [...profiles.keys()]
      .sort((a, b) => (updatedAt.get(b) ?? 0) - (updatedAt.get(a) ?? 0))
      .slice(0, MAX_PROFILES);
    const out: StoredFile = { version: FILE_VERSION, profiles: {} };
    for (const key of keys) {
      const buckets: Record<string, StoredSample[]> = {};
      for (const [bucket, samples] of bucketsFor(key)) {
        const kept = samples.filter(([at]) => at >= cutoff);
        if (kept.length > 0) buckets[bucket] = kept;
      }
      if (Object.keys(buckets).length === 0) continue;
      out.profiles[key] = { updated_at: updatedAt.get(key) ?? 0, buckets };
    }
    return out;
  };

  /** Atomar wie `floors.json`: tmp + rename, Verzeichnis 0700, Datei 0600. Ein
   *  abgebrochener Schreibvorgang hinterlässt nie eine halbe Datei. */
  const persist = async (): Promise<void> => {
    const data = snapshot();
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
      await writeFile(tmp, JSON.stringify(data) + "\n", { encoding: "utf8", mode: 0o600 });
      await rename(tmp, path);
    } catch {
      // Ein nicht schreibbares Profil ist ein verlorener Lerneffekt, kein
      // Defekt des Recalls — dieselbe Politik wie überall auf diesem Pfad.
    }
  };

  return {
    async load(): Promise<void> {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        return;
      }
      if (raw.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // Laut, aber überlebt — dieselbe Politik wie `floors.json`: Die nächste
        // Stichprobe schreibt die Datei neu.
        process.stderr.write(
          `[bastra-recall] latency-profile.json is corrupt (${(e as Error).message}) — starting a fresh profile. ${path}\n`,
        );
        return;
      }
      const file = parsed as Partial<StoredFile>;
      if (!file || typeof file !== "object" || file.version !== FILE_VERSION) return;
      if (!file.profiles || typeof file.profiles !== "object") return;
      for (const [key, prof] of Object.entries(file.profiles)) {
        if (!prof || typeof prof !== "object" || typeof prof.buckets !== "object") continue;
        const buckets = bucketsFor(key);
        for (const [bucket, samples] of Object.entries(prof.buckets)) {
          if (!Array.isArray(samples)) continue;
          const clean = samples.filter(
            (s): s is StoredSample =>
              Array.isArray(s) && s.length === 2 &&
              Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] >= 0,
          );
          if (clean.length > 0) buckets.set(bucket, clean.slice(-SAMPLES_PER_BUCKET));
        }
        if (typeof prof.updated_at === "number") updatedAt.set(key, prof.updated_at);
      }
    },

    record(input: RecordInput): void {
      if (!input.key) return;
      // Eine negative oder absurde Dauer ist keine Messung. Die Obergrenze ist
      // dieselbe, die `abandonAfter` als Timer überhaupt zulässt.
      if (!Number.isFinite(input.totalMs) || input.totalMs < 0) return;
      if (input.totalMs > MAX_DEADLINE_MS) return;
      const buckets = bucketsFor(input.key);
      const bk = bucketKey(input.residency, input.queryChars, input.concurrency);
      const samples = buckets.get(bk) ?? [];
      samples.push([now(), Math.round(input.totalMs)]);
      // Das gleitende Fenster: die älteste Stichprobe fällt hinten raus.
      if (samples.length > SAMPLES_PER_BUCKET) samples.splice(0, samples.length - SAMPLES_PER_BUCKET);
      buckets.set(bk, samples);
      updatedAt.set(input.key, now());
      schedulePersist();
    },

    derive(input: DeriveInput): DerivedDeadline {
      const bk = bucketKey(input.residency, input.queryChars, input.concurrency);
      const buckets = profiles.get(input.key);
      const exact = fresh(buckets?.get(bk));
      let values = exact;
      let basis: DerivedDeadline["basis"] = "bucket";
      if (values.length < MIN_BUCKET_SAMPLES && buckets) {
        // Rückfall auf das ganze Profil (siehe MIN_BUCKET_SAMPLES): gröber,
        // aber es gibt überhaupt eine Zahl.
        const wide: number[] = [];
        for (const samples of buckets.values()) wide.push(...fresh(samples));
        if (wide.length > values.length) {
          values = wide;
          basis = "profile-wide";
        }
      }
      if (values.length === 0) {
        // #491: „Leeres Profil: einmal lexikalisch antworten." Die Untergrenze
        // ist genau das — der Arm wird sofort aufgegeben, läuft aber weiter und
        // liefert die erste Stichprobe.
        return {
          predicted_deadline_ms: MIN_DEADLINE_MS,
          cap_reason: "profile-empty",
          basis: "empty",
          samples: 0,
          expected_total_ms: null,
          bucket: bk,
        };
      }

      const expected = p95(values);
      // Die Ableitung passiert NACH BM25, wo das Warten beginnt: Was der Arm
      // im Schatten von BM25 schon verbraucht hat, muss der Aufrufer nicht
      // mehr warten.
      const overlap = Number.isFinite(input.overlapMs) ? Math.max(0, input.overlapMs) : 0;
      const raw = Math.ceil(expected - overlap);
      let predicted = Math.min(raw, MAX_DEADLINE_MS);
      let cap: CapReason = "none";
      if (predicted < MIN_DEADLINE_MS) {
        predicted = MIN_DEADLINE_MS;
        cap = "floor";
      }
      // Die Wanduhr der Lane deckelt HART und zuletzt: Sie ist ein Vertrag
      // (SessionStart 500 ms, Prompt-Lane 200 ms), keine Schätzung. Auch der
      // Boden bleibt darunter erhalten — eine Deadline unter 50 ms nähme der
      // Endpunkt gar nicht an, und eine, die er nicht annimmt, kann #492 nicht
      // scharf schalten.
      if (Number.isFinite(input.laneRemainingMs) && predicted > input.laneRemainingMs) {
        predicted = Math.max(MIN_DEADLINE_MS, Math.floor(input.laneRemainingMs));
        cap = "lane-wall-clock";
      }
      return {
        predicted_deadline_ms: predicted,
        cap_reason: cap,
        basis,
        samples: values.length,
        expected_total_ms: expected,
        bucket: bk,
      };
    },

    beginArm(): number {
      inFlight++;
      return inFlight;
    },

    endArm(): void {
      if (inFlight > 0) inFlight--;
    },

    async flush(): Promise<void> {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      await persisting;
      await persist();
    },

    sampleCount(key: string): number {
      const buckets = profiles.get(key);
      if (!buckets) return 0;
      let n = 0;
      for (const samples of buckets.values()) n += fresh(samples).length;
      return n;
    },
  };
}

/**
 * Was die Recall-Pipeline braucht, um den Schatten zu rechnen — ein Bündel,
 * damit `HookRecallDeps` nicht um drei einzelne Getter wächst, die nur
 * gemeinsam Sinn ergeben.
 */
export interface DeadlineShadow {
  /** `provider:model` des aktiven Providers, `null` ohne dichten Arm. */
  key: () => string | null;
  /** Die Residenz — aus dem Warmup-Koordinator (#490), nicht aus einer zweiten
   *  Quelle. */
  residency: () => Residency;
  profile: LatencyProfile;
}
