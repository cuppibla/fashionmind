# Session & Memory Architecture: InMemorySessionService + VertexAiMemoryBankService

## Overview

FashionMind uses a **split session/memory architecture** that deliberately separates two concerns:

| Concern | Component | Backend |
|---------|-----------|---------|
| Live session event store | `InMemorySessionService` | In-process RAM |
| Cross-session long-term memory | `VertexAiMemoryBankService` | Vertex AI Memory Bank |

This document explains why this split exists, the problems it solves, and how the two layers interact with the ADK's `LiveRequestQueue` and bidi streaming runtime.

---

## Background: What Went Wrong First

### The original (broken) configuration

```python
# services.py — original, DO NOT use
session_service = VertexAiSessionService(
    project=PROJECT_ID,
    location=REGION,
    agent_engine_id=resolved_agent_engine_id,
)
memory_service = VertexAiMemoryBankService(
    project=PROJECT_ID,
    location=REGION,
    agent_engine_id=resolved_agent_engine_id,
)
```

Both services pointed at the same Vertex AI Agent Engine. The intent was persistence across restarts and resumable sessions. In practice, this caused **two severe production symptoms**:

1. **Every live audio response was slow (2–5s perceived latency)**
2. **Sessions randomly died mid-conversation with a `TransportError`**

The root cause of both problems was the same: `VertexAiSessionService` was being used as the ADK session backend for a live bidi audio stream.

---

## Problem 1: Per-Event Vertex AI Round-Trips (Latency)

### How ADK uses the session service during live streaming

The ADK's live flow (`base_llm_flow.py → run_live → _send_to_model`) calls `session_service.append_event()` **on every event** that passes through the bidirectional stream. This includes:

- Each chunk of user audio sent to the model
- Each audio chunk the model generates in response
- Each tool call and tool response
- Each transcription update

With `VertexAiSessionService`, `append_event()` is a **network call** to the Vertex AI sessions API:

```
Client audio chunk
    → ADK upstream_task receives binary
    → send_realtime() into LiveRequestQueue
    → ADK _send_to_model() processes event
    → session_service.append_event(event)         ← Vertex AI HTTP round-trip
    → next event
```

At typical Vertex AI API latencies (50–300ms per call), this adds **visible delay to every exchange**. For a conversational audio session with dozens of events per turn, the accumulated overhead makes responses feel sluggish and sometimes appear "stuck."

The symptom in logs:

```
Update session resumption handle: new_handle='fd6d9f4a-...' resumable=True last_consumed_client_message_index=1.
Update session resumption handle: new_handle='8b873b20-...' resumable=True last_consumed_client_message_index=2.
Update session resumption handle: new_handle='8f9babae-...' resumable=True last_consumed_client_message_index=3.
```

These `Update session resumption handle` lines fire on every message consumed and each represents a Vertex AI write.

### With InMemorySessionService

`append_event()` becomes an in-process dictionary write — effectively zero-cost:

```python
# InMemorySessionService.append_event (simplified)
async def append_event(self, session, event):
    session.events.append(event)  # RAM write, ~microseconds
```

No network, no auth, no retry logic. The live stream flows at model speed.

---

## Problem 2: OAuth Token Refresh Mid-Stream (Session Crashes)

### What happened

The Vertex AI SDK authenticates using Google OAuth2 credentials. OAuth access tokens expire every ~60 minutes. When a token expires, the SDK must call `oauth2.googleapis.com/token` to refresh it.

With `VertexAiSessionService` handling every event, the token refresh happens **on the event-processing coroutine** — in the hot path of the live stream. When the machine had any network hiccup (or the token refreshed under load), the refresh call hung, then failed after tenacity's retry exhaustion:

```
google.auth.exceptions.TransportError:
  HTTPSConnectionPool(host='oauth2.googleapis.com', port=443):
  Max retries exceeded
    (Caused by NewConnectionError: [Errno 51] Network is unreachable)

ERROR:fashionmind:WebSocket error [...]: ... Network is unreachable
INFO:fashionmind:LiveRequestQueue closed: ...
```

The exception propagated up through `asyncio.gather(upstream_task(), downstream_task())` and killed the entire WebSocket connection. The client received a disconnect and retried, but hit the same problem.

### Why InMemorySessionService eliminates this

With `InMemorySessionService`, there are **zero Vertex AI calls during the live stream**. The only remaining Vertex AI interactions are:

1. Memory search at session start (`_prefetch_memory`) — happens once, before or during startup
2. Memory save at session end (`add_session_to_memory`) — happens once, after the session closes
3. The live model connection itself (Gemini via Vertex AI) — this is unavoidable, but it has its own robust connection management

