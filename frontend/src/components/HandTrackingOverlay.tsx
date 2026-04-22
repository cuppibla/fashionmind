import React from "react";
import type { GestureState } from "../hooks/useHandTracking";

interface Props {
  gestureState: GestureState;
  isTracking: boolean;
}

const STATUS_CONFIG: Record<GestureState, { text: string; icon: string; color: string } | null> = {
  idle: null, // hidden — tracking not started
  no_hand: { text: "Searching…", icon: "🔍", color: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300" },
  phone_detected: { text: "Hold to Call…", icon: "📞", color: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300 animate-pulse" },
  phone_confirmed: { text: "Connecting…", icon: "📞", color: "bg-primary/30 border-primary/50 text-primary animate-pulse" },
  error: { text: "Tracking Error", icon: "❌", color: "bg-red-500/20 border-red-500/40 text-red-300" },
};

export default function HandTrackingOverlay({ gestureState, isTracking }: Props) {
  const status = STATUS_CONFIG[gestureState];

  // Don't render anything if tracking hasn't started yet
  if (!isTracking && gestureState === "idle") return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Status badge — bottom right */}
      {status && (
        <div className="absolute bottom-6 right-6">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md text-sm font-semibold tracking-wide transition-all duration-300 ${status.color}`}
          >
            <span>{status.icon}</span>
            <span>{status.text}</span>
            {gestureState === "no_hand" && (
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>
        </div>
      )}

      {/* Frosted overlay during connecting */}
      {gestureState === "phone_confirmed" && (
        <div className="absolute inset-0 bg-app/60 backdrop-blur-xl transition-opacity duration-500" />
      )}
    </div>
  );
}
