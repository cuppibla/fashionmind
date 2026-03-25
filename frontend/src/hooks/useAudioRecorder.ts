import { useRef, useState, useCallback } from "react";

const CAPTURE_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 512;
const SILENCE_RMS_THRESHOLD = 0.012;

interface UseAudioRecorderOptions {
  onSpeechStart?: () => void;
  onTurnEnd?: () => void;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const speechActiveRef = useRef(false);
  const onSpeechStartRef = useRef(options.onSpeechStart);
  onSpeechStartRef.current = options.onSpeechStart;

  const stopRecording = useCallback(() => {
    processorRef.current?.disconnect();
    muteGainRef.current?.disconnect();
    void ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    muteGainRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
    speechActiveRef.current = false;
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async (ws: WebSocket) => {
    if (isRecording) {
      return;
    }

    wsRef.current = ws;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: CAPTURE_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      processorRef.current = processor;
      muteGainRef.current = muteGain;
      speechActiveRef.current = false;

      let _debugFrameCount = 0;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        let sumSquares = 0;

        for (let i = 0; i < float32.length; i++) {
          const clamped = Math.max(-1, Math.min(1, float32[i]));
          sumSquares += clamped * clamped;
          int16[i] = clamped * 32767;
        }

        // Always send every frame — model's native VAD needs silence to detect turn end
        ws.send(int16.buffer);

        // Local RMS used only to trigger onSpeechStart (barge-in: stop playback)
        const rms = Math.sqrt(sumSquares / float32.length);
        _debugFrameCount++;
        if (_debugFrameCount % 100 === 1) {
          console.log(`[recorder] streaming frame=${_debugFrameCount} rms=${rms.toFixed(4)}`);
        }

        const isSpeech = rms >= SILENCE_RMS_THRESHOLD;
        if (isSpeech && !speechActiveRef.current) {
          speechActiveRef.current = true;
          console.log("[recorder] Speech detected (barge-in), rms=" + rms.toFixed(4));
          onSpeechStartRef.current?.();
        } else if (!isSpeech && speechActiveRef.current) {
          speechActiveRef.current = false;
        }
      };

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(ctx.destination);
      setIsRecording(true);
      console.log("[recorder] Recording started at 16kHz");
    } catch (err) {
      console.error("[recorder] Microphone access error:", err);
    }
  }, [isRecording]);

  return { startRecording, stopRecording, isRecording };
}
