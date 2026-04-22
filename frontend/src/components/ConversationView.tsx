import React, { useEffect, useRef, useState } from "react";
import { MemoryRecallEvent, Message, Product, ToolCallEvent, UserContextEvent } from "../api/client";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useWebcamSnapshot } from "../hooks/useWebcamSnapshot";
import { MemoryInfoPanel, RecommendationsPanel } from "./MemoryPanel";

interface Props {
  connectionStatus: "disconnected" | "connecting" | "live" | "error";
  messages: Message[];
  recommendedProducts: Product[];
  memoryRecall: MemoryRecallEvent | null;
  userContext: UserContextEvent | null;
  toolCallLog: ToolCallEvent[];
  sendAudioChunk: (buf: ArrayBuffer) => void;
  sendSnapshot: (b64: string) => void;
  warmUpAudio: () => void;
  stopAudioPlayback: () => void;
  signalTurnEnd: () => void;
  wsRef: React.RefObject<WebSocket | null>;
  getAudioContext: () => Promise<AudioContext>;
  analyserRef: React.RefObject<AnalyserNode | null>;
  isAudioPlaying: boolean;
  onEndCall: () => void;
}

const statusColors: Record<string, string> = {
  live: "text-emerald-400",
  connecting: "text-yellow-400",
  disconnected: "text-tertiary",
  error: "text-red-500",
};

const statusDots: Record<string, string> = {
  live: "bg-emerald-400 animate-pulse",
  connecting: "bg-yellow-400 animate-pulse",
  disconnected: "bg-white/20",
  error: "bg-red-500",
};

export default function ConversationView({
  connectionStatus,
  messages,
  recommendedProducts,
  memoryRecall,
  userContext,
  toolCallLog,
  sendSnapshot,
  warmUpAudio,
  stopAudioPlayback,
  signalTurnEnd,
  wsRef,
  getAudioContext,
  isAudioPlaying,
  onEndCall,
}: Props) {
  const { startRecording, stopRecording, isRecording } = useAudioRecorder({
    onSpeechStart: stopAudioPlayback,
    onTurnEnd: signalTurnEnd,
  });
  const { videoRef, startCamera, stopCamera, captureSnapshot, isCameraOn } =
    useWebcamSnapshot();
  const [sentFlash, setSentFlash] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Start camera automatically when entering live mode
  useEffect(() => {
    void startCamera();
    return () => {
      stopRecording();
      stopCamera();
    };
  }, [startCamera, stopCamera, stopRecording]);

  // Auto-start mic when connection goes live
  useEffect(() => {
    if (connectionStatus === "live" && wsRef.current && !isRecording) {
      void warmUpAudio();
      void (async () => {
        const ctx = await getAudioContext();
        void startRecording(wsRef, ctx);
      })();
    }
  }, [connectionStatus, wsRef, isRecording, warmUpAudio, startRecording, getAudioContext]);

  useEffect(() => {
    if (connectionStatus !== "live" && isRecording) {
      stopRecording();
    }
  }, [connectionStatus, isRecording, stopRecording]);

  const toggleMic = () => {
    if (isRecording) {
      stopRecording();
      signalTurnEnd();
      return;
    }
    if (!wsRef.current || connectionStatus !== "live") return;
    void warmUpAudio();
    void (async () => {
      const ctx = await getAudioContext();
      void startRecording(wsRef, ctx);
    })();
  };

  const handleShareOutfit = () => {
    if (sentFlash) return;
    const b64 = captureSnapshot();
    if (b64 && connectionStatus === "live") {
      sendSnapshot(b64);
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 3000);
    }
  };


  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-screen w-full flex flex-col bg-app overflow-hidden">

      {/* ───── Header bar ───── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0 bg-app">
        {/* Left: branding + status */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-tight text-white">✦ FashionMind</span>
          <span className="text-white/20 text-xs">·</span>
          <span className="text-xs text-tertiary">AI Stylist</span>
          <div className="flex items-center gap-1.5 ml-2">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDots[connectionStatus] ?? "bg-white/20"}`} />
            <span className={`text-xs font-semibold uppercase tracking-wider ${statusColors[connectionStatus] ?? "text-tertiary"}`}>
              {connectionStatus}
            </span>
          </div>
        </div>

        {/* Right: end session */}
        <div className="flex items-center gap-2">
          <button
            onClick={onEndCall}
            className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors"
          >
            End Session
          </button>
        </div>
      </header>

      {/* ───── 3-column body ───── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ===== LEFT: Conversation (35%) ===== */}
        <div className="w-[35%] flex flex-col border-r border-white/5 min-h-0">

          {/* Transcript — scrollable, takes all available space */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
                <span className="text-4xl">💬</span>
                <p className="text-xs text-tertiary text-center">
                  Conversation will appear here
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[90%] px-4 py-2.5 text-sm leading-relaxed
                    ${msg.role === "user"
                      ? "bg-secondary/40 text-white rounded-2xl rounded-tr-sm border border-white/5"
                      : "bg-surface border-l-[3px] border-primary text-white rounded-2xl rounded-tl-sm"
                    }`}
                >
                  {msg.text}
                </div>
                <span className="text-[9px] font-semibold tracking-wide text-secondary mt-1 px-1">
                  {formatTime(msg.ts)}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Camera preview — compact, fixed height */}
          <div className="relative h-[320px] bg-surface overflow-hidden border-t border-white/5 shrink-0">
            {isCameraOn ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wide text-primary bg-app/80 backdrop-blur-md border border-white/10 rounded-full px-2.5 py-1">
                  📷 Camera On
                </span>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-tertiary">
                <span className="text-3xl opacity-40">📷</span>
              </div>
            )}
          </div>

          {/* Controls bar */}
          <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-white/5 shrink-0">
            {/* Mic */}
            <button
              onClick={toggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 shadow-lg border
                ${isRecording
                  ? "bg-primary border-primary text-white animate-pulse-ring"
                  : "bg-surface border-white/10 text-tertiary hover:bg-white/10 hover:text-white"
                }`}
              title={isRecording ? "Stop mic" : "Start mic"}
            >
              🎤
            </button>

            {/* Share outfit */}
            <button
              onClick={handleShareOutfit}
              disabled={!isCameraOn || sentFlash || connectionStatus !== "live"}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all duration-300 border disabled:opacity-40 disabled:cursor-not-allowed
                ${sentFlash
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                  : "bg-surface border-white/10 text-tertiary hover:bg-white/10 hover:text-white hover:border-white/20"
                }`}
            >
              {sentFlash ? "✓ Sent!" : "📸 Share Outfit"}
            </button>

            {/* Speaker */}
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center text-lg border transition-all duration-300
                ${isAudioPlaying
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-surface border-white/10 text-tertiary"
                }`}
              title="Speaker"
            >
              🔊
            </div>
          </div>
        </div>

        {/* ===== CENTER: Memory & Profile (35%) ===== */}
        <div className="w-[35%] min-h-0 overflow-y-auto custom-scrollbar border-r border-white/5">
          <MemoryInfoPanel
            userContext={userContext}
            memoryRecall={memoryRecall}
            toolCallLog={toolCallLog}
          />
        </div>

        {/* ===== RIGHT: Recommendations (30%) ===== */}
        <div className="w-[30%] min-h-0 overflow-y-auto custom-scrollbar">
          <RecommendationsPanel
            recommendedProducts={recommendedProducts}
          />
        </div>

      </div>
    </div>
  );
}
