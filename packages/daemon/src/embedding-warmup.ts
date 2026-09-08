/**
 * The shared embedding warm-up (#490).
 *
 * #361 gave the PROMPT lane a prewarmer (`embedding-prewarm.ts`, fired at
 * `UserPromptSubmit`). The SESSION-START lane never had one, for a structural
 * reason: its recall IS the first contact of the session, so it pays the cold
 * load itself. Measured 08.09.2026 (M4 Pro, local Ollama, `embeddinggemma`,
 * 673MB): a warm embed answers in 33–54ms, the first embed after a full unload
 * takes 585ms. The lane's dense-arm deadline is 350ms and the misses that day
 * sat at 366, 378, 379, 384, 388 and 394ms — a knife edge, because one number
 * has to fall between two distributions an order of magnitude apart.
 *
 * This module is the third trigger, and it is what makes all three ONE thing:
 *
 *   · daemon boot            — `prewarmOllamaModel` (#78), already there
 *   · `UserPromptSubmit`     — the prewarmer (#361), already there
 *   · first session contact  — new, and the reason this file exists
 *
 * Two properties the lane cannot get from the prewarmer:
 *
 * 1. RESIDENCY. The lane must be able to ASK whether the model is loaded
 *    instead of racing blind. The signal is `runtimeHealth().lastOkAt` — the
 *    timestamp of the last successful provider call, which every provider
 *    maintains. Provider-agnostic and free; deliberately NOT an Ollama
 *    `/api/ps` call, which would make an Ollama trait into the rule and cost a
 *    round trip on the one path that has none to spare.
 *
 * 2. ONE warm-up at a time. The prewarmer's 60s debounce dedupes turns; it
 *    does not know whether a warm call is still in flight. Several sessions
 *    starting seconds apart would otherwise hit a cold machine with an embed
 *    storm at exactly the moment it is slowest. The coordinator holds the
 *    in-flight flag, and both triggers go through it.
 *
 * One coordinator per provider+model: the daemon resolves exactly one
 * embedding provider at boot, so the process-wide instance IS the per-model
 * one — there is no second model to confuse it with.
 *
 * What this deliberately does NOT do (all three rejected in #490): wait for the
 * cold load at session start (unbounded against the lane's 500ms wall clock);
 * reload the model just before the idle unload fires (that is #78's energy
 * decision undone, with extra compute); keep the model permanently resident
 * (`keep_alive: -1`, 673MB held for as long as the daemon lives).
 */

/**
 * How long after the last successful embed the model still counts as resident.
 *
 * Both eviction paths are ten minutes from that moment: the per-request
 * `keep_alive` the daemon sends (#78, default "10m") and the idle unload
 * (`daemon-jobs.ts`, default 10min). Eight minutes leaves a margin for the
 * unload tick's 60s resolution and for a user who lowered `keep_alive`.
 *
 * The two ways to be wrong are NOT symmetric, which is what sizes this number.
 * Wrong toward "cold" costs one lexical session start on a model that was in
 * fact warm. Wrong toward "warm" costs exactly what happens today — the lane
 * runs its 350ms deadline into a cold load and comes back lexical anyway. So
 * the conservative side is cheap, and this window sits on it.
 *
 * Hardcoded, not an env switch, for the reason given at
 * `SESSION_VECTOR_DEADLINE_MS` (session-lane.ts): an inherited service config
 * could silently turn the decision off and no telemetry line would say so.
 *
 * #493: Das Fenster ist seither die LETZTE Instanz, nicht die einzige. Ein
 * beobachteter Unload (`noteUnloaded`) und ein beobachteter Ladevorgang
 * (`noteLoaded`) schlagen es, weil sie Messungen sind und es eine Schätzung
 * ist — der Idle-Unload ist konfigurierbar (`BASTRA_OLLAMA_IDLE_UNLOAD_MS`)
 * und `keep_alive` auch, also konnte diese Zahl beiden widersprechen. Wo das
 * Fenster trotzdem entscheidet, sagt `ResidencyReading.estimated` es.
 */
export const RESIDENT_WINDOW_MS = 8 * 60_000;

/**
 * Is the model loaded right now, as far as we can tell for free?
 *
 * `unknown` is its own answer and not folded into `cold`: no successful embed
 * has happened yet in this process (fresh daemon, boot prewarm possibly still
 * in flight). The lane treats it like cold — but the telemetry must be able to
 * tell "we know it is out of RAM" from "we have never seen it answer".
 */
export type Residency = "warm" | "cold" | "unknown" | "hosted";

