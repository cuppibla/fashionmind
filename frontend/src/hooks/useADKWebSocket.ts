import { useState, useRef, useCallback, useEffect } from "react";
import { Message, MemoryRecallEvent, Product, ToolCallEvent, UserContextEvent } from "../api/client";
import { useAudioPlayer } from "./useAudioPlayer";

const WS_BASE =
  import.meta.env.VITE_WS_BASE_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
const MAX_RETRIES = 3;

function extractAudioParts(event: any): Array<{ data: string; mimeType: string }> {
  const candidateParts = [
    ...(Array.isArray(event?.content?.parts) ? event.content.parts : []),
    ...(Array.isArray(event?.serverContent?.modelTurn?.parts)
      ? event.serverContent.modelTurn.parts
      : []),
  ];

  return candidateParts
    .map((part) => part?.inlineData ?? part?.inline_data ?? null)
    .filter(
      (inlineData): inlineData is { data: string; mimeType?: string; mime_type?: string } =>
        Boolean(inlineData?.data),
    )
    .map((inlineData) => ({
      data: inlineData.data,
      mimeType: inlineData.mimeType ?? inlineData.mime_type ?? "",
    }))
    .filter((inlineData) => inlineData.mimeType.startsWith("audio/"));
}

export function useADKWebSocket(userId: string, sessionId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "live" | "error"
  >("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
  const [memoryRecall, setMemoryRecall] = useState<MemoryRecallEvent | null>(null);
  const [userContext, setUserContext] = useState<UserContextEvent | null>(null);
  const [toolCallLog, setToolCallLog] = useState<ToolCallEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(false);
  const { enqueueAudioChunk, warmUp: warmUpAudio, stopPlayback, analyserRef, isPlaying: isAudioPlaying, getAudioContext } = useAudioPlayer();

  const appendMessage = useCallback((role: "user" | "agent", text: string) => {
    setMessages((prev) => [...prev, { role, text, ts: new Date() }]);
  }, []);

  useEffect(() => {
    setMessages([]);
    setRecommendedProducts([]);
    setMemoryRecall(null);
    setUserContext(null);
    setToolCallLog([]);
  }, [sessionId]);

  const connect = useCallback(() => {
    if (!userId || !sessionId) return;
    shouldReconnectRef.current = true;
    setConnectionStatus("connecting");

    const ws = new WebSocket(`${WS_BASE}/ws/${userId}/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) {
        ws.close();
        return;
      }
      setIsConnected(true);
      setConnectionStatus("connecting");
      retriesRef.current = 0;
      ws.send(JSON.stringify({ type: "init", user_id: userId }));
    };

    ws.onmessage = (evt) => {
      if (wsRef.current !== ws) {
        return;
      }

      try {
        const event = JSON.parse(evt.data);

        if (event.type === "session_ready") {
          setConnectionStatus("live");
          console.log(
            `[ws] Session ready: catalog=${event.catalog_count ?? 0}, memory=${Boolean(event.has_memory)}, memoryFetchMs=${event.memory_fetch_ms ?? 0}`,
          );
          return;
        }

        // Product recommendations pushed by the backend when the agent calls
        // recommend_products(). Replace the current set so the panel always
        // shows the most recent recommendation.
        if (event.type === "product_recommendations") {
          const products = event.products ?? [];
          console.log(
            `[recs] product_recommendations received: ${products.length} product(s)`,
            products.map((p: any) => ({ id: p.id, title: p.title })),
          );
          setRecommendedProducts(products);
          return;
        }

        // Memory recalled at session start — for the memory panel display
        if (event.type === "memory_recalled") {
          setMemoryRecall({
            raw: event.raw ?? "",
            facts: event.facts ?? [],
            fetchMs: event.fetch_ms ?? 0,
            ts: new Date(),
          });
          return;
        }

        // Initial user profile + wishlist + occasions snapshot
        if (event.type === "user_context") {
          setUserContext(event as UserContextEvent);
          return;
        }

        // Agent tool calls — track live mutations for the memory panel
        if (event.type === "tool_called") {
          setToolCallLog((prev) => [
            ...prev,
            { tool: event.tool as string, args: event.args ?? {}, ts: new Date() },
          ]);
          return;
        }

        // Log any function_call events that reach the frontend (for diagnostics)
        const parts = event?.content?.parts ?? event?.serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
          const fn = part?.functionCall ?? part?.function_call;
          if (fn) {
            console.log(`[tool-call] ${fn.name}(`, fn.args, `)`);
          }
        }

        const audioParts = extractAudioParts(event);
        if (audioParts.length > 0) {
          console.log(`[ws] Audio event: ${audioParts.length} part(s), mimeType=${audioParts[0].mimeType}, b64len=${audioParts[0].data.length}`);
        }
        audioParts.forEach((part) => {
          enqueueAudioChunk(part.data, part.mimeType).catch((audioErr) => {
            console.error("[audio] enqueueAudioChunk failed:", audioErr);
          });
        });

        // Input transcription (user speech) — only append on final
        const inputTx = event.inputTranscription;
        if (inputTx?.text && inputTx?.finished) {
          appendMessage("user", inputTx.text);
        }

        // Output transcription (agent speech) — only append on final
        const outputTx = event.outputTranscription;
        if (outputTx?.text && outputTx?.finished) {
          appendMessage("agent", outputTx.text);
        }
      } catch (e) {
        console.error("[ws] Failed to process message:", e);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) {
        return;
      }
      setConnectionStatus("error");
    };

    ws.onclose = () => {
      if (wsRef.current !== ws && wsRef.current !== null) {
        return;
      }

      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setIsConnected(false);
      setConnectionStatus("disconnected");

      if (!shouldReconnectRef.current || retriesRef.current >= MAX_RETRIES) {
        return;
      }

      retriesRef.current++;
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (shouldReconnectRef.current) {
          connect();
        }
      }, 2000);
    };
  }, [userId, sessionId, enqueueAudioChunk, appendMessage]);

  useEffect(() => {
    if (userId && sessionId) {
      connect();
    }

    return () => {
      shouldReconnectRef.current = false;
      retriesRef.current = 0;
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect, userId, sessionId]);

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

  const signalTurnEnd = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_turn" }));
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    stopPlayback();
  }, [stopPlayback]);

  return {
    isConnected,
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
    reconnect: connect,
    warmUpAudio,
    stopAudioPlayback,
    wsRef,
    analyserRef,
    isAudioPlaying,
    getAudioContext,
  };
}
