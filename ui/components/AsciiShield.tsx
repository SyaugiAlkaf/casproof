"use client";

import { useEffect, useRef } from "react";

const RAMP = " .:-=+*#%@";
const FONT_PX = 12;
const CELL_W = FONT_PX * 0.62;
const CELL_H = FONT_PX * 1.0;
const FRAME_MS = 1000 / 35;
const TARGET_COLS = 150;

const GRID_U = 132;
const GRID_V = 168;
const SHIELD_HALF_W = 0.86;
const SHIELD_TOP_Y = 1.16;
const SHIELD_BOT_Y = -1.28;
const SHIELD_CY = (SHIELD_TOP_Y + SHIELD_BOT_Y) / 2;
const SHIELD_HY = (SHIELD_TOP_Y - SHIELD_BOT_Y) / 2;

const LIGHT = norm(0.5, 0.66, 0.56);

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

type Vec3 = [number, number, number];
type Vert = { p: Vec3; n: Vec3 };

function halfWidth(t: number): number {
  if (t <= 0.16) {
    return SHIELD_HALF_W * (0.92 + 0.08 * smoothstep(0, 0.16, t));
  }
  if (t <= 0.46) {
    return SHIELD_HALF_W;
  }
  const k = (t - 0.46) / 0.54;
  return SHIELD_HALF_W * Math.sqrt(Math.max(0, 1 - k * k));
}

function height(nx: number, ny: number, edge: number): number {
  const dome = (1 - nx * nx * 0.82) * (1 - ny * ny * 0.3);
  let z = 0.52 * Math.max(0, dome);

  const rim = smoothstep(0.0, 0.15, edge) * (1 - smoothstep(0.15, 0.32, edge));
  z += 0.28 * rim;

  const kx = nx;
  const ky = ny - 0.16;
  const ringR = Math.hypot(kx, ky * 1.05);
  const ring = (1 - smoothstep(0.18, 0.25, Math.abs(ringR - 0.17))) * 0.5;
  const hole = (1 - smoothstep(0.0, 0.1, ringR)) * 0.6;
  const slot =
    Math.abs(kx) < 0.05 && ky < -0.06 && ky > -0.4
      ? (1 - smoothstep(0.0, 0.05, Math.abs(kx))) * 0.5
      : 0;
  z -= 0.09 * Math.max(hole, slot);
  z += 0.05 * ring;

  return z * smoothstep(0.0, 0.06, edge);
}

function buildShield(): Vert[] {
  const cols = GRID_U + 1;
  const rows = GRID_V + 1;
  const zGrid = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  const px = new Float32Array(cols * rows);
  const py = new Float32Array(cols * rows);

  for (let j = 0; j <= GRID_V; j++) {
    const t = j / GRID_V;
    const y = SHIELD_TOP_Y + t * (SHIELD_BOT_Y - SHIELD_TOP_Y);
    const hw = halfWidth(t);
    for (let i = 0; i <= GRID_U; i++) {
      const u = (i / GRID_U) * 2 - 1;
      const x = u * SHIELD_HALF_W;
      const cell = j * cols + i;
      px[cell] = x;
      py[cell] = y;
      if (hw <= 1e-4 || Math.abs(x) > hw) {
        inside[cell] = 0;
        zGrid[cell] = 0;
        continue;
      }
      const nx = x / SHIELD_HALF_W;
      const ny = (y - SHIELD_CY) / SHIELD_HY;
      const edgeX = 1 - Math.abs(x) / hw;
      const edgeY = Math.min(smoothstep(0, 0.1, t), 1 - smoothstep(0.9, 1, t));
      const edge = Math.min(edgeX, edgeY * 1.5);
      inside[cell] = 1;
      zGrid[cell] = height(nx, ny, edge);
    }
  }

  const out: Vert[] = [];
  const dx = (2 * SHIELD_HALF_W) / GRID_U;
  const dy = (SHIELD_TOP_Y - SHIELD_BOT_Y) / GRID_V;
  for (let j = 0; j <= GRID_V; j++) {
    for (let i = 0; i <= GRID_U; i++) {
      const cell = j * cols + i;
      if (!inside[cell]) continue;
      const il = i > 0 && inside[cell - 1] ? cell - 1 : cell;
      const ir = i < GRID_U && inside[cell + 1] ? cell + 1 : cell;
      const jt = j > 0 && inside[cell - cols] ? cell - cols : cell;
      const jb = j < GRID_V && inside[cell + cols] ? cell + cols : cell;
      const spanX = il === ir ? 1 : il === cell || ir === cell ? 1 : 2;
      const spanY = jt === jb ? 1 : jt === cell || jb === cell ? 1 : 2;
      const dzdx = (zGrid[ir] - zGrid[il]) / (spanX * dx);
      const dzdy = (zGrid[jt] - zGrid[jb]) / (spanY * dy);
      const n = norm(-dzdx, dzdy, 1);
      out.push({ p: [px[cell], py[cell], zGrid[cell]], n });
    }
  }
  return out;
}