/**
 * WOHER die Residenzantwort stammt (#493).
 *
 * Der Befund, der dieses Feld erzwingt: Tor 3 aus #492 zählt „20 echte
 * Kaltstarts" und stützte sich dafür auf ein Feld, das eine SCHÄTZUNG war und
 * dazu noch eine falsche. Ein erfolgreicher Warmup ging am Provider vorbei
 * (`guardedProvider.embed(["warm"])` statt über den Index), also aktualisierte
 * er `lastOkAt` gar nicht — ein frisch gewärmtes Modell las `unknown`. Und
 * umgekehrt las ein extern entladenes Modell minutenlang `warm`, weil das
 * 8-Minuten-Fenster von keinem Unload etwas wusste.
 *
 * Jetzt schreiben Warmups und Unloads in DENSELBEN Zustand, und die Quelle
 * steht in der Telemetrie:
 *
 *   `unload-observed` — GRUNDWAHRHEIT. Wir haben das Modell selbst entladen.
 *   `provider-load`   — GRUNDWAHRHEIT. Der Provider hat für einen Call ein
 *                       Modell geladen (Ollama `load_duration`).
 *   `warm-up`         — ein Warmup dieses Prozesses ist erfolgreich gelaufen.
 *   `last-ok`         — geschätzt, aus dem Alter des letzten erfolgreichen
 *                       Provider-Calls gegen {@link RESIDENT_WINDOW_MS}.
 *   `hosted`          — es gibt kein Modell von uns, das kalt werden könnte.
 *   `none`            — noch keinerlei Beleg (`unknown`).
 */
export type ResidencySource =
  | "unload-observed"
  | "provider-load"
  | "warm-up"
  | "last-ok"
  | "hosted"
  | "none";

/** Residenz plus die Frage, ob sie gemessen oder geschätzt ist. */
export interface ResidencyReading {
  state: Residency;
  source: ResidencySource;
  /** `true` = aus dem 8-Minuten-Fenster erschlossen, nicht beobachtet. Tor 3
   *  aus #492 darf auf geschätzten Zeilen nicht zählen. */
  estimated: boolean;
}

/** What `ensureWarm()` decided. */
export type WarmupOutcome =
  | "fired"
  | "skipped-in-flight"
  | "skipped-warm"
  | "skipped-no-provider"
  | "skipped-hosted";

export interface WarmupCoordinator {
  /** Free residency answer for a caller about to spend a deadline on it. */
  residency: () => Residency;
  /** #493: dieselbe Antwort mit ihrer Herkunft — für die Telemetrie, die
   *  Grundwahrheit von Schätzung trennen muss. */
  residencyDetail: () => ResidencyReading;
  /**
   * #493: Das Modell ist JETZT geladen — Grundwahrheit, kein Zeitfenster.
   *
   * Zwei Melder: der erfolgreiche Warmup dieses Prozesses (der sonst spurlos
   * bliebe, weil er am Index vorbeigeht) und ein Provider, der für seinen Call
   * eine Ladezeit berichtet hat (Ollama `load_duration`). `loadMs` ist genau
   * diese Angabe, `null` wenn es keine gibt.
   */
  noteLoaded: (loadMs?: number | null) => void;
  /**
   * #493: Das Modell hat den Speicher verlassen — Grundwahrheit. Gemeldet vom
   * Idle-Unload (`daemon-jobs.ts`), dessen Frist konfigurierbar ist und dem
   * 8-Minuten-Fenster deshalb widersprechen konnte.
   */
  noteUnloaded: () => void;
  /** Start a warm-up unless one is running, the model is warm, or there is
   *  nothing to warm. Never awaited, never throws. */
  ensureWarm: () => WarmupOutcome;
  /**
   * The session lane's single call: report residency AND, when the model is
   * not known to be resident, kick the shared warm-up off BESIDE the recall.
   * One call so the lane cannot ask and then forget to act on the answer.
   */
  onSessionContact: () => Residency;
}

export interface WarmupOptions {
  /**
   * Is the dense arm available at all? Same question the recall path asks:
   * an attached embedding index AND a breaker (#165) that is not open.
   * Half-open passes — the warm call is a real embed and may serve as the
   * breaker's single probe.
   */
  denseArmAvailable: () => boolean;
  /**
   * Is the active provider a HOSTED one? Then there is no model of ours to be
   * cold and nothing to warm — inherited from `PrewarmOptions.hostedProvider`
   * (#361) rather than reinvented, so an Ollama trait stays an Ollama trait.
   * Absent = treat the provider as one worth warming.
   */
  hostedProvider?: () => boolean;
  /** `embIdx().runtimeHealth().lastOkAt` — the last successful provider call,
   *  or null when none has happened in this process. */
  lastOkAt: () => number | null;
  /** The one small embed. Its promise is never awaited by any lane. */
  warm: () => Promise<unknown>;
  /** Injected clock — residency and in-flight are tested hermetically. */
  now?: () => number;
  /** Debug sink for a failed warm call. Absent = swallowed silently. */
  onError?: (err: unknown) => void;
}

