/** The galactic core — swappable centre graphic for the galactic modes.
 *
 *  Only `galaxy` and `galaxy-lab` have a centre to draw: the two universe modes
 *  have no single core, so the switcher stays hidden there.
 *
 *  `classic` is the shipped black hole, moved here byte for byte out of
 *  orbit-decor.js — selecting it must look exactly like before. Everything else
 *  is an alternative that gets drawn instead.
 *
 *  Contract for a core renderer:
 *      draw(ctx, o, glowSprite)  with o = { x, y, r, t, camScale, theme, fade, depth }
 *        x, y      screen position of the centre (already projected)
 *        r         core radius in world units, depth-scaled
 *        t         seconds, for animation
 *        camScale  camera scale — divide by it for screen-constant sizes
 *        theme     the active theme object (accent, label, labelHalo, flowBlend)
 *        fade      entry-flight fade (0…1)
 *        depth     depth fade (0…1), SEPARATE from `fade`: the shipped core
 *                  applies it to its outer glow only, so the centre does not
 *                  dim when it sits on the far side
 *
 *  Screen-px floors follow the canvas playbook: anything with signal character
 *  needs `max(world * scale, minPx / camScale)` so it survives zooming out.
 */

const TAU = Math.PI * 2;

/** The shipped black hole: dark core punched with the label-halo ink, bright
 *  accent rim, two faint outer rings, and a slow breathing pulse. */
function classic(ctx, o, glowSprite) {
  const { x, y, r, t, camScale, theme, fade, depth } = o;
  const spinPulse = 1 + 0.05 * Math.sin(t * 1.7);

  ctx.globalCompositeOperation = theme.flowBlend;
  ctx.globalAlpha = 0.5 * fade * depth; // depth on the glow only — see contract
  const gr = r * 2.4 * spinPulse;
  ctx.drawImage(glowSprite(theme.accent, theme.label), x - gr, y - gr, gr * 2, gr * 2);
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = Math.min(1, 0.94 * fade);
  ctx.fillStyle = theme.labelHalo;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, TAU);
  ctx.fill();

  ctx.globalAlpha = 0.85 * fade;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.6 / camScale;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6 * spinPulse, 0, TAU);
  ctx.stroke();

  ctx.globalAlpha = 0.22 * fade;
  ctx.lineWidth = 0.8 / camScale;
  for (const m of [0.95, 1.35]) {
    ctx.beginPath();
    ctx.arc(x, y, r * m, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ── Lab primitives, ported verbatim from mindspace-lab-center-anims.js ──────
//
// The lab is where these animations were designed and picked, so a core that
// ships has to look like the one that was chosen there — same motion, same
// timing, same colours. My first attempt at the jets reinvented them as two
// static accent-coloured strokes and looked nothing like it.
//
// Two deliberate departures, both forced by the map rather than by taste:
//   · glow() draws from the pre-rendered sprite cache instead of building a
//     radial gradient per call (canvas playbook — per-frame gradients were the
//     original frame-budget hotspot)
//   · line widths divide by camScale, so they stay screen-constant when zoomed
//
// Sizes are expressed in LAB units and scaled by S = r / 20, because the lab's
// classic core uses r0 = 20 where the map passes `r`. That keeps every
// proportion — beam length, width, horizon radius — exactly as designed.

/** Jets spin unevenly: a steady sweep with two wobbles laid over it. */
const beamSpin = (t, base = 3.2) => t * base + 0.4 * Math.sin(t * 3.1) + 0.2 * Math.sin(t * 6.7);
/** ...and flicker, fast shimmer modulated by a slower swell. */
const beamFlick = (t, o = 0) =>
  0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 9.3 + o)) * (0.6 + 0.4 * Math.sin(t * 2.7 + o));

/** A beam: a wedge widening away from the core, fading along its length. */
function lobe(ctx, cx, cy, ang, len, wid, color, a, blend) {
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.beginPath();
  ctx.moveTo(0, -wid * 0.4);
  ctx.lineTo(0, wid * 0.4);
  ctx.lineTo(len, wid * 0.9);
  ctx.lineTo(len, -wid * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Event horizon: breathing halo, dark disc, bright rim. */
function horizon(ctx, o, glowSprite, r0, color, rimA = 0.85) {
  const { x, y, t, camScale, theme, fade, depth } = o;
  const spin = 1 + 0.05 * Math.sin(t * 1.7);
  const gr = r0 * 2.2 * spin;
  ctx.globalCompositeOperation = theme.flowBlend;
  ctx.globalAlpha = 0.4 * fade * depth;
  ctx.drawImage(glowSprite(color), x - gr, y - gr, gr * 2, gr * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.95 * fade;
  ctx.fillStyle = theme.labelHalo; // the map's "background ink", = #070b14 on dark
  ctx.beginPath();
  ctx.arc(x, y, r0 * 0.6, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = theme.flowBlend;
  ctx.globalAlpha = rimA * fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8 / camScale;
  ctx.beginPath();
  ctx.arc(x, y, r0 * 0.6 * spin, 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

/** Polar jets — port of the lab's `hole-jet`, including its violet ink. The
 *  colour is part of the design, not a theme accent: the beams read as ionised
 *  plasma, and the cyan accent made them look like the classic hole. */
function jets(ctx, o, glowSprite) {
  const { x, y, r, t, fade, depth, theme } = o;
  const S = r / 20; // lab units → map units
  const COLOR = "#a99cff";
  const s = beamSpin(t);
  const fl = beamFlick(t) * fade * depth;
  lobe(ctx, x, y, s, 40 * S, 9 * S, COLOR, fl, theme.flowBlend);
  lobe(ctx, x, y, s + Math.PI, 40 * S, 9 * S, COLOR, fl, theme.flowBlend);
  horizon(ctx, o, glowSprite, 14 * S, COLOR);
}

/** key → { name, draw }. The select is built from this, so adding a core is
 *  one entry here and nothing else. */
export const CORES = {
  classic: { name: "Schwarzes Loch", draw: classic },
  jets: { name: "Polar-Jets", draw: jets },
};

export const CORE_KEY = "bastra-vault-map-mindspace-core";
export const DEFAULT_CORE = "classic";

export const coreOf = (key) => CORES[key] ?? CORES[DEFAULT_CORE];