OAuth token issues can still affect (1), (2), and (3), but they can only crash the session at well-defined boundaries, not mid-stream.

---

## Problem 3: Memory Prefetch Blocking Live Connection Startup

### Original flow (blocking)

```python
# websocket_endpoint — original

# 1. Prefetch memory (awaited synchronously)
memory_context = await _prefetch_memory(user_id)  # ← Vertex AI call, ~1-2s
if memory_context:
    live_request_queue.send_content(...)

# 2. Only THEN start live tasks
await asyncio.gather(upstream_task(), downstream_task())
```

The user tapped "speak" and had to wait for the memory search to complete before the Gemini live connection was even opened. First-response latency was dominated by this prefetch.

### Current flow (non-blocking)

```python
# websocket_endpoint — current

# 1. Queue user_id context immediately
live_request_queue.send_content(types.Content(
    role="user",
    parts=[types.Part(text=f"[Context] user_id: {user_id}...")]
))

# 2. Start memory prefetch in background — does NOT block
async def _inject_memory():
    memory_context = await _prefetch_memory(user_id)
    if memory_context:
        live_request_queue.send_content(...)
        logger.info("Injected pre-fetched memory")

asyncio.create_task(_inject_memory())   # ← fire and forget

# 3. Start live tasks immediately — no waiting
await asyncio.gather(upstream_task(), downstream_task())
```

The Gemini live connection opens immediately. Memory context is injected into the `LiveRequestQueue` once the Vertex AI search returns (~1–2s). Because users typically take 2–3 seconds to speak their first sentence, the memory is available before they finish.

---

## The ADK LiveRequestQueue

### What it is

`LiveRequestQueue` is the ADK's in-process message channel between the FastAPI WebSocket handler and the Gemini live model connection. It is **not** a network queue — it is an `asyncio`-based buffer that decouples content production (the WebSocket upstream task) from content consumption (the Gemini bidi stream).

```
WebSocket
  │
  ├── upstream_task()
  │     Receives messages from browser (binary PCM, JSON events)
  │     Calls live_request_queue.send_realtime(Blob) for audio
  │     Calls live_request_queue.send_content(Content) for text/image/context
  │
  └── downstream_task()
        runner.run_live(..., live_request_queue=live_request_queue, ...)
        Consumes from live_request_queue → Gemini live model
        Receives events from model → sends to WebSocket
```

### Two send methods

| Method | Use case | Triggers model response? |
|--------|----------|--------------------------|
| `send_realtime(Blob)` | Raw PCM audio, JPEG frames | No — buffered for VAD |
| `send_content(Content)` | Text, image prompts, context | Yes — sent as a turn |

The memory context injection and user_id context injection both use `send_content`. The actual audio from the microphone uses `send_realtime`.

### Why `send_content` can be called before the live model connects

`LiveRequestQueue` buffers items internally. `send_content` and `send_realtime` push to the buffer immediately. When `runner.run_live()` starts consuming from the queue (in `downstream_task`), it drains the buffer first. This means:

```python
# This is safe — memory context queued before Gemini connection opens
live_request_queue.send_content(user_id_context)     # buffered
asyncio.create_task(_inject_memory())                # will buffer when ready
await asyncio.gather(upstream_task(), downstream_task())  # starts consuming
```

The live model receives the user_id context and memory context as its first messages, before any user audio arrives.

### `close()` and cleanup

```python
finally:
    live_request_queue.close()
```

`close()` signals to the ADK that no more items will be pushed. The `runner.run_live()` generator will drain remaining items and terminate cleanly. This is called in the `finally` block so it always runs, even on WebSocket disconnect or exception.

---

## Current Architecture: Full Picture

```
┌─────────────────────────────────────────────────────────┐
│  WebSocket Handler (/ws/{user_id}/{session_id})         │
│                                                         │
│  On connect:                                            │
│  1. Create LiveRequestQueue                             │
│  2. Queue user_id context (send_content)                │
│  3. asyncio.create_task(_inject_memory)  ──────────┐   │
│  4. asyncio.gather(upstream, downstream)            │   │
│        │                        │                   │   │
│        ▼                        ▼                   │   │
│  upstream_task()        downstream_task()           │   │
│  receives WebSocket     runner.run_live(...)        │   │
│  binary → send_realtime    ↕ LiveRequestQueue       │   │
│  text   → send_content  Gemini Live Model           │   │
│                         streams audio back          │   │
│                         forwards events to WS       │   │
│                                           ▲         │   │
│  _inject_memory() ──────────────────────────────────┘   │
│  (background task)                                      │
│  awaits VertexAiMemoryBankService.search_memory()       │
│  → send_content(memory_context) when ready             │
│                                                         │
│  On disconnect/error:                                   │
│  live_request_queue.close()                             │
└─────────────────────────────────────────────────────────┘

┌──────────────────────────┐    ┌──────────────────────────┐
│  InMemorySessionService  │    │  VertexAiMemoryBankService│
│                          │    │                           │
│  append_event() → RAM    │    │  search_memory() → once   │
│  get_session() → RAM     │    │  add_session_to_memory()  │
│                          │    │    → called by            │
│  No network calls        │    │    after_agent_callback   │
│  No auth tokens          │    │    at session end         │
│  No retry logic          │    │                           │
│  Zero latency overhead   │    │  Vertex AI Memory Bank    │
└──────────────────────────┘    └──────────────────────────┘
```

