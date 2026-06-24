"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "·····::..--==+xo0179acdef#%";
const HEX = "0123456789abcdef";
const FONT_PX = 13;
const CELL_W = FONT_PX * 0.92;
const CELL_H = FONT_PX * 1.7;
const FRAME_MS = 1000 / 12;
const MAX_COLS = 120;
const MAX_ROWS = 70;
const SWAP_PER_FRAME = 0.014;
const BASE_ALPHA = 0.06;
const TWINKLE_ALPHA = 0.06;

function pickGlyph(): string {
  if (Math.random() < 0.16) return HEX[(Math.random() * HEX.length) | 0];
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

export default function AsciiField() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMounted(true), { timeout: 600 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setMounted(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  if (!mounted) {
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(120%_80%_at_50%_30%,rgba(45,212,191,0.05)_0%,transparent_70%)]"
      />
    );
  }

  return <FieldCanvas />;
}

function FieldCanvas() {
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
    let stepX = CELL_W;
    let stepY = CELL_H;
    let glyphs = new Uint8Array(0);
    let phase = new Float32Array(0);
    let bright = new Uint8Array(0);

    let raf = 0;
    let last = 0;
    let running = false;
    let t0 = performance.now();

    const fontFor = (px: number) => `${px}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;

    const seed = () => {
      glyphs = new Uint8Array(cols * rows);
      phase = new Float32Array(cols * rows);
      bright = new Uint8Array(cols * rows);
      const all = GLYPHS + HEX;
      for (let i = 0; i < glyphs.length; i++) {
        const g = pickGlyph();
        glyphs[i] = all.indexOf(g);
        phase[i] = Math.random() * Math.PI * 2;
        bright[i] = Math.random() < 0.05 ? 1 : 0;
      }
    };

    const charAt = (code: number) => (GLYPHS + HEX)[code] ?? "·";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      cols = Math.min(MAX_COLS, Math.ceil(width / CELL_W) + 1);
      rows = Math.min(MAX_ROWS, Math.ceil(height / CELL_H) + 1);
      stepX = width / cols;
      stepY = height / rows;
      seed();
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = fontFor(FONT_PX);
      const t = (now - t0) / 1000;

      for (let r = 0; r < rows; r++) {
        const y = r * stepY + stepY / 2;
        for (let c = 0; c < cols; c++) {
          const cell = r * cols + c;
          const tw = 0.5 + 0.5 * Math.sin(t * 0.7 + phase[cell]);
          const isBright = bright[cell] === 1;
          const a = BASE_ALPHA + tw * TWINKLE_ALPHA + (isBright ? 0.14 : 0);
          const x = c * stepX + stepX / 2;
          ctx.fillStyle = isBright
            ? `rgba(94,234,212,${a.toFixed(3)})`
            : `rgba(45,212,191,${a.toFixed(3)})`;
          ctx.fillText(charAt(glyphs[cell]), x, y);
        }
      }
    };

    const mutate = () => {
      const all = GLYPHS + HEX;
      const swaps = (glyphs.length * SWAP_PER_FRAME) | 0;
      for (let i = 0; i < swaps; i++) {
        const idx = (Math.random() * glyphs.length) | 0;
        glyphs[idx] = all.indexOf(pickGlyph());
        if (Math.random() < 0.08) bright[idx] = bright[idx] ? 0 : 1;
      }
    };

    const step = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      last = now;
      mutate();
      draw(now);
    };

    const start = () => {
      if (reduce || running || document.hidden) return;
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

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        if (reduce) draw(performance.now());
      }, 150);
    };

    resize();

    if (reduce) {
      draw(performance.now());
    } else {
      start();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("resize", onResize);
    }

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
