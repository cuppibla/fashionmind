import React from "react";

/**
 * Frosted-glass overlay shown during the connecting transition.
 */
export default function ConnectingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/70 backdrop-blur-xl">
      {/* Background glow */}
      <div className="absolute w-[400px] h-[400px] bg-primary/10 rounded-full blur-[120px] animate-pulse" />

      <div className="relative flex flex-col items-center gap-8">
        {/* Pulsing ring */}
        <div className="relative">
          <div className="absolute inset-0 w-40 h-40 rounded-full border-2 border-primary/30 animate-ping" />
          <div className="absolute inset-2 w-36 h-36 rounded-full border border-primary/20 animate-ping" style={{ animationDelay: "0.3s" }} />

          {/* Phone icon */}
          <div className="w-40 h-40 rounded-full bg-surface/80 backdrop-blur-md border border-white/10 flex items-center justify-center shadow-2xl">
            <span className="text-6xl animate-bounce" style={{ animationDuration: "2s" }}>
              📞
            </span>
          </div>
        </div>

        {/* Text */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Connecting to AI Stylist</h2>
          <p className="text-tertiary text-sm">Setting up your personal session…</p>
        </div>

        {/* Loading dots */}
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