const SHIELD = buildShield();

export default function AsciiShield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let scale = 0;
    let cx = 0;
    let cy = 0;

    let lumBuf = new Float32Array(0);
    let depthBuf = new Float32Array(0);
    let onBuf = new Uint8Array(0);

    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;

    let rotX = 0;
    let rotY = 0;
    let mx = 0;
    let my = 0;
    let tmx = 0;
    let tmy = 0;
    let t0 = performance.now();

    const fontFor = (px: number) =>
      `${px}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      cols = Math.max(40, Math.min(TARGET_COLS, Math.floor(width / CELL_W)));
      rows = Math.max(28, Math.floor(height / CELL_H));
      cx = cols / 2;
      cy = rows / 2;
      scale = Math.min(cols / 2.2, rows / 2.7);

      lumBuf = new Float32Array(cols * rows);
      depthBuf = new Float32Array(cols * rows);
      onBuf = new Uint8Array(cols * rows);
    };

    const project = () => {
      lumBuf.fill(0);
      depthBuf.fill(-Infinity);
      onBuf.fill(0);

      const sX = Math.sin(rotX);
      const cX = Math.cos(rotX);
      const sY = Math.sin(rotY);
      const cY = Math.cos(rotY);

      for (let idx = 0; idx < SHIELD.length; idx++) {
        const v = SHIELD[idx];
        const px = v.p[0];
        const py = v.p[1] - SHIELD_CY;
        const pz = v.p[2];
        const nx0 = v.n[0];
        const ny0 = v.n[1];
        const nz0 = v.n[2];

        const y1 = py * cX - pz * sX;
        const z1 = py * sX + pz * cX;
        const x2 = px * cY + z1 * sY;
        const z2 = -px * sY + z1 * cY;

        const ny1 = ny0 * cX - nz0 * sX;
        const nz1 = ny0 * sX + nz0 * cX;
        const nx2 = nx0 * cY + nz1 * sY;
        const nz2 = -nx0 * sY + nz1 * cY;

        const col = Math.round(cx + x2 * scale);
        const row = Math.round(cy - y1 * scale);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

        const cell = row * cols + col;
        if (z2 <= depthBuf[cell]) continue;

        let l = nx2 * LIGHT[0] + ny1 * LIGHT[1] + nz2 * LIGHT[2];
        l = 0.1 + Math.max(0, l) * 0.9;
        const rim = 1 - Math.min(1, Math.abs(nz2));
        l = Math.min(1, l + rim * rim * 0.22);

        depthBuf[cell] = z2;
        lumBuf[cell] = l;
        onBuf[cell] = 1;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const ox = (width - cols * CELL_W) / 2 + CELL_W / 2;
      const oy = (height - rows * CELL_H) / 2 + CELL_H / 2;

      ctx.font = fontFor(FONT_PX);
      const rampMax = RAMP.length - 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = r * cols + c;
          if (!onBuf[cell]) continue;
          const l = lumBuf[cell];
          if (l <= 0.001) continue;

          const ri = Math.min(rampMax, Math.max(0, Math.round(l * rampMax)));
          const ch = RAMP[ri];
          if (ch === " ") continue;

          const x = ox + c * CELL_W;
          const y = oy + r * CELL_H;

          let color: string;
          let glow = 0;
          if (l > 0.84) {
            color = "#eafffb";
            glow = 9;
          } else if (l > 0.62) {
            color = "#5eead4";
            glow = 5;
          } else if (l > 0.4) {
            color = "#34d399";
          } else if (l > 0.2) {
            color = "#2f7d6b";
          } else {
            color = "#243046";
          }

          if (glow > 0) {
            ctx.shadowColor = "rgba(52,211,153,0.55)";
            ctx.shadowBlur = glow;
          }
          ctx.fillStyle = color;
          ctx.fillText(ch, x, y);
          if (glow > 0) ctx.shadowBlur = 0;
        }
      }
    };

    const renderOnce = () => {
      rotX = -0.12;
      rotY = -0.2;
      project();
      draw();
    };

    const step = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(2.5, (now - last) / FRAME_MS);
      last = now;

      const t = (now - t0) / 1000;

      mx += (tmx - mx) * Math.min(1, 0.06 * dt);
      my += (tmy - my) * Math.min(1, 0.06 * dt);

      rotY = Math.sin(t * 0.28) * 0.22 + mx * 0.5;
      rotX = -0.1 + Math.sin(t * 0.34) * 0.08 + my * 0.32;

      project();
      draw();
    };

    const start = () => {
      if (reduce || running || !visible) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      tmx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      tmy = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    };

    const onPointerLeave = () => {
      tmx = 0;
      tmy = 0;
    };

    resize();

    if (reduce) {
      renderOnce();
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) renderOnce();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start();
        else stop();
      },
      { threshold: 0.02 }
    );

    if (reduce) {
      visible = true;
    } else {
      io.observe(canvas);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      canvas.addEventListener("pointerleave", onPointerLeave);
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />;
}
