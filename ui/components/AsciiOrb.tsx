"use client";

import { useEffect, useRef } from "react";

const RAMP = " .:-=+*#%@";
const FONT_PX = 12;
const CELL_W = FONT_PX * 0.62;
const CELL_H = FONT_PX * 1.0;
const FRAME_MS = 1000 / 35;
const TARGET_COLS = 78;

const SPHERE_LAT = 46;
const SPHERE_LON = 90;
const RING_SEG = 220;
const RING_TUBE = 16;
const RING_R = 1.46;
const RING_TUBE_R = 0.13;

const LIGHT = norm(0.55, 0.62, 0.58);

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

type Vec3 = [number, number, number];

function buildSphere(): { p: Vec3; n: Vec3 }[] {
  const out: { p: Vec3; n: Vec3 }[] = [];
  for (let i = 0; i <= SPHERE_LAT; i++) {
    const theta = (i / SPHERE_LAT) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j < SPHERE_LON; j++) {
      const phi = (j / SPHERE_LON) * 2 * Math.PI;
      const x = st * Math.cos(phi);
      const y = ct;
      const z = st * Math.sin(phi);
      out.push({ p: [x, y, z], n: [x, y, z] });
    }
  }
  return out;
}

function buildRing(): { p: Vec3; n: Vec3 }[] {
  const out: { p: Vec3; n: Vec3 }[] = [];
  for (let i = 0; i < RING_SEG; i++) {
    const u = (i / RING_SEG) * 2 * Math.PI;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let k = 0; k < RING_TUBE; k++) {
      const v = (k / RING_TUBE) * 2 * Math.PI;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const x = (RING_R + RING_TUBE_R * cv) * cu;
      const y = RING_TUBE_R * sv;
      const z = (RING_R + RING_TUBE_R * cv) * su;
      const nx = cv * cu;
      const ny = sv;
      const nz = cv * su;
      out.push({ p: [x, y, z], n: norm(nx, ny, nz) });
    }
  }
  return out;
}

const SPHERE = buildSphere();
const RING = buildRing();

export default function AsciiOrb() {
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
    let kindBuf = new Uint8Array(0);

    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;

    let rotX = -0.45;
    let rotY = 0.6;
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

      cols = Math.max(28, Math.min(TARGET_COLS, Math.floor(width / CELL_W)));
      rows = Math.max(16, Math.floor(height / CELL_H));
      cx = cols / 2;
      cy = rows / 2;
      scale = Math.min(cols, rows * 2.0) * 0.3;

      lumBuf = new Float32Array(cols * rows);
      depthBuf = new Float32Array(cols * rows);
      kindBuf = new Uint8Array(cols * rows);
    };

    const project = () => {
      lumBuf.fill(0);
      depthBuf.fill(-Infinity);
      kindBuf.fill(0);

      const sX = Math.sin(rotX);
      const cX = Math.cos(rotX);
      const sY = Math.sin(rotY);
      const cY = Math.cos(rotY);

      const splat = (pts: { p: Vec3; n: Vec3 }[], kind: number, ambient: number) => {
        for (let idx = 0; idx < pts.length; idx++) {
          const px = pts[idx].p[0];
          const py = pts[idx].p[1];
          const pz = pts[idx].p[2];
          const nx0 = pts[idx].n[0];
          const ny0 = pts[idx].n[1];
          const nz0 = pts[idx].n[2];

          const y1 = py * cX - pz * sX;
          const z1 = py * sX + pz * cX;
          const x2 = px * cY + z1 * sY;
          const z2 = -px * sY + z1 * cY;

          const ny1 = ny0 * cX - nz0 * sX;
          const nz1 = ny0 * sX + nz0 * cX;
          const nx2 = nx0 * cY + nz1 * sY;
          const nz2 = -nx0 * sY + nz1 * cY;

          const col = Math.round(cx + x2 * scale);
          const row = Math.round(cy - y1 * (scale * 0.5));
          if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

          const cell = row * cols + col;
          if (z2 <= depthBuf[cell]) continue;

          let l = nx2 * LIGHT[0] + ny1 * LIGHT[1] + nz2 * LIGHT[2];
          l = ambient + Math.max(0, l) * (1 - ambient);
          const rim = 1 - Math.min(1, Math.abs(nz2));
          l = Math.min(1, l + rim * 0.18);

          depthBuf[cell] = z2;
          lumBuf[cell] = l;
          kindBuf[cell] = kind;
        }
      };

      splat(RING, 2, 0.16);
      splat(SPHERE, 1, 0.08);
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
          const kind = kindBuf[cell];
          if (kind === 0) continue;
          const l = lumBuf[cell];
          if (l <= 0.001) continue;

          const ri = Math.min(rampMax, Math.max(0, Math.round(l * rampMax)));
          const ch = RAMP[ri];
          if (ch === " ") continue;

          const x = ox + c * CELL_W;
          const y = oy + r * CELL_H;

          let color: string;
          let glow = 0;
          if (kind === 2) {
            color = l > 0.7 ? "#5eead4" : l > 0.4 ? "#34d399" : "#0f766e";
            glow = l > 0.78 ? 8 : 0;
          } else if (l > 0.82) {
            color = "#eafffb";
            glow = 9;
          } else if (l > 0.6) {
            color = "#5eead4";
            glow = 4;
          } else if (l > 0.34) {
            color = "#34d399";
          } else if (l > 0.16) {
            color = "#2f7d6b";
          } else {
            color = "#27314a";
          }

          if (glow > 0) {
            ctx.shadowColor = kind === 2 ? "rgba(94,234,212,0.55)" : "rgba(52,211,153,0.6)";
            ctx.shadowBlur = glow;
          }
          ctx.fillStyle = color;
          ctx.fillText(ch, x, y);
          if (glow > 0) ctx.shadowBlur = 0;
        }
      }
    };

    const renderOnce = () => {
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

      rotY += (0.0125 + mx * 0.02) * dt;
      rotX = -0.45 + Math.sin(t * 0.35) * 0.12 + my * 0.5;

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
      { threshold: 0.05 }
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
