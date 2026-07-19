/** Orbit decor (#216/#217) — the universe's backdrop, split out of
 *  orbit-view.js: starfield (shell + drifters, twinkle), the shooting star,
 *  galaxy glows + nebulae + labels, solar-system rings, and the galactic
 *  mode's orbit guides + black-hole core. Pure drawing: all view state
 *  arrives through the env getters, geometry helpers are passed in from the
 *  view (they close over its camera state). */

import { clusterColor, glowSprite } from "../graph-data.js";
import { rnd } from "./orbit-galaxy.js";

const SHOOTING_EVERY = 24000;

/** @param {object} env  getters + geometry helpers from createOrbitView */
export function createOrbitDecor(env) {
  const {
    project, trigNow, inPlane, add, scale3, norm,
    depthScale, depthFade, frontFade, viewRect, inView,
    getSatLight, getHues,
  } = env;

  return function decor(ctx, camera, theme, now) {
    const universe = env.getUniverse();
    if (!universe) return;
    const stars = env.getStars();
    const hole = env.getHole();
    const orbitRings = env.getOrbitRings();
    const mode = env.getMode();
    const enterAt = env.getEnterAt();
    const R = env.getR();

    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const trig = trigNow();
    const tSec = now / 1000;
    const [sat, light] = getSatLight();
    const hues = getHues();
    // the whole backdrop eases in with the entry flight — no frame-1 pop
    const fadeIn = Math.min((now - enterAt) / 950, 1);
    const view = viewRect(120 / camera.scale);

    // starfield — culled, twinkling brights, screen-constant sizes
    ctx.fillStyle = theme.label;
    for (const s of stars) {
      const pr = project(s, trig, cx, cy);
      if (!inView(view, pr.x, pr.y)) continue;
      const r = s.size / camera.scale;
      const twinkle = s.bright ? 0.75 + 0.25 * Math.sin(tSec * 2.1 + s.tw) : 1;
      ctx.globalAlpha = s.alpha * twinkle * (pr.d > 0 ? 0.55 : 1) * frontFade(pr.d) * fadeIn;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, s.bright ? r * 1.8 : r, 0, Math.PI * 2);
      ctx.fill();
      if (s.bright) {
        ctx.globalAlpha *= 0.4;
        ctx.lineWidth = 0.6 / camera.scale;
        ctx.strokeStyle = theme.label;
        const g = 5 / camera.scale;
        ctx.beginPath();
        ctx.moveTo(pr.x - g, pr.y);
        ctx.lineTo(pr.x + g, pr.y);
        ctx.moveTo(pr.x, pr.y - g);
        ctx.lineTo(pr.x, pr.y + g);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // one shooting star every ~24 s
    {
      const epoch = Math.floor(now / SHOOTING_EVERY);
      const t = (now % SHOOTING_EVERY) / SHOOTING_EVERY;
      if (t < 0.055) {
        const p = t / 0.055;
        const s0 = {
          px: (rnd(epoch, 121) - 0.5) * R * 2.6,
          py: (rnd(epoch, 127) - 0.5) * R * 1.4,
          pz: (rnd(epoch, 131) - 0.5) * R * 2.2,
        };
        const dir = norm({ px: rnd(epoch, 137) - 0.5, py: rnd(epoch, 139) - 0.5, pz: rnd(epoch, 149) - 0.5 });
        const head = add(s0, scale3(dir, p * R * 0.9));
        const tail = add(s0, scale3(dir, Math.max(p - 0.12, 0) * R * 0.9));
        const a = project(head, trig, cx, cy);
        const b = project(tail, trig, cx, cy);
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, theme.label);
        grad.addColorStop(1, "transparent");
        ctx.globalAlpha = 0.5 * Math.sin(p * Math.PI) * fadeIn;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.1 / camera.scale;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // galactic mode: faint orbit guides + the black hole core. The "hole"
    // is punched with the label-halo ink (≈ background in both themes), the
    // event horizon rings carry the accent — dark core, bright rim.
    if (mode === "galaxy" && hole) {
      const origin = { px: 0, py: 0, pz: 0 };
      ctx.strokeStyle = theme.bandBorder;
      ctx.globalAlpha = 0.09 * fadeIn;
      ctx.lineWidth = 0.8 / camera.scale;
      for (const orbitR of orbitRings) {
        ctx.beginPath();
        for (let k = 0; k < 33; k++) {
          const a = (k / 32) * Math.PI * 2;
          const pr = project({ px: Math.cos(a) * orbitR, py: 0, pz: Math.sin(a) * orbitR }, trig, cx, cy);
          if (k === 0) ctx.moveTo(pr.x, pr.y);
          else ctx.lineTo(pr.x, pr.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      const pr = project(origin, trig, cx, cy);
      const r0 = Math.max(hole.r * depthScale(pr), 24 / camera.scale);
      const spinPulse = 1 + 0.05 * Math.sin(tSec * 1.7);
      ctx.globalCompositeOperation = theme.flowBlend;
      ctx.globalAlpha = 0.5 * fadeIn * depthFade(pr.d);
      const gr = r0 * 2.4 * spinPulse;
      ctx.drawImage(glowSprite(theme.accent, theme.label), pr.x - gr, pr.y - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, 0.94 * fadeIn);
      ctx.fillStyle = theme.labelHalo;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, r0 * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85 * fadeIn;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.6 / camera.scale;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, r0 * 0.6 * spinPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.22 * fadeIn;
      ctx.lineWidth = 0.8 / camera.scale;
      for (const m of [0.95, 1.35]) {
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r0 * m, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // galaxies back-to-front, all glow via sprites in ONE additive batch
    // ("lighter" on dark theme sums overlapping light like real light;
    // the light theme's flowBlend stays source-over)
    ctx.globalCompositeOperation = theme.flowBlend;
    const sorted = [...universe.galaxies].sort((a, b) => b.d - a.d);
    for (const g of sorted) {
      if (!inView(view, g.sx, g.sy)) continue;
      const color = clusterColor(hues, g.key, sat, light);
      const depthAlpha = depthFade(g.d) * fadeIn;
      if (depthAlpha <= 0.02) continue;

      if (g.nebula) {
        for (const b of g.nebula) {
          const wob = b.phase + tSec * b.drift;
          const wx = b.ox + Math.cos(wob) * g.r * 0.22;
          const wy = b.oy + Math.sin(wob * 0.8) * g.r * 0.22;
          const wp = inPlane(g.center, g.basis, wx, wy, 0);
          const pr = project(wp, trig, cx, cy);
          const br = b.r * depthScale(pr) * (0.9 + 0.12 * Math.sin(wob * 0.6));
          ctx.globalAlpha = 0.05 * depthAlpha * (0.8 + 0.2 * Math.sin(wob));
          ctx.drawImage(glowSprite(color), pr.x - br, pr.y - br, br * 2, br * 2);
        }
      }

      const rr = g.r * g.scale * (g.dwarf ? 1.6 : 2.3);
      ctx.globalAlpha = (g.dwarf ? 0.045 : 0.055) * depthAlpha;
      ctx.drawImage(glowSprite(color), g.sx - rr, g.sy - rr, rr * 2, rr * 2);

      const breathe = 1 + 0.07 * Math.sin(tSec * 0.7 + g.phase);
      const coreR = Math.max(g.r * g.scale * 0.3, 8) * breathe;
      ctx.globalAlpha = (g.dwarf ? 0.09 : 0.18) * depthAlpha * (0.88 + 0.12 * Math.sin(tSec * 0.9 + g.phase));
      ctx.drawImage(glowSprite(color, theme.label), g.sx - coreR, g.sy - coreR, coreR * 2, coreR * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // galaxy names — screen-px floors, outside the additive batch
    for (const g of sorted) {
      if (!inView(view, g.sx, g.sy)) continue;
      const depthAlpha = depthFade(g.d) * fadeIn;
      if (depthAlpha <= 0.05) continue;
      const color = clusterColor(hues, g.key, sat, light);
      ctx.globalAlpha = 0.7 * depthAlpha;
      const fontPx = Math.max((g.dwarf ? 9.5 : 11) * g.scale, 10 / camera.scale);
      ctx.font = `700 ${fontPx}px "Avenir Next", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3 / camera.scale;
      ctx.lineJoin = "round";
      ctx.strokeStyle = theme.labelHalo;
      const ly = g.sy - g.r * g.scale * 1.4 - 6 / camera.scale;
      ctx.strokeText(g.key.toUpperCase(), g.sx, ly);
      ctx.fillStyle = color;
      ctx.fillText(g.key.toUpperCase(), g.sx, ly);
      ctx.globalAlpha = 1;
    }

    // solar systems: culled orbit rings (17 pts) + pulsing sun glow sprites
    ctx.strokeStyle = theme.bandBorder;
    for (const s of [...universe.systems].sort((a, b) => b.d - a.d)) {
      if (!s.sunWorld || !inView(view, s.sx, s.sy)) continue;
      const depthAlpha = depthFade(s.d) * fadeIn;
      if (depthAlpha <= 0.02) continue;
      ctx.globalAlpha = 0.16 * depthAlpha;
      ctx.lineWidth = 0.7 / camera.scale;
      for (const orbitR of s.rings) {
        ctx.beginPath();
        for (let k = 0; k < 17; k++) {
          const a = (k / 16) * Math.PI * 2;
          const wp = inPlane(s.sunWorld, s.basis, Math.cos(a) * orbitR, Math.sin(a) * orbitR);
          const pr = project(wp, trig, cx, cy);
          if (k === 0) ctx.moveTo(pr.x, pr.y);
          else ctx.lineTo(pr.x, pr.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      const glowR = 13 * s.scale * (1 + 0.14 * Math.sin(tSec * 1.4 + s.pulse));
      ctx.globalAlpha = 0.3 * depthAlpha * (0.85 + 0.15 * Math.sin(tSec * 1.1 + s.pulse));
      ctx.globalCompositeOperation = theme.flowBlend;
      ctx.drawImage(glowSprite(theme.label), s.sx - glowR, s.sy - glowR, glowR * 2, glowR * 2);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    };
}
