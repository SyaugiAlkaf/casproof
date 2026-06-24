"use client";

import { useEffect, useRef } from "react";

const MINT = "#34d399";
const MINT_SOFT = "#5eead4";
const RED = "#f87171";
const RED_SOFT = "#fb7185";

const HEX = "0123456789abcdef";
const SAMPLE_RUNS = ["5e9ab2", "a8f1c0", "7c3e9f", "d41ea8", "3fa6b1", "9b0c47"];
const POISON_RUN = "b2b4d7";

const CELL = 14;
const FONT_PX = 13;
const POISON_RATE = 0.2;
const SPEED_MIN = 0.55;
const SPEED_MAX = 1.05;
const FRAME_MS = 1000 / 40;

type Packet = {
  lane: number;
  x: number;
  speed: number;
  chars: string[];
  poison: boolean;
  state: "fly" | "deflect" | "pass";
  flash: number;
  fade: number;
};

function randHexRun(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[(Math.random() * 16) | 0];
  return s;
}

function makePacket(lane: number, gateX: number): Packet {
  const poison = Math.random() < POISON_RATE;
  const base = poison ? POISON_RUN : SAMPLE_RUNS[(Math.random() * SAMPLE_RUNS.length) | 0];
  const tail = randHexRun(2 + ((Math.random() * 3) | 0));
  const chars = (base + tail).slice(0, 6 + ((Math.random() * 3) | 0)).split("");
  return {
    lane,
    x: -chars.length * CELL - Math.random() * gateX * 0.8,
    speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
    chars,
    poison,
    state: "fly",
    flash: 0,
    fade: 1
  };
}

