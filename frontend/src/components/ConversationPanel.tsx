import React, { useEffect, useRef, useState } from "react";
import { Message } from "../api/client";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useWebcamSnapshot } from "../hooks/useWebcamSnapshot";

interface Props {
  userId: string;
  connectionStatus: "disconnected" | "connecting" | "live" | "error";
  messages: Message[];
  sendAudioChunk: (buf: ArrayBuffer) => void;
  sendSnapshot: (b64: string) => void;
  warmUpAudio: () => void;
  stopAudioPlayback: () => void;
  signalTurnEnd: () => void;
  ws: WebSocket | null;
  sessionId: string;
  onNewSession: () => void;
  isCreatingSession: boolean;
}

const statusColors: Record<string, string> = {
  live: "text-emerald-400",
  connecting: "text-yellow-400",
  disconnected: "text-tertiary",
  error: "text-red-500",
};
const statusLabels: Record<string, string> = {
  live: "● Live",
  connecting: "● Connecting...",
  disconnected: "● Disconnected",
  error: "● Error",
};

export default function ConversationPanel({
  connectionStatus,
  messages,
  sendSnapshot,
  warmUpAudio,
  stopAudioPlayback,
  signalTurnEnd,
  ws,
  sessionId,
  onNewSession,
  isCreatingSession,
}: Props) {
  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
    onSpeechStart: stopAudioPlayback,
    onTurnEnd: signalTurnEnd,
  });
  const { videoRef, startCamera, stopCamera, captureSnapshot, isCameraOn } =
    useWebcamSnapshot();
  const [sentFlash, setSentFlash] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  useEffect(() => {
    stopRecording();
  }, [sessionId, stopRecording]);

  const toggleMic = () => {
    if (isRecording) {
      stopRecording();
      signalTurnEnd();
      return;
    }

    if (!ws || connectionStatus !== "live") return;

    void warmUpAudio(); // Unlock AudioContext + play any queued audio
    void startRecording(ws); // onSpeechStart will stop playback when user actually speaks
  };

  const toggleCamera = () => {
    isCameraOn ? stopCamera() : startCamera();
  };

  const handleNewSession = () => {
    stopRecording();
    onNewSession();
  };

  const handleShareOutfit = () => {
    const b64 = captureSnapshot();
    if (b64) {
      sendSnapshot(b64);
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 1500);
    }
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col h-full bg-transparent p-6 gap-6 relative">
      {/* Background decoration */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Connection status */}
      <div className="flex items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-2 flex-wrap">
          {sessionId ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] bg-surface px-3 py-1 rounded-full border border-white/5 text-tertiary">
              Session {sessionId.slice(-6)}
            </span>
          ) : null}
          <button
            onClick={handleNewSession}
            disabled={isCreatingSession}
            className="text-[10px] font-bold uppercase tracking-[0.18em] bg-surface px-3 py-1 rounded-full border border-white/5 text-tertiary hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60"
          >
            {isCreatingSession ? "Starting..." : "New Session"}
          </button>
        </div>
        <span
          className={`text-xs font-bold uppercase tracking-wider bg-surface px-3 py-1 rounded-full border border-white/5 ${statusColors[connectionStatus] ?? "text-tertiary"}`}
        >
          {statusLabels[connectionStatus] ?? connectionStatus}
        </span>
      </div>

      {/* Message history */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-2 z-10 custom-scrollbar">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[80%] px-5 py-3 text-[15px] leading-relaxed shadow-sm
                ${msg.role === "user"
                  ? "bg-secondary/40 text-white rounded-2xl rounded-tr-sm border border-white/5"
                  : "bg-surface border-l-[3px] border-primary text-white rounded-2xl rounded-tl-sm shadow-[0_4px_20px_-5px_rgba(0,0,0,0.3)]"
                }`}
            >
              {msg.text}
            </div>
            <span className="text-[10px] font-semibold tracking-wide text-secondary mt-1.5 px-1">
              {formatTime(msg.ts)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Camera preview */}
      <div className="relative h-96 bg-surface rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 shadow-sm z-10 shrink-0">
        {isCameraOn ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wide text-primary bg-app/80 backdrop-blur-md border border-white/10 rounded-full px-3 py-1">
              📷 Camera On
            </span>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-secondary">
            <span className="text-4xl opacity-50">📷</span>
            <p className="text-sm font-medium text-center px-6">
              Enable camera to show a signature item, accessory, or style detail
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-8 py-2 z-10 shrink-0">
        {/* Camera button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={toggleCamera}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all duration-300 shadow-sm border
              ${isCameraOn
                ? "bg-surface border-primary/40 text-primary shadow-[0_0_15px_rgba(238,43,91,0.2)]"
                : "bg-surface border-white/5 text-tertiary hover:bg-white/5 hover:text-white hover:border-white/10"
              }`}
          >
            📹
          </button>
          <span className="text-[10px] font-bold uppercase tracking-wide text-tertiary">Video</span>
        </div>

        {/* Mic button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={toggleMic}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all duration-300 shadow-lg border
              ${isRecording
                ? "bg-primary border-primary text-white animate-pulse-ring"
                : "bg-primary/90 border-primary/80 text-white hover:bg-primary scale-100 hover:scale-105"
              }`}
          >
            🎤
          </button>
          <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {isRecording ? "Listening..." : "Tap to Speak"}
          </span>
        </div>

        {/* Share outfit button */}
        <div className="flex flex-col items-center gap-2 w-14">
          {isCameraOn ? (
            <>
              <button
                onClick={handleShareOutfit}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all duration-300 shadow-sm border bg-surface
                  ${sentFlash 
                    ? "border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
                    : "border-white/5 text-tertiary hover:bg-white/5 hover:text-white hover:border-white/10"
                  }`}
              >
                {sentFlash ? "✓" : "📸"}
              </button>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${sentFlash ? "text-emerald-400" : "text-tertiary"}`}>
                {sentFlash ? "Sent!" : "Share Detail"}
              </span>
            </>
          ) : (
            <div className="w-14 h-14" />
          )}
        </div>
      </div>
    </div>
  );
}
