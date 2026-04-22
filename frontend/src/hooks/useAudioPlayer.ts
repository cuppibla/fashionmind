import { useRef, useState, useCallback } from "react";

export function useAudioPlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const pendingChunksRef = useRef<Array<{ data: string; mimeType?: string }>>([]);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);

  const normalizeBase64 = useCallback((value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    if (!padding) {
      return normalized;
    }
    return normalized.padEnd(normalized.length + (4 - padding), "=");
  }, []);

  const getSampleRate = useCallback((mimeType?: string) => {
    const match = mimeType?.match(/rate=(\d+)/i);
    return match ? Number(match[1]) : 24000;
  }, []);

  const getAudioContext = useCallback(async () => {
    const AudioContextCtor =
      window.AudioContext ||
      // Support Safari, which still exposes the prefixed constructor.
      ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
        null);

    if (!AudioContextCtor) {
      throw new Error("AudioContext is not supported in this browser");
    }

    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContextCtor({ sampleRate: 24000 });
      // Create AnalyserNode for lip-sync — passthrough to destination
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      analyser.connect(audioCtxRef.current.destination);
      analyserRef.current = analyser;
      console.log("[audio] Created AudioContext + AnalyserNode, state:", audioCtxRef.current.state);
    }

    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
      console.log("[audio] Resumed AudioContext, state:", audioCtxRef.current.state);
    }

    return audioCtxRef.current;
  }, []);

  const playChunk = useCallback((ctx: AudioContext, base64PcmData: string, mimeType?: string) => {
    if (ctx.state === "closed") {
      console.warn("[audio] playChunk skipped — AudioContext is closed");
      return;
    }

    const raw = atob(normalizeBase64(base64PcmData));
    // Ensure even byte count for Int16Array alignment
    const byteLen = raw.length - (raw.length % 2);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) bytes[i] = raw.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, getSampleRate(mimeType));
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserRef.current ?? ctx.destination);
    activeSourcesRef.current.add(source);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) {
      nextPlayTimeRef.current = now;
    }
    console.log(`[audio] Playing chunk: ${float32.length} samples @${getSampleRate(mimeType)}Hz, ctx.state=${ctx.state}, schedAt=${nextPlayTimeRef.current.toFixed(3)}`);
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;

    setIsPlaying(true);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (nextPlayTimeRef.current <= ctx.currentTime) setIsPlaying(false);
    };
  }, [getSampleRate, normalizeBase64]);

  const stopPlayback = useCallback(() => {
    pendingChunksRef.current = [];
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (error) {
        console.debug("[audio] Ignored source.stop() error:", error);
      }
      source.disconnect();
    });
    activeSourcesRef.current.clear();

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") {
      nextPlayTimeRef.current = ctx.currentTime;
    } else {
      nextPlayTimeRef.current = 0;
    }

    setIsPlaying(false);
  }, []);

  // Call during a user gesture (e.g. mic button click) to unlock audio
  const warmUp = useCallback(async () => {
    const ctx = await getAudioContext();
    nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, ctx.currentTime);

    const unlockBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const unlockSource = ctx.createBufferSource();
    unlockSource.buffer = unlockBuffer;
    unlockSource.connect(ctx.destination);
    unlockSource.start();

    if (pendingChunksRef.current.length) {
      const pendingChunks = [...pendingChunksRef.current];
      pendingChunksRef.current = [];
      pendingChunks.forEach(({ data, mimeType }) => playChunk(ctx, data, mimeType));
    }
  }, [getAudioContext, playChunk]);

  const enqueueAudioChunk = useCallback(async (base64PcmData: string, mimeType?: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      pendingChunksRef.current.push({ data: base64PcmData, mimeType });
      console.log("[audio] Queued chunk (no ctx yet) — pending:", pendingChunksRef.current.length);
      return;
    }

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (error) {
        console.error("[audio] Failed to resume AudioContext:", error);
        pendingChunksRef.current.push({ data: base64PcmData, mimeType });
        return;
      }
    }

    playChunk(ctx, base64PcmData, mimeType);
  }, [playChunk]);

  return { enqueueAudioChunk, isPlaying, warmUp, stopPlayback, analyserRef, getAudioContext, audioCtxRef };
}
