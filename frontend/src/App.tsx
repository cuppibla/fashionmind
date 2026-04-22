import React, { useEffect, useState, useCallback } from "react";
import { createSession } from "./api/client";
import { useADKWebSocket } from "./hooks/useADKWebSocket";
import CatalogBrowsePage from "./components/CatalogBrowsePage";
import ConnectingOverlay from "./components/ConnectingOverlay";
import ConversationView from "./components/ConversationView";

const DEFAULT_USER_ID = "123e4567-e89b-12d3-a456-426614174000";

type AppMode = "browse" | "connecting" | "live";

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("browse");
  const [sessionId, setSessionId] = useState<string>("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const startNewSession = useCallback(async () => {
    setIsCreatingSession(true);
    try {
      const res = await createSession(DEFAULT_USER_ID);
      setSessionId(res.session_id);
    } catch (e) {
      console.error("Failed to create session:", e);
      setAppMode("browse");
    } finally {
      setIsCreatingSession(false);
    }
  }, []);

  const {
    connectionStatus,
    messages,
    recommendedProducts,
    memoryRecall,
    userContext,
    toolCallLog,
    sendAudioChunk,
    sendSnapshot,
    sendText,
    signalTurnEnd,
    warmUpAudio,
    stopAudioPlayback,
    wsRef,
    analyserRef,
    isAudioPlaying,
    getAudioContext,
  } = useADKWebSocket(DEFAULT_USER_ID, sessionId);

  // Phone gesture → create session + transition to connecting
  const handlePhoneGesture = useCallback(async () => {
    if (appMode !== "browse") return;
    setAppMode("connecting");
    await startNewSession();
  }, [appMode, startNewSession]);

  // Auto-transition: connecting → live when WebSocket connects
  useEffect(() => {
    if (appMode === "connecting" && connectionStatus === "live") {
      setAppMode("live");
    }
  }, [appMode, connectionStatus]);

  // End call → back to browse
  const handleEndCall = useCallback(() => {
    setAppMode("browse");
    setSessionId(""); // This will close the WebSocket via useADKWebSocket
  }, []);

  return (
    <>
      {/* Browse mode — full-screen catalog */}
      {appMode === "browse" && (
        <CatalogBrowsePage onPhoneGesture={handlePhoneGesture} />
      )}

      {/* Connecting overlay */}
      {appMode === "connecting" && <ConnectingOverlay />}

      {/* Live conversation — 2-column layout */}
      {appMode === "live" && (
        <ConversationView
          connectionStatus={connectionStatus}
          messages={messages}
          recommendedProducts={recommendedProducts}
          memoryRecall={memoryRecall}
          userContext={userContext}
          toolCallLog={toolCallLog}
          sendAudioChunk={sendAudioChunk}
          sendSnapshot={sendSnapshot}
          warmUpAudio={warmUpAudio}
          stopAudioPlayback={stopAudioPlayback}
          signalTurnEnd={signalTurnEnd}
          wsRef={wsRef}
          getAudioContext={getAudioContext}
          analyserRef={analyserRef}
          isAudioPlaying={isAudioPlaying}
          onEndCall={handleEndCall}
        />
      )}
    </>
  );
}