export default function FirewallHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let gateX = 0;
    let laneCount = 0;
    let laneTop = 0;
    let packets: Packet[] = [];
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;

    const fontFor = (px: number) =>
      `${px}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      gateX = Math.round(width * 0.62);
      laneCount = Math.max(5, Math.min(14, Math.floor((height - 64) / (CELL * 1.6))));
      const laneSpan = laneCount * CELL * 1.6;
      laneTop = (height - laneSpan) / 2 + CELL * 0.8;
      seed();
    };

    const laneY = (lane: number) => laneTop + lane * CELL * 1.6;

    const seed = () => {
      packets = [];
      const perLane = reduce ? 1 : 2;
      for (let lane = 0; lane < laneCount; lane++) {
        for (let k = 0; k < perLane; k++) {
          const p = makePacket(lane, gateX);
          if (reduce) {
            // Static representative frame: spread packets across the field, one poisoned at the gate.
            const poisonLane = Math.floor(laneCount / 2);
            if (lane === poisonLane) {
              p.poison = true;
              p.chars = (POISON_RUN + randHexRun(2)).slice(0, 7).split("");
              p.x = gateX - p.chars.length * CELL - 6;
              p.state = "deflect";
              p.flash = 1;
            } else {
              p.poison = false;
              p.chars = (SAMPLE_RUNS[lane % SAMPLE_RUNS.length] + randHexRun(2)).slice(0, 7).split("");
              p.x = lane % 2 === 0 ? width * 0.3 : gateX + CELL * 2 + (lane % 3) * CELL;
              if (p.x > gateX) p.state = "pass";
            }
          } else {
            p.x -= k * gateX * 0.55;
          }
          packets.push(p);
        }
      }
    };

    const drawGate = () => {
      const top = laneY(0) - CELL;
      const bottom = laneY(laneCount - 1) + CELL;
      const h = bottom - top;
      const barW = 7;

      const glow = ctx.createLinearGradient(gateX - 14, 0, gateX + 14, 0);
      glow.addColorStop(0, "rgba(52,211,153,0)");
      glow.addColorStop(0.5, "rgba(52,211,153,0.16)");
      glow.addColorStop(1, "rgba(52,211,153,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(gateX - 16, top - 6, 32, h + 12);

      ctx.font = fontFor(FONT_PX + 1);
      const rows = Math.max(3, Math.floor(h / (CELL * 1.05)));
      for (let r = 0; r < rows; r++) {
        const y = top + 6 + (r / (rows - 1)) * (h - 12);
        ctx.fillStyle = "rgba(94,234,212,0.92)";
        ctx.fillText("║", gateX - barW, y);
        ctx.fillStyle = "rgba(52,211,153,0.55)";
        ctx.fillText("▓", gateX, y);
        ctx.fillStyle = "rgba(94,234,212,0.92)";
        ctx.fillText("║", gateX + barW, y);
      }

      ctx.font = `600 9px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = "rgba(148,163,184,0.85)";
      ctx.save();
      ctx.translate(gateX + barW + 14, (top + bottom) / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("CASPER VM", 0, 0);
      ctx.restore();
      ctx.textAlign = "left";
    };

    const drawLabels = () => {
      const payX = gateX + 34;
      const payY = laneY(0) - CELL * 1.5 < laneTop ? laneTop - 2 : laneY(0) - CELL;

      ctx.font = `600 11px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = "rgba(52,211,153,0.95)";
      ctx.shadowColor = "rgba(52,211,153,0.5)";
      ctx.shadowBlur = 8;
      ctx.fillText("PAY ✓ · quorum 2/2", payX, Math.max(payY, 14));
      ctx.shadowBlur = 0;

      const revX = gateX - 150;
      ctx.fillStyle = "rgba(248,113,113,0.92)";
      ctx.fillText("REVERT ✗", Math.max(revX, 12), height - 14);
    };

    const drawPacket = (p: Packet) => {
      const y = laneY(p.lane);
      ctx.font = fontFor(FONT_PX);
      const color = p.poison ? RED : MINT;
      const soft = p.poison ? RED_SOFT : MINT_SOFT;

      for (let i = 0; i < p.chars.length; i++) {
        const cx = p.x + i * CELL;
        if (cx < -CELL || cx > width + CELL) continue;
        const head = i === p.chars.length - 1;
        const trail = (p.chars.length - 1 - i) / p.chars.length;
        const alpha = p.fade * (0.35 + 0.65 * (1 - trail));
        let ch = p.chars[i];
        if (!reduce && Math.random() < 0.012) ch = HEX[(Math.random() * 16) | 0];
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = head ? soft : color;
        if (head) {
          ctx.shadowColor = p.poison ? "rgba(248,113,113,0.55)" : "rgba(52,211,153,0.5)";
          ctx.shadowBlur = 6;
        }
        ctx.fillText(ch, cx, y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      if (p.flash > 0) {
        ctx.globalAlpha = p.flash;
        ctx.fillStyle = p.poison ? "rgba(248,113,113,0.9)" : "rgba(94,234,212,0.9)";
        ctx.font = `700 11px "JetBrains Mono", ui-monospace, monospace`;
        const tag = p.poison ? "✗" : "✓";
        const tx = p.poison ? gateX - 16 : gateX + 16;
        ctx.fillText(tag, tx, y);
        ctx.globalAlpha = 1;
      }
    };

    const renderStatic = () => {
      ctx.clearRect(0, 0, width, height);
      drawGate();
      for (const p of packets) drawPacket(p);
      drawLabels();
    };

    const step = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(2.4, (now - last) / FRAME_MS);
      last = now;

      ctx.clearRect(0, 0, width, height);
      drawGate();

      const gateHit = gateX - CELL;
      for (const p of packets) {
        const headX = p.x + p.chars.length * CELL;

        if (p.state === "fly") {
          p.x += p.speed * dt;
          if (headX >= gateHit) {
            if (p.poison) {
              p.state = "deflect";
              p.speed = -(p.speed * 1.5 + 0.4);
              p.flash = 1;
            } else {
              p.state = "pass";
              p.flash = 1;
            }
          }
        } else if (p.state === "pass") {
          p.x += p.speed * dt;
        } else {
          p.x += p.speed * dt;
          p.fade -= 0.012 * dt;
        }

        if (p.flash > 0) p.flash = Math.max(0, p.flash - 0.04 * dt);

        drawPacket(p);

        const gone =
          p.x > width + CELL * 2 ||
          p.x + p.chars.length * CELL < -CELL * 2 ||
          p.fade <= 0;
        if (gone) {
          const fresh = makePacket(p.lane, gateX);
          Object.assign(p, fresh);
        }
      }

      drawLabels();
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

    resize();
    if (reduce) {
      renderStatic();
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) renderStatic();
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
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block h-full w-full"
    />
  );
}
