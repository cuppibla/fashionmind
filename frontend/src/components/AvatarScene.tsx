import React, { useRef, useEffect, useCallback } from "react";

interface Props {
  analyserRef: React.RefObject<AnalyserNode | null>;
  isSpeaking: boolean;
}

/* ── Google brand palette ─────────────────────────────────── */
const PALETTE = [
  [66, 133, 244],   // Blue
  [234, 67, 53],    // Red
  [251, 188, 4],    // Yellow
  [52, 168, 83],    // Green
] as const;

/**
 * Audio-reactive orb animation.
 * Renders a glowing, morphing sphere that reacts to the AI voice stream
 * via the existing AnalyserNode. No images — pure Canvas 2D.
 */
export default function AvatarScene({ analyserRef, isSpeaking }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const freqData = useRef(new Uint8Array(128));
  const timeRef = useRef(0);
  const lastTime = useRef(0);
  /* Smoothed energy value (0-1) to prevent jarring jumps */
  const smoothEnergy = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* ── Timing ─────────────────────────────────────────── */
    const now = performance.now() / 1000;
    const dt = lastTime.current ? now - lastTime.current : 0.016;
    lastTime.current = now;
    timeRef.current += dt;
    const t = timeRef.current;

    /* ── Resize canvas to container ─────────────────────── */
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* ── Read FFT data ──────────────────────────────────── */
    const analyser = analyserRef.current;
    let energy = 0;
    if (analyser) {
      if (freqData.current.length !== analyser.frequencyBinCount) {
        freqData.current = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(freqData.current);
      const d = freqData.current;
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i];
      energy = sum / (d.length * 255);            // 0..1
    }

    /* Smooth energy to prevent jarring jumps */
    const lerpSpeed = energy > smoothEnergy.current ? 8 : 3;
    smoothEnergy.current += (energy - smoothEnergy.current) * Math.min(1, dt * lerpSpeed);
    const e = smoothEnergy.current;

    /* ── Clear ──────────────────────────────────────────── */
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.22;

    /* ── Outer glow layers ──────────────────────────────── */
    for (let layer = 3; layer >= 0; layer--) {
      const spread = baseR * (1.8 + layer * 0.6 + e * 0.8);
      const alpha = (0.04 - layer * 0.008 + e * 0.03) * (1 + e);
      const [r, g, b] = PALETTE[layer % PALETTE.length];
      const angle = t * 0.3 + layer * (Math.PI / 2);
      const ox = Math.cos(angle) * baseR * 0.15;
      const oy = Math.sin(angle) * baseR * 0.15;
      const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, spread);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    /* ── Main orb body (morphing blob) ──────────────────── */
    const points = 128;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      // Sum of several sine deformations for organic feel
      let deform = 0;
      deform += Math.sin(a * 3 + t * 2.0) * (3 + e * 12);
      deform += Math.sin(a * 5 - t * 1.5) * (2 + e * 8);
      deform += Math.sin(a * 7 + t * 3.0) * (1 + e * 6);
      deform += Math.sin(a * 2 - t * 0.7) * (2 + e * 4);

      // Extra deformation from individual freq bins when speaking
      if (analyser && e > 0.02) {
        const binIdx = Math.floor((i / points) * Math.min(freqData.current.length, 64));
        deform += (freqData.current[binIdx] / 255) * 14 * e;
      }

      const r = baseR + deform;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Gradient fill with rotating Google colors
    const orbGrad = ctx.createLinearGradient(
      cx + Math.cos(t * 0.5) * baseR,
      cy + Math.sin(t * 0.5) * baseR,
      cx + Math.cos(t * 0.5 + Math.PI) * baseR,
      cy + Math.sin(t * 0.5 + Math.PI) * baseR,
    );
    const shift = (t * 0.15) % 1;
    for (let i = 0; i < PALETTE.length; i++) {
      const [r, g, b] = PALETTE[i];
      const stop = ((i / PALETTE.length) + shift) % 1;
      const a = 0.55 + e * 0.35;
      orbGrad.addColorStop(stop, `rgba(${r},${g},${b},${a})`);
    }
    // Close the loop with first color
    const [r0, g0, b0] = PALETTE[0];
    orbGrad.addColorStop(1, `rgba(${r0},${g0},${b0},${0.55 + e * 0.35})`);

    ctx.fillStyle = orbGrad;
    ctx.fill();

    /* ── Inner highlight (glass effect) ─────────────────── */
    const highlightGrad = ctx.createRadialGradient(
      cx - baseR * 0.25,
      cy - baseR * 0.3,
      baseR * 0.05,
      cx,
      cy,
      baseR * 0.9,
    );
    highlightGrad.addColorStop(0, `rgba(255,255,255,${0.18 + e * 0.15})`);
    highlightGrad.addColorStop(0.5, "rgba(255,255,255,0.03)");
    highlightGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlightGrad;
    ctx.fill();

    /* ── Orb edge glow ──────────────────────────────────── */
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const edgeGrad = ctx.createRadialGradient(cx, cy, baseR * 0.6, cx, cy, baseR * (1.1 + e * 0.3));
    edgeGrad.addColorStop(0, "rgba(0,0,0,0)");
    edgeGrad.addColorStop(0.7, "rgba(0,0,0,0)");
    const edgeColor = PALETTE[Math.floor(t * 0.5) % PALETTE.length];
    edgeGrad.addColorStop(1, `rgba(${edgeColor[0]},${edgeColor[1]},${edgeColor[2]},${0.15 + e * 0.25})`);
    ctx.fillStyle = edgeGrad;
    ctx.fill();
    ctx.restore();

    /* ── Floating particles ─────────────────────────────── */
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
      const seed = i * 137.508; // golden angle spread
      const orbitR = baseR * (1.3 + 0.8 * Math.sin(seed));
      const speed = 0.2 + (i % 5) * 0.08;
      const phase = seed;
      const pa = t * speed + phase;
      const px = cx + Math.cos(pa) * orbitR * (1 + e * 0.3);
      const py = cy + Math.sin(pa) * orbitR * (0.6 + 0.4 * Math.sin(t * 0.3 + seed)) * (1 + e * 0.3);
      const pSize = 1 + Math.sin(t * 2 + seed) * 0.8 + e * 1.5;
      const pAlpha = (0.2 + Math.sin(t * 1.5 + seed) * 0.15 + e * 0.3) * 0.7;
      const [pr, pg, pb] = PALETTE[i % PALETTE.length];
      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pr},${pg},${pb},${pAlpha})`;
      ctx.fill();
    }
    ctx.restore();

    /* ── Centre bright core ─────────────────────────────── */
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * (0.5 + e * 0.15));
    coreGrad.addColorStop(0, `rgba(255,255,255,${0.25 + e * 0.3})`);
    coreGrad.addColorStop(0.4, `rgba(200,220,255,${0.08 + e * 0.1})`);
    coreGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * (0.5 + e * 0.15), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    rafRef.current = requestAnimationFrame(draw);
  }, [analyserRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div
      className="w-full h-full flex items-center justify-center overflow-hidden rounded-2xl relative"
      style={{
        background:
          "radial-gradient(ellipse at 50% 40%, #1a2744 0%, #0d1520 70%, #080c12 100%)",
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: "block" }}
      />
    </div>
  );
}
