import React, { useEffect, useState } from "react";
import { createSession } from "./api/client";
import { useADKWebSocket } from "./hooks/useADKWebSocket";
import ConversationPanel from "./components/ConversationPanel";
import UserSidePanel from "./components/UserSidePanel";

const DEFAULT_USER_ID = "demo-user-001";

export default function App() {
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    createSession(DEFAULT_USER_ID)
      .then((res) => setSessionId(res.session_id))
      .catch((e) => console.error("Failed to create session:", e));
  }, []);

  const { connectionStatus, messages, sendAudioChunk, sendSnapshot, sendText, ws } =
    useADKWebSocket(DEFAULT_USER_ID, sessionId);

  return (
    <div className="h-screen flex bg-slate-950 overflow-hidden">
      <div className="w-1/3 border-r border-slate-800 overflow-y-auto">
        <UserSidePanel userId={DEFAULT_USER_ID} />
      </div>
      <div className="w-2/3 overflow-hidden">
        <ConversationPanel
          userId={DEFAULT_USER_ID}
          connectionStatus={connectionStatus}
          messages={messages}
          sendAudioChunk={sendAudioChunk}
          sendSnapshot={sendSnapshot}
          ws={ws}
        />
      </div>
    </div>
  );
}