/** Build the daemon's single warm-up coordinator. */
export function createEmbeddingWarmup(opts: WarmupOptions): WarmupCoordinator {
  const now = opts.now ?? Date.now;
  let inFlight = false;
  // #493: DER gemeinsame Lifecycle-Zustand. Vorher gab es ihn nicht — es gab
  // eine Ableitung aus `lastOkAt`, die den Warmup nicht sah und den Unload
  // nicht sah. Beide Zeitstempel sind Beobachtungen, keine Schätzungen; die
  // jüngere gewinnt.
  let loadedAt: number | null = null;
  let loadedSource: "warm-up" | "provider-load" | null = null;
  let unloadedAt: number | null = null;

  const residencyDetail = (): ResidencyReading => {
    if (opts.hostedProvider?.() === true) {
      return { state: "hosted", source: "hosted", estimated: false };
    }
    const lastOk = opts.lastOkAt();
    // Der jüngste Beleg dafür, dass das Modell im Speicher IST.
    const lastResident = Math.max(loadedAt ?? -1, lastOk ?? -1);
    if (unloadedAt !== null && unloadedAt >= lastResident) {
      // Wir haben selbst entladen und seither nichts Gegenteiliges gesehen.
      return { state: "cold", source: "unload-observed", estimated: false };
    }
    if (lastResident < 0) return { state: "unknown", source: "none", estimated: false };
    // Auch ein beobachteter Ladevorgang altert: „vor 20 Minuten geladen"
    // belegt nicht, dass es jetzt noch da ist. Jenseits des Fensters steht die
    // Antwort deshalb immer auf der Schätzung, nie auf der alten Beobachtung.
    if (now() - lastResident >= RESIDENT_WINDOW_MS) {
      return { state: "cold", source: "last-ok", estimated: true };
    }
    const observed = loadedSource !== null && loadedAt !== null && loadedAt >= (lastOk ?? -1);
    return {
      state: "warm",
      source: observed ? loadedSource! : "last-ok",
      estimated: !observed,
    };
  };

  const residency = (): Residency => residencyDetail().state;

  const noteLoaded = (loadMs?: number | null): void => {
    loadedAt = now();
    // Ein Provider, der eine Ladezeit gemeldet hat, ist die stärkere Aussage:
    // Er hat GERADE geladen. Ein Warmup sagt nur „ein Embed ist durchgelaufen".
    loadedSource = typeof loadMs === "number" ? "provider-load" : "warm-up";
  };

  const noteUnloaded = (): void => {
    unloadedAt = now();
  };

  const ensureWarm = (): WarmupOutcome => {
    // Asked first, like in the prewarmer: "there is nothing here to warm" is a
    // different event from "the arm is down", and the two must stay apart.
    if (opts.hostedProvider?.() === true) return "skipped-hosted";
    if (!opts.denseArmAvailable()) return "skipped-no-provider";
    // The point of the whole file: five sessions starting at once share ONE
    // load. The flag is set before the call and cleared when it settles.
    if (inFlight) return "skipped-in-flight";
    if (residency() === "warm") return "skipped-warm";

    inFlight = true;
    const done = (): void => {
      inFlight = false;
    };
    try {
      void Promise.resolve(opts.warm()).then(
        () => {
          done();
          // #493: Der erfolgreiche Warmup schreibt in den gemeinsamen Zustand.
          // Bis hierher tat er das NICHT: Er geht am Index vorbei, also blieb
          // `lastOkAt` unberührt und ein frisch gewärmtes Modell las `unknown`.
          noteLoaded(null);
        },
        (err) => {
          done();
          opts.onError?.(err);
        },
      );
    } catch (err) {
      // A `warm` that throws synchronously (misconfigured provider URL) must
      // not leave the coordinator wedged as permanently in-flight.
      done();
      opts.onError?.(err);
    }
    return "fired";
  };

  return {
    residency,
    residencyDetail,
    noteLoaded,
    noteUnloaded,
    ensureWarm,
    onSessionContact: () => {
      const state = residency();
      // Warm needs nothing, hosted has nothing to warm. Everything else gets
      // the load started NEXT TO the session-start recall instead of inside
      // it — the lane answers lexically meanwhile and is fused from its second
      // recall on.
      if (state === "cold" || state === "unknown") ensureWarm();
      return state;
    },
  };
}
