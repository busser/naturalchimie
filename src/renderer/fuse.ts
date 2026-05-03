// Continuous lit-fuse animation for the dynamite stick. Emits sparks
// + smoke wisps from the fuse tip while the dynamite is the active
// piece, plus a small orange glow at the tip itself. Particles live
// in screen-space and stay where they were born, so when the stick
// shifts or drops the trail naturally falls behind.
//
// The subsystem owns no game state — the renderer feeds it the
// dynamite's current cell (or null when no fuse should be lit) each
// frame. Emission stops when the cell is null; in-flight particles
// continue drifting and fade out over their remaining lifetimes.
//
// Spec: docs/05-animations.md ("Dynamite explosion" — continuous
// fuse).

import type { SpriteAtlas } from '../assets/sprite-loader';
import { spriteSourcePointToScreen } from '../assets/sprite-renderer';

// Modest density: the fuse is ambient idle decoration, not a focal
// effect. Roughly half a spark and one-tenth of a smoke wisp per
// frame at 60 fps.
const SPARK_RATE_PER_SEC = 32;
const SMOKE_RATE_PER_SEC = 7;

// Sparks shoot upward off the fuse tip with a modest spread.
const SPARK_LIFETIME_MS = 320;
const SPARK_SPEED_MIN_PX_PER_SEC = 35;
const SPARK_SPEED_MAX_PX_PER_SEC = 95;
// 45°..135° measured from horizontal — particles fan upward in a
// roughly cone pointing straight up. Bias to symmetric fan around
// vertical so the mean direction reads as "rising".
const SPARK_ANGLE_MIN_RAD = Math.PI * 0.25;
const SPARK_ANGLE_MAX_RAD = Math.PI * 0.75;
const SPARK_GRAVITY_PX_PER_SEC2 = 70;
const SPARK_BASE_RADIUS_MIN_PX = 1.4;
const SPARK_BASE_RADIUS_MAX_PX = 2.4;
const SPARK_SHRINK_FACTOR = 0.4;

// Smoke wisps drift slowly upward, expanding and fading.
const SMOKE_LIFETIME_MS = 720;
const SMOKE_DRIFT_PX_PER_SEC = 28;
const SMOKE_LATERAL_DRIFT_PX_PER_SEC = 14;
const SMOKE_BASE_RADIUS_MIN_PX = 2.5;
const SMOKE_BASE_RADIUS_MAX_PX = 4.5;
const SMOKE_RADIUS_GROWTH = 1.4;

// Tip glow: a small orange dot pinned to the fuse tip while lit. The
// pulse keeps it from looking dead-static; frequency is intentionally
// off-integer to avoid frame-locking.
const GLOW_CORE_RADIUS_PX = 1.8;
const GLOW_HALO_RADIUS_PX = 5;
const GLOW_PULSE_FREQ_HZ = 4.7;
const GLOW_PULSE_AMPLITUDE = 0.18;

// Cap dt to avoid an emission burst when the tab returns from
// background or the frame timer hiccups.
const MAX_DT_SEC = 0.05;

type Spark = {
  birthMs: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  baseRadiusPx: number;
  hue: 'white' | 'yellow';
};

type Smoke = {
  birthMs: number;
  originX: number;
  originY: number;
  vx: number;
  baseRadiusPx: number;
};

export type FuseParticles = {
  /**
   * Update + draw one frame of fuse animation.
   *
   * `cell` is the dynamite's current visual cell, or null if no fuse
   * should be lit this frame (no active dynamite, or dynamite still
   * off-canvas during spawn-slide phase 1). Live particles continue
   * to drift and fade out even while `cell` is null.
   */
  update(
    now: number,
    cell: { readonly col: number; readonly row: number } | null,
    sprites: SpriteAtlas,
    ctx: CanvasRenderingContext2D,
    cellSize: number,
    canvasHeight: number,
  ): void;
};

export function createFuseParticles(): FuseParticles {
  const sparks: Spark[] = [];
  const smokes: Smoke[] = [];
  let lastNow: number | null = null;
  // Fractional emission accumulators turn an emit-per-second rate
  // into integer particles per frame: a 60 fps frame at 32 sparks/s
  // accumulates 0.53 spark per frame and emits one whenever the
  // running total crosses an integer.
  let sparkAcc = 0;
  let smokeAcc = 0;

  return {
    update(now, cell, sprites, ctx, cellSize, canvasHeight) {
      const dt = lastNow === null ? 0 : Math.min((now - lastNow) / 1000, MAX_DT_SEC);
      lastNow = now;

      const tip = cell !== null ? fuseTipScreen(cell, sprites, cellSize, canvasHeight) : null;
      if (tip !== null) {
        sparkAcc += dt * SPARK_RATE_PER_SEC;
        smokeAcc += dt * SMOKE_RATE_PER_SEC;
        while (sparkAcc >= 1) {
          sparkAcc -= 1;
          sparks.push(seedSpark(now, tip.x, tip.y));
        }
        while (smokeAcc >= 1) {
          smokeAcc -= 1;
          smokes.push(seedSmoke(now, tip.x, tip.y));
        }
      } else {
        // Reset accumulators so a long unlit gap doesn't dump a burst
        // of particles when the next dynamite spawns.
        sparkAcc = 0;
        smokeAcc = 0;
      }

      // Layering: smoke (default blend, darkens against sky) sits
      // behind the glow (additive, hot dot on the sprite) which sits
      // behind the sparks (additive, bright points). Drawing smoke
      // first matches that stack.
      drawSmoke(ctx, smokes, now);
      if (tip !== null) drawGlow(ctx, tip.x, tip.y, now);
      drawSparks(ctx, sparks, now);
    },
  };
}

