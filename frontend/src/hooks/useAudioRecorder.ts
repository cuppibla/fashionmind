import { useRef, useState, useCallback } from "react";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const startRecording = useCallback(async (ws: WebSocket) => {
    wsRef.current = ws;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const clamped = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = clamped * 32767;
        }
        ws.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access error:", err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    processorRef.current?.disconnect();
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  return { startRecording, stopRecording, isRecording };
}
