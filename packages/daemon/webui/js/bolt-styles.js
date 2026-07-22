/** The three ways activity travels a connection (#217).
 *
 *  All three share what the renderer already decided: WHICH strands carry the
 *  discharge (level 1 = every connection the memory has, then a thinning tail)
 *  and HOW STRONG each leg is. They differ only in what is painted on a leg —
 *  and every one of them paints on the strand's own curve, never on the chord
 *  between two nodes.
 *
 *  Split out of renderer.js: the renderer was at 700 lines and three styles
 *  would have pushed it past the point where a small change means reading a
 *  large file (file-size convention).
 */

export const BOLT_STYLE_KEY = "bastra-vault-map-bolt-style";
export const BOLT_MS_KEY = "bastra-vault-map-bolt-ms";
export const BOLT_MS_DEFAULT = 420;
export const BOLT_MS_MIN = 300;
export const BOLT_MS_MAX = 4000;
export const BOLT_SEGMENTS = 7; // zigzag points per bolt

/** Deterministic 0..1 value. */
export function boltRnd(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Point on the edge's own path at t (0 = s, 1 = t), plus the normal there —
 *  the direction a zigzag deflects. `cp` is edgeBend's control point; without
 *  one the edge is a straight line and this degenerates to a lerp. */
export function pathAt(e, cp, t) {
  const { x: x0, y: y0 } = e.s;
  const { x: x1, y: y1 } = e.t;
  let px, py, dx, dy;
  if (cp) {
    const u = 1 - t;
    px = u * u * x0 + 2 * u * t * cp.x + t * t * x1;
    py = u * u * y0 + 2 * u * t * cp.y + t * t * y1;
    dx = 2 * u * (cp.x - x0) + 2 * t * (x1 - cp.x);
    dy = 2 * u * (cp.y - y0) + 2 * t * (y1 - cp.y);
  } else {
    px = x0 + (x1 - x0) * t;
    py = y0 + (y1 - y0) * t;
    dx = x1 - x0;
    dy = y1 - y0;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: px, y: py, nx: -dy / len, ny: dx / len };
}

/** Sub-path from `a` to `b` along the strand, as a fresh path (no stroke). */
function tracePath(ctx, e, cp, a, b, steps = 18) {
  ctx.beginPath();
  const from = Math.max(0, Math.min(1, a));
  const to = Math.max(0, Math.min(1, b));
  for (let i = 0; i <= steps; i++) {
    const p = pathAt(e, cp, from + ((to - from) * i) / steps);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

/** The rail: the connection itself, lit for as long as something runs on it.
 *  Galaxy and ring views keep ambient strands dark (quietEdges), so without
 *  this the activity would appear to fly through open space — the very thing
 *  it is supposed to trace. */
function drawRail(s, alpha) {
  const { ctx, camScale } = s;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1 / camScale;
  s.strokeEdge(s.e);
}

export const BOLT_STYLES = {
  /** Zigzag along the strand — the original look, kept intact. */
  bolt: {
    label: "bolt",
    draw(s) {
      const { ctx, e, cp, strength, seed, camScale } = s;
      drawRail(s, 0.32 * strength);
      const len = Math.hypot(e.t.x - e.s.x, e.t.y - e.s.y) || 1;
      const amp = Math.min(len * 0.13, 26 / camScale);
      ctx.globalAlpha = 0.34 * strength;
      ctx.lineWidth = 1.1 / camScale;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      for (let i = 1; i < BOLT_SEGMENTS; i++) {
        const p = i / BOLT_SEGMENTS;
        const j = (boltRnd(seed + i * 7.31) - 0.5) * 2 * amp * Math.sin(p * Math.PI);
        const at = pathAt(e, cp, p);
        ctx.lineTo(at.x + at.nx * j, at.y + at.ny * j);
      }
      ctx.lineTo(e.t.x, e.t.y);
      ctx.stroke();
    },
  },

  /** A charge running down the wire: the strand is lit, and a short bright
   *  piece of it travels from the flaring memory to its neighbour. Reads as
   *  direction — you see WHERE the activity goes, not just that it went. */
  pulse: {
    label: "pulse",
    draw(s) {
      const { ctx, e, cp, t, strength, camScale } = s;
      drawRail(s, 0.3 * strength);
      const head = Math.min(1, t * 1.15);
      const tail = 0.26;
      ctx.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const b = head - (tail * i) / 6;
        if (b <= 0) break;
        ctx.globalAlpha = 0.85 * strength * (1 - i / 6);
        ctx.lineWidth = (2.4 - i * 0.3) / camScale;
        tracePath(ctx, e, cp, head - (tail * (i + 1)) / 6, b, 5);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    },
  },

  /** The calmest: no separate mark at all. The connection itself is drawn on
   *  from the flaring memory outward and burns down again — nothing exists
   *  that is not already part of the map. */
  trace: {
    label: "trace",
    draw(s) {
      const { ctx, e, cp, t, strength, camScale } = s;
      const grow = Math.min(1, t * 2.2);
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.18 * strength;
      ctx.lineWidth = 5 / camScale;
      tracePath(ctx, e, cp, 0, grow);
      ctx.stroke();
      ctx.globalAlpha = 0.9 * strength;
      ctx.lineWidth = 1.5 / camScale;
      tracePath(ctx, e, cp, 0, grow);
      ctx.stroke();
      ctx.lineCap = "butt";
    },
  },
};

/** Style id from storage, falling back to the original look. "off" is a valid
 *  stored value even though it has no entry here — the renderer resolves an
 *  unknown id to "draw nothing", which is exactly what off means. */
export function storedBoltStyle() {
  try {
    const v = localStorage.getItem(BOLT_STYLE_KEY);
    return v && (BOLT_STYLES[v] || v === "off") ? v : "bolt";
  } catch {
    return "bolt"; // private mode / storage disabled — never break the map over a preference
  }
}

/** Discharge duration from storage, clamped into the slider's own range. */
export function storedBoltMs() {
  try {
    const n = Number(localStorage.getItem(BOLT_MS_KEY));
    if (!Number.isFinite(n) || n <= 0) return BOLT_MS_DEFAULT;
    return Math.min(BOLT_MS_MAX, Math.max(BOLT_MS_MIN, n));
  } catch {
    return BOLT_MS_DEFAULT;
  }
}
