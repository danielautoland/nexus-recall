/** Pure easing/interpolation helpers — no state, no DOM. */

/** Symmetric ease-in-out cubic, the app's standard flight curve. */
export const easeFly = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Linear interpolation. */
export const lerp = (a, b, f) => a + (b - a) * f;
