import { useRef, useState, useCallback } from "react";

export function useAudioPlayer() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const getCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioCtxRef.current;
  };

  const enqueueAudioChunk = useCallback((base64PcmData: string) => {
    const ctx = getCtx();
    const raw = atob(base64PcmData);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;

    setIsPlaying(true);
    source.onended = () => {
      if (nextPlayTimeRef.current <= ctx.currentTime) setIsPlaying(false);
    };
  }, []);

  return { enqueueAudioChunk, isPlaying };
}
