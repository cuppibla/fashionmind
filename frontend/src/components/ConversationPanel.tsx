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
  ws: WebSocket | null;
}

const statusColors: Record<string, string> = {
  live: "text-green-400",
  connecting: "text-yellow-400",
  disconnected: "text-red-400",
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
  ws,
}: Props) {
  const { startRecording, stopRecording, isRecording } = useAudioRecorder();
  const { videoRef, startCamera, stopCamera, captureSnapshot, isCameraOn } =
    useWebcamSnapshot();
  const [sentFlash, setSentFlash] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleMic = () => {
    if (!ws) return;
    isRecording ? stopRecording() : startRecording(ws);
  };

  const toggleCamera = () => {
    isCameraOn ? stopCamera() : startCamera();
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
    <div className="flex flex-col h-full bg-slate-900 p-4 gap-4">
      {/* Connection status */}
      <div className="flex justify-end">
        <span
          className={`text-xs font-medium ${statusColors[connectionStatus] ?? "text-slate-400"}`}
        >
          {statusLabels[connectionStatus] ?? connectionStatus}
        </span>
      </div>

      {/* Camera preview */}
      <div className="relative h-56 bg-slate-800 rounded-xl overflow-hidden flex items-center justify-center border border-slate-700">
        {isCameraOn ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <span className="absolute top-2 right-2 text-xs text-rose-400 bg-slate-900/70 rounded-full px-2 py-0.5">
              📷 Camera On
            </span>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <span className="text-5xl">📷</span>
            <p className="text-sm text-center">
              Enable camera so FashionMind can see your outfit
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        {/* Mic button */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={toggleMic}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl transition-all
              ${isRecording
                ? "bg-rose-500 text-white animate-pulse-ring"
                : "bg-slate-700 text-slate-400 hover:bg-slate-600"
              }`}
          >
            🎤
          </button>
          <span className="text-xs text-slate-400">
            {isRecording ? "Listening..." : "Tap to talk"}
          </span>
        </div>

        {/* Camera button */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={toggleCamera}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all
              ${isCameraOn
                ? "bg-rose-500 text-white"
                : "bg-slate-700 text-slate-400 hover:bg-slate-600"
              }`}
          >
            📹
          </button>
          <span className="text-xs text-slate-400">Camera</span>
        </div>

        {/* Share outfit button */}
        {isCameraOn && (
          <button
            onClick={handleShareOutfit}
            className="px-4 py-2 rounded-full bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 transition-all"
          >
            {sentFlash ? "Sent! ✓" : "📸 Share Outfit"}
          </button>
        )}
      </div>

      {/* Message history */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-xs px-4 py-2 rounded-2xl text-sm text-white
                ${msg.role === "user"
                  ? "bg-slate-700 rounded-tr-sm"
                  : "bg-rose-950 border-l-2 border-rose-400 rounded-tl-sm"
                }`}
            >
              {msg.text}
            </div>
            <span className="text-xs text-slate-500 mt-0.5">
              {formatTime(msg.ts)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
