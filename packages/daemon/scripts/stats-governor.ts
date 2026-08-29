/**
 * Zwei Report-Sichten für `stats.ts`, als reine Rechnung (#354, §18.2).
 *
 * WARUM EIGENES MODUL. `stats.ts` ruft sein `main()` auf Modulebene — wer es
 * importiert, startet den Report. Testbar wird die Rechnung nur, wenn sie
 * daneben liegt. Deshalb hier: Zahlen rein, Zahlen raus, kein `console.log`.
 * Gedruckt wird in `stats.ts`.
 */

/** Ein geladenes Log-Ereignis. Strukturgleich mit `AnyEvent` in `stats.ts` —
 *  bewusst hier wiederholt statt importiert, weil `stats.ts` sein `main()` auf
 *  Modulebene ruft und ein Import von dort den Report starten würde. */
export interface AnyEventLike {
  kind: string;
  ts: string;
  [key: string]: unknown;
}

// ─── Governor-Was-wäre-wenn (#354) ───────────────────────────────

/** Die Ereignisse, die eine Injektion mit Tokenkosten melden. Es sind die
 *  Hook-CLI-Ereignisse; die Lanes selbst schreiben keine eigene Kostenzeile. */
const INJECTING_KINDS = new Set([
  "hook_call",
  "session_hook_call",
  "bash_hook_call",
  "prompt_hook_call",
  "bash_fail_hook_call",
  "todo_hook_call",
]);

export interface GovernorBudgetRow {
  budget: number;
  /** Sessions, in denen das Budget irgendwann gerissen wäre. */
  sessionsAffected: number;
  /** Injektionen, die danach nicht mehr hineingepasst hätten. */
  emissionsTrimmed: number;
  /** Deren geschätzte Tokens. */
  tokensTrimmed: number;
}

export interface GovernorWhatIf {
  /** Sessions mit mindestens einer Injektion. */
  sessionsWithInjection: number;
  /** Davon die mit mindestens zwei — nur sie sind als Sitzung auswertbar.
   *  Der Rest sind überwiegend Einzelaufrufe mit je eigener synthetischer id. */
  sessionsMultiEmission: number;
  /** Tokens je auswertbarer Session. */
  tokensPerSession: { p50: number; p75: number; p90: number; max: number };
  /** Injektionen je auswertbarer Session. */
  emissionsPerSession: { p50: number; p90: number; max: number };
  totalTokens: number;
  rows: GovernorBudgetRow[];
}

const quantile = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/**
 * Was ein Sitzungsbudget beschnitten hätte.
 *
 * DIE GRENZE DIESER RECHNUNG, ausdrücklich: Der echte Governor
 * (`context-governor.ts`) entscheidet je EINTRAG innerhalb einer Injektion —
 * nach Priorität, und ein Eintrag, der allein das Budget sprengt, fällt ganz.
 * Die Ereignisse führen aber nur die Summe je Injektion (`hint_tokens_est`).
 * Diese Sicht rechnet deshalb auf Injektionsebene: Ist das Budget einer Sitzung
 * aufgebraucht, gilt jede weitere Injektion als beschnitten. Das ist gröber als
 * der Governor und beantwortet trotzdem die Frage, um die es geht — wieviel
 * Kontext ein gesetztes Budget gekostet hätte, und wie viele Sitzungen es
 * überhaupt berührt.
 *
 * Sitzungen mit nur einer Injektion bleiben draußen. Die Bash-Lane stempelt pro
 * Aufruf eine eigene synthetische Session-id, und die als Sitzungen zu zählen
 * hieße, tausende Einzelaufrufe als Sitzungen auszuweisen.
 */
export function governorWhatIf(events: AnyEventLike[], budgets: number[]): GovernorWhatIf {
  const perSession = new Map<string, number[]>();
  for (const e of events) {
    if (!INJECTING_KINDS.has(String(e.kind))) continue;
    const tokens = typeof e.hint_tokens_est === "number" ? e.hint_tokens_est : 0;
    if (tokens <= 0) continue;
    const key = String(e.session_id ?? "?");
    const list = perSession.get(key);
    if (list) list.push(tokens);
    else perSession.set(key, [tokens]);
  }

  const alle = [...perSession.values()];
  const mehrfach = alle.filter((a) => a.length >= 2);
  const summe = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const summen = mehrfach.map(summe);
  const laengen = mehrfach.map((a) => a.length);

  const rows: GovernorBudgetRow[] = budgets.map((budget) => {
    let sessionsAffected = 0;
    let emissionsTrimmed = 0;
    let tokensTrimmed = 0;
    for (const session of mehrfach) {
      let spent = 0;
      let trimmedHere = false;
      for (const cost of session) {
        // Dieselbe Regel wie im Governor: Was nicht mehr hineinpasst, fällt
        // ganz — gekürzt wird kein Eintrag, ein halber Beleg ist keiner.
        if (spent + cost > budget) {
          emissionsTrimmed++;
          tokensTrimmed += cost;
          trimmedHere = true;
        } else {
          spent += cost;
        }
      }
      if (trimmedHere) sessionsAffected++;
    }
    return { budget, sessionsAffected, emissionsTrimmed, tokensTrimmed };
  });

  return {
    sessionsWithInjection: alle.length,
    sessionsMultiEmission: mehrfach.length,
    tokensPerSession: {
      p50: quantile(summen, 0.5),
      p75: quantile(summen, 0.75),
      p90: quantile(summen, 0.9),
      max: summen.length ? Math.max(...summen) : 0,
    },
    emissionsPerSession: {
      p50: quantile(laengen, 0.5),
      p90: quantile(laengen, 0.9),
      max: laengen.length ? Math.max(...laengen) : 0,
    },
    totalTokens: summe(alle.map(summe)),
    rows,
  };
}

