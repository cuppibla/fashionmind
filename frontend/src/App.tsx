import React, { useEffect, useState, useCallback } from "react";
import { createSession } from "./api/client";
import { useADKWebSocket } from "./hooks/useADKWebSocket";
import ConversationPanel from "./components/ConversationPanel";
import UserSidePanel from "./components/UserSidePanel";
import MerchantCatalogPanel from "./components/MerchantCatalogPanel";

const DEFAULT_USER_ID = "123e4567-e89b-12d3-a456-426614174000";

export default function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const startNewSession = useCallback(async () => {
    setIsCreatingSession(true);
    try {
      const res = await createSession(DEFAULT_USER_ID);
      setSessionId(res.session_id);
    } catch (e) {
      console.error("Failed to create session:", e);
    } finally {
      setIsCreatingSession(false);
    }
  }, []);

  useEffect(() => {
    void startNewSession();
  }, [startNewSession]);

  const {
    connectionStatus,
    messages,
    recommendedProducts,
    sendAudioChunk,
    sendSnapshot,
    sendText,
    signalTurnEnd,
    warmUpAudio,
    stopAudioPlayback,
    ws,
  } =
    useADKWebSocket(DEFAULT_USER_ID, sessionId);

  return (
    <div className="h-screen w-full flex bg-app overflow-hidden font-sans text-white">
      {/* 25% Width - User Side Panel */}
      <div className="w-1/4 border-r border-white/5 overflow-hidden">
        <UserSidePanel userId={DEFAULT_USER_ID} sessionId={sessionId} />
      </div>
      
      {/* 50% Width - Conversation Panel */}
      <div className="w-1/2 border-r border-white/5 overflow-hidden bg-app">
        <ConversationPanel
          userId={DEFAULT_USER_ID}
          connectionStatus={connectionStatus}
          messages={messages}
          sendAudioChunk={sendAudioChunk}
          sendSnapshot={sendSnapshot}
          warmUpAudio={warmUpAudio}
          stopAudioPlayback={stopAudioPlayback}
          signalTurnEnd={signalTurnEnd}
          ws={ws}
          sessionId={sessionId}
          onNewSession={startNewSession}
          isCreatingSession={isCreatingSession}
        />
      </div>

      {/* 25% Width - Merchant Catalog Panel */}
      <div className="w-1/4 overflow-hidden shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.5)] z-10">
        <MerchantCatalogPanel recommendedProducts={recommendedProducts} />
      </div>
    </div>
  );
}