---

## Memory Bank Lifecycle

### Read path (session start)

```python
# _prefetch_memory() in main.py
response = await memory_service.search_memory(
    app_name="fashionmind",
    user_id=user_id,
    query="style identity signature items comfort constraints...",
)
# Returns memories from previous sessions
# Injected as user-role Content into LiveRequestQueue
```

The agent receives past session summaries as context before the user speaks. It uses this to remember things like "you mentioned overheating in layers last time" without being told explicitly.

### Write path (session end)

```python
# agent/agent.py — after_agent_callback
async def add_session_to_memory(callback_context):
    invocation_context = callback_context._invocation_context
    if invocation_context.memory_service:
        asyncio.create_task(
            invocation_context.memory_service.add_session_to_memory(
                invocation_context.session
            )
        )
```

After each agent invocation completes, the ADK calls `add_session_to_memory`. This summarizes the conversation and stores it in Vertex AI Memory Bank. Future sessions can retrieve it.

Because the session object lives in `InMemorySessionService`, it contains the full event history of the conversation. The memory bank call gets the complete conversation to summarize.

---

## RunConfig: Why `session_resumption` Was Removed

```python
# REMOVED from RunConfig:
session_resumption=types.SessionResumptionConfig(transparent=True)
```

`SessionResumptionConfig(transparent=True)` tells the ADK to save a session resumption handle after every message. The intent is to allow resuming a dropped connection mid-conversation without replaying from scratch.

With `VertexAiSessionService`, this wrote a handle to Vertex AI on every message — compounding the per-event latency problem.

With `InMemorySessionService`, session state does not survive process restarts, so resumption is impossible anyway. The flag was purely overhead.

If resumable sessions become a requirement in the future, the correct approach is to reintroduce `VertexAiSessionService` **only** for the session resumption state (not as the full event store), or use the ADK's checkpoint API separately.

---

## Trade-offs and Limitations

| Capability | Current behavior |
|-----------|-----------------|
| Live audio latency | Low — no per-event network calls |
| Mid-session auth failures | Eliminated for session event path |
| Cross-session memory | Preserved — VertexAiMemoryBankService |
| Session survives server restart | No — InMemory is ephemeral |
| Session resumption after drop | No — removed with `session_resumption` |
| Horizontal scaling (multiple instances) | No — sessions are per-process |

For a live demo or single-instance deployment, the current architecture is correct. For production horizontal scaling, session state would need to be stored in a shared external store (e.g., Redis-backed session service or a custom ADK session service implementation), while still keeping the Vertex AI event writes out of the hot path.

---

## Configuration Reference

`backend/agent/services.py`:

```python
# Session: always InMemory — zero overhead on live stream hot path
session_service = InMemorySessionService()

# Memory: Vertex AI when USE_MEMORY_BANK=true, InMemory for local dev
if USE_MEMORY_BANK and resolved_agent_engine_id:
    from google.adk.memory import VertexAiMemoryBankService
    memory_service = VertexAiMemoryBankService(
        project=PROJECT_ID,
        location=REGION,
        agent_engine_id=resolved_agent_engine_id,
    )
else:
    memory_service = InMemoryMemoryService()
```

`backend/main.py` — RunConfig:

```python
run_config = RunConfig(
    streaming_mode=StreamingMode.BIDI,
    response_modalities=["AUDIO"],
    input_audio_transcription=types.AudioTranscriptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    # session_resumption intentionally omitted — InMemory sessions are not resumable
)
```

Environment variables:

| Variable | Effect |
|----------|--------|
| `USE_MEMORY_BANK=true` | Enables VertexAiMemoryBankService; requires GOOGLE_CLOUD_PROJECT |
| `USE_MEMORY_BANK=false` (default) | Uses InMemoryMemoryService; fully local, no GCP required |
| `AGENT_ENGINE_ID` | Skip auto-discovery; use this engine ID directly |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | Region (default: us-central1) |