// ─── no_answer-Divergenzen (§18.2) ───────────────────────────────

export interface DivergenceSignature {
  /** Was Legacy getan hätte: `required` | `optional` | `below_floor`. */
  legacyBand: string;
  /** Was der Entscheid sagt. */
  decision: string;
  abstainReason: string;
  exactIdentifier: boolean;
  coverage: number;
  armAgreement: boolean;
  scopeMatch: boolean;
  temporalStatus: string;
}

export interface DivergenceGroup {
  signature: DivergenceSignature;
  /** Wie oft die Signatur auftrat — Ereignisse, nicht Memories. */
  events: number;
  /** Wieviele VERSCHIEDENE Memories dahinterstecken. Der Abstand zwischen
   *  beiden Zahlen ist die eigentliche Auskunft: 452 Ereignisse über 37
   *  Memories sind ein Muster, keine 452 Einzelfälle. */
  memories: number;
}

export interface NoAnswerDivergence {
  /** Der Entscheid schweigt, Legacy hätte ausgespielt. */
  gateSilentLegacyServed: DivergenceGroup[];
  /** Der Entscheid spielt aus, Legacy hätte geschwiegen. */
  gateServedLegacySilent: DivergenceGroup[];
  /** Entscheidungen, deren Score-Raum unbekannt ist (kein `hook_recall` im
   *  Fenster) — nicht vergleichbar, deshalb getrennt gezählt. */
  unknownSpace: number;
}

interface DecisionLike {
  memory_id: string;
  decision: string;
  abstain_reason?: string;
  evidence?: Record<string, unknown>;
}

const signatureKey = (s: DivergenceSignature): string =>
  [
    s.legacyBand,
    s.decision,
    s.abstainReason,
    s.exactIdentifier,
    s.coverage,
    s.armAgreement,
    s.scopeMatch,
    s.temporalStatus,
  ].join("|");

/**
 * Beide Richtungen der `no_answer`-Abweichung, nach Signatur gruppiert.
 *
 * §18.2 macht die Erklärung JEDER beobachteten `required`/`no_answer`-Abweichung
 * zur Freigabebedingung. Die bestehende Sicht in `stats.ts` vergleicht nur
 * `required` gegen `required` — die Klasse „der Entscheid schweigt, wo Legacy
 * im optional-Band ausgespielt hätte" taucht darin nirgends auf, obwohl sie die
 * größte ist.
 *
 * Gruppiert wird nach der Merkmalssignatur, nicht nach Memory: Eine Klasse mit
 * einer einzigen Signatur über hunderte Ereignisse ist EIN Befund, den man
 * einmal erklären kann. Die distinkte Memory-Zahl steht daneben, weil sie sagt,
 * wie breit die Klasse wirklich ist.
 *
 * Nur fusionierte Läufe, aus demselben Grund wie die bestehende Sicht: Auf
 * rohem BM25 bandet Legacy nicht, und gegen ein Band zu vergleichen, das es
 * nicht gab, wäre keine Abweichung, sondern ein Kategorienfehler.
 */
export function noAnswerDivergence(
  events: AnyEventLike[],
  shadow: AnyEventLike[],
  decisionsOf: (e: AnyEventLike) => DecisionLike[],
  mustLoadScore: number,
  scoreFloor: number,
): NoAnswerDivergence {
  const fused = new Map<string, boolean>();
  for (const r of events) {
    if (r.kind !== "hook_recall") continue;
    fused.set(String(r.recall_id), r.score_kind === "rrf");
  }

  const silent = new Map<string, DivergenceGroup & { ids: Set<string> }>();
  const served = new Map<string, DivergenceGroup & { ids: Set<string> }>();
  let unknownSpace = 0;

  for (const e of shadow) {
    const space = fused.get(String(e.recall_id));
    if (space === undefined) {
      unknownSpace += decisionsOf(e).length;
      continue;
    }
    if (!space) continue;
    for (const d of decisionsOf(e)) {
      const score =
        typeof d.evidence?.lexical_score === "number" ? (d.evidence.lexical_score as number) : null;
      if (score === null) continue;
      const legacyBand =
        score >= mustLoadScore ? "required" : score >= scoreFloor ? "optional" : "below_floor";
      const legacyServed = score >= scoreFloor;
      const gateSilent = d.decision === "no_answer";
      if (legacyServed === !gateSilent) continue; // einig — keine Abweichung

      const ev = d.evidence ?? {};
      const signature: DivergenceSignature = {
        legacyBand,
        decision: d.decision,
        abstainReason: d.abstain_reason ?? "-",
        exactIdentifier: ev.exact_identifier === true,
        coverage: typeof ev.recall_when_coverage === "number" ? ev.recall_when_coverage : 0,
        armAgreement: ev.arm_agreement === true,
        scopeMatch: ev.scope_match === true,
        temporalStatus: typeof ev.temporal_status === "string" ? ev.temporal_status : "unknown",
      };
      const bucket = gateSilent ? silent : served;
      const key = signatureKey(signature);
      const row = bucket.get(key);
      if (row) {
        row.events++;
        row.ids.add(d.memory_id);
      } else {
        bucket.set(key, { signature, events: 1, memories: 0, ids: new Set([d.memory_id]) });
      }
    }
  }

  const finish = (m: Map<string, DivergenceGroup & { ids: Set<string> }>): DivergenceGroup[] =>
    [...m.values()]
      .map(({ signature, events, ids }) => ({ signature, events, memories: ids.size }))
      .sort((a, b) => b.events - a.events);

  return {
    gateSilentLegacyServed: finish(silent),
    gateServedLegacySilent: finish(served),
    unknownSpace,
  };
}
