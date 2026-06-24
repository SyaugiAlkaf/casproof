"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "·····::..--==+xo0179acdef#%";
const HEX = "0123456789abcdef";
const FONT_PX = 13;
const CELL_W = FONT_PX * 0.92;
const CELL_H = FONT_PX * 1.7;
const MAX_COLS = 120;
const MAX_ROWS = 70;

const ALPHA_TIERS = [0.05, 0.08, 0.11, 0.2];
const TIER_N = ALPHA_TIERS.length;
const DIM_COLOR = ALPHA_TIERS.map((a) => `rgba(45,212,191,${a})`);
const BRIGHT_COLOR = `rgba(94,234,212,0.22)`;

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

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;

    const all = GLYPHS + HEX;
    const fontFor = (px: number) => `${px}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;

    const render = () => {
      const dpr = 1;
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      cols = Math.min(MAX_COLS, Math.ceil(width / CELL_W) + 1);
      rows = Math.min(MAX_ROWS, Math.ceil(height / CELL_H) + 1);
      const stepX = width / cols;
      const stepY = height / rows;

      ctx.clearRect(0, 0, width, height);
      ctx.font = fontFor(FONT_PX);

      const dim: string[][] = Array.from({ length: TIER_N }, () => []);
      const brightCells: string[] = [];
      for (let r = 0; r < rows; r++) {
        const y = r * stepY + stepY / 2;
        for (let c = 0; c < cols; c++) {
          const g = all[(Math.random() * all.length) | 0];
          if (g === "·" && Math.random() < 0.45) continue;
          const x = c * stepX + stepX / 2;
          if (Math.random() < 0.04) {
            brightCells.push(g, `${x}`, `${y}`);
          } else {
            const tier = (Math.random() * TIER_N) | 0;
            dim[tier].push(g, `${x}`, `${y}`);
          }
        }
      }

      for (let t = 0; t < TIER_N; t++) {
        const b = dim[t];
        if (b.length === 0) continue;
        ctx.fillStyle = DIM_COLOR[t];
        for (let k = 0; k < b.length; k += 3) {
          ctx.fillText(b[k], +b[k + 1], +b[k + 2]);
        }
      }
      if (brightCells.length > 0) {
        ctx.fillStyle = BRIGHT_COLOR;
        for (let k = 0; k < brightCells.length; k += 3) {
          ctx.fillText(brightCells[k], +brightCells[k + 1], +brightCells[k + 2]);
        }
      }
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(render, 200);
    };

    render();
    window.addEventListener("resize", onResize);

    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="field-breathe pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
