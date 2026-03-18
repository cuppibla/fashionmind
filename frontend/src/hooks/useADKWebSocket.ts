import { useState, useRef, useCallback, useEffect } from "react";
import { Message } from "../api/client";
import { useAudioPlayer } from "./useAudioPlayer";

const WS_BASE = "ws://localhost:8080";
const MAX_RETRIES = 3;

export function useADKWebSocket(userId: string, sessionId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "live" | "error"
  >("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const { enqueueAudioChunk } = useAudioPlayer();

  const appendMessage = useCallback((role: "user" | "agent", text: string) => {
    setMessages((prev) => [...prev, { role, text, ts: new Date() }]);
  }, []);

  const connect = useCallback(() => {
    if (!userId || !sessionId) return;
    setConnectionStatus("connecting");

    const ws = new WebSocket(`${WS_BASE}/ws/${userId}/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionStatus("live");
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: "init", user_id: userId }));
    };

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);

        // Audio chunks
        event.content?.parts?.forEach((part: any) => {
          if (part.inline_data?.mime_type?.startsWith("audio/pcm")) {
            enqueueAudioChunk(part.inline_data.data);
          }
        });

        // Input transcription (user speech)
        const inputTx = event.input_audio_transcription;
        if (inputTx?.final_transcript) {
          appendMessage("user", inputTx.final_transcript);
        }

        // Output transcription (agent speech)
        const outputTx = event.output_audio_transcription;
        if (outputTx?.final_transcript) {
          appendMessage("agent", outputTx.final_transcript);
        }
      } catch {
        // non-JSON frame — ignore
      }
    };

    ws.onerror = () => setConnectionStatus("error");

    ws.onclose = () => {
      setIsConnected(false);
      setConnectionStatus("disconnected");
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        setTimeout(connect, 2000);
      }
    };
  }, [userId, sessionId, enqueueAudioChunk, appendMessage]);

  useEffect(() => {
    if (userId && sessionId) connect();
    return () => wsRef.current?.close();
  }, [userId, sessionId]);

  const sendAudioChunk = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer);
    }
  }, []);

  const sendSnapshot = useCallback((base64Jpeg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "image", data: base64Jpeg }));
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "text", text }));
    }
  }, []);

  return {
    isConnected,
    connectionStatus,
    messages,
    sendAudioChunk,
    sendSnapshot,
    sendText,
    reconnect: connect,
    ws: wsRef.current,
  };
}
