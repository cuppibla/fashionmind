import React, { useRef, useEffect, useCallback } from "react";

interface Props {
  analyserRef: React.RefObject<AnalyserNode | null>;
}

/**
 * Canvas-based audio waveform visualizer. Draws pink bars from AnalyserNode data.
 */
export default function WaveformVisualizer({ analyserRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  const draw = useCallback(() => {
    rafRef.current = requestAnimationFrame(draw);

    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    const barCount = 40;
    const step = Math.floor(dataArray.length / barCount);
    const barW = width / barCount - 2;
    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i * step] / 255; // 0..1 centered at 0.5
      const amplitude = Math.abs(value - 0.5) * 2; // 0..1
      const barH = Math.max(2, amplitude * height * 0.8);

      // Gradient color from pink to transparent
      const alpha = 0.4 + amplitude * 0.6;
      ctx.fillStyle = `rgba(238, 43, 91, ${alpha})`;
      ctx.fillRect(
        i * (barW + 2) + 1,
        centerY - barH / 2,
        barW,
        barH,
      );
    }
  }, [analyserRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-12 rounded-lg"
      style={{ imageRendering: "auto" }}
    />
  );
}