function fuseTipScreen(
  cell: { readonly col: number; readonly row: number },
  sprites: SpriteAtlas,
  cellSize: number,
  canvasHeight: number,
): { x: number; y: number } | null {
  if (!sprites.dynamite.fuse_tip) return null;
  const cellScreenX = cell.col * cellSize;
  const cellScreenY = canvasHeight - (cell.row + 1) * cellSize;
  return spriteSourcePointToScreen(
    sprites.dynamite,
    sprites.dynamite.fuse_tip,
    cellScreenX,
    cellScreenY,
    cellSize,
  );
}

function seedSpark(now: number, x: number, y: number): Spark {
  const angle = lerp(SPARK_ANGLE_MIN_RAD, SPARK_ANGLE_MAX_RAD, Math.random());
  const speed = lerp(SPARK_SPEED_MIN_PX_PER_SEC, SPARK_SPEED_MAX_PX_PER_SEC, Math.random());
  return {
    birthMs: now,
    originX: x,
    originY: y,
    vx: Math.cos(angle) * speed,
    // Canvas y increases downward; sparks rise → negative vy.
    vy: -Math.sin(angle) * speed,
    baseRadiusPx: lerp(SPARK_BASE_RADIUS_MIN_PX, SPARK_BASE_RADIUS_MAX_PX, Math.random()),
    hue: Math.random() < 0.6 ? 'white' : 'yellow',
  };
}

function seedSmoke(now: number, x: number, y: number): Smoke {
  return {
    birthMs: now,
    originX: x,
    originY: y,
    vx: (Math.random() - 0.5) * 2 * SMOKE_LATERAL_DRIFT_PX_PER_SEC,
    baseRadiusPx: lerp(SMOKE_BASE_RADIUS_MIN_PX, SMOKE_BASE_RADIUS_MAX_PX, Math.random()),
  };
}

function drawSparks(
  ctx: CanvasRenderingContext2D,
  sparks: Spark[],
  now: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  let writeIdx = 0;
  for (const spark of sparks) {
    const ageMs = now - spark.birthMs;
    if (ageMs >= SPARK_LIFETIME_MS) continue;
    const t = ageMs / SPARK_LIFETIME_MS;
    const tSec = ageMs / 1000;
    const x = spark.originX + spark.vx * tSec;
    const y =
      spark.originY +
      spark.vy * tSec +
      0.5 * SPARK_GRAVITY_PX_PER_SEC2 * tSec * tSec;
    const radius = spark.baseRadiusPx * (1 - SPARK_SHRINK_FACTOR * t);
    const alpha = (1 - t) * (1 - t);
    drawSparkPoint(ctx, x, y, radius, alpha, spark.hue);
    sparks[writeIdx++] = spark;
  }
  sparks.length = writeIdx;
  ctx.restore();
}

function drawSparkPoint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  coreRadiusPx: number,
  alpha: number,
  hue: 'white' | 'yellow',
): void {
  const haloR = coreRadiusPx * 2.4;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  const mid = hue === 'white' ? '255, 250, 220' : '255, 220, 120';
  const outer = hue === 'white' ? '255, 230, 170' : '255, 180, 60';
  halo.addColorStop(0, `rgba(255, 255, 245, ${alpha * 0.85})`);
  halo.addColorStop(0.45, `rgba(${mid}, ${alpha * 0.45})`);
  halo.addColorStop(1, `rgba(${outer}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadiusPx);
  core.addColorStop(0, `rgba(255, 255, 245, ${alpha})`);
  core.addColorStop(1, `rgba(${mid}, 0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function drawSmoke(
  ctx: CanvasRenderingContext2D,
  smokes: Smoke[],
  now: number,
): void {
  // Default composite (not 'lighter') so smoke darkens against the
  // sky behind the playfield, like real smoke.
  ctx.save();
  let writeIdx = 0;
  for (const smoke of smokes) {
    const ageMs = now - smoke.birthMs;
    if (ageMs >= SMOKE_LIFETIME_MS) continue;
    const t = ageMs / SMOKE_LIFETIME_MS;
    const tSec = ageMs / 1000;
    const x = smoke.originX + smoke.vx * tSec;
    const y = smoke.originY - SMOKE_DRIFT_PX_PER_SEC * tSec;
    const radius = smoke.baseRadiusPx * (1 + SMOKE_RADIUS_GROWTH * t);
    // Fade in over the first ~25% of life (otherwise wisps pop into
    // existence) and out over the rest, biased so they're brightest
    // around mid-life.
    const fadeIn = Math.min(1, t * 4);
    const fadeOut = 1 - t;
    const alpha = 0.4 * fadeIn * fadeOut * fadeOut;
    if (alpha > 0) {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(120, 110, 102, ${alpha})`);
      grad.addColorStop(0.6, `rgba(95, 85, 78, ${alpha * 0.55})`);
      grad.addColorStop(1, 'rgba(60, 52, 48, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    smokes[writeIdx++] = smoke;
  }
  smokes.length = writeIdx;
  ctx.restore();
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  now: number,
): void {
  const pulse =
    1 +
    GLOW_PULSE_AMPLITUDE *
      Math.sin((now / 1000) * Math.PI * 2 * GLOW_PULSE_FREQ_HZ);
  const coreR = GLOW_CORE_RADIUS_PX * pulse;
  const haloR = GLOW_HALO_RADIUS_PX * pulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, 'rgba(255, 220, 140, 0.65)');
  halo.addColorStop(0.4, 'rgba(255, 160, 60, 0.45)');
  halo.addColorStop(1, 'rgba(255, 110, 30, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, 'rgba(255, 250, 230, 0.95)');
  core.addColorStop(0.6, 'rgba(255, 200, 100, 0.7)');
  core.addColorStop(1, 'rgba(255, 150, 50, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
