import asyncio
import base64
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google.adk.runners import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai import types

from db.database import create_all_tables
from api.routes.users import router as users_router
from api.routes.wardrobe import router as wardrobe_router
from api.routes.products import router as products_router
from agent.services import runner, session_service, memory_service
from agent.agent import root_agent, USE_MEMORY_BANK

logger = logging.getLogger("fashionmind")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all_tables()
    yield


app = FastAPI(title="FashionMind API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router, prefix="/api")
app.include_router(wardrobe_router, prefix="/api")
app.include_router(products_router, prefix="/api")


@app.get("/")
async def root():
    return {"status": "ok", "service": "fashionmind"}


async def create_managed_session(user_id: str, session_id: Optional[str] = None):
    create_kwargs = {
        "app_name": "fashionmind",
        "user_id": user_id,
    }

    if session_id:
        try:
            return await session_service.create_session(
                **create_kwargs,
                session_id=session_id,
            )
        except ValueError as exc:
            if "User-provided Session id is not supported" not in str(exc):
                raise

    return await session_service.create_session(**create_kwargs)


# ---------- Session endpoint ----------

@app.post("/api/sessions/{user_id}")
async def create_session(user_id: str):
    desired_session_id = f"{user_id}-{int(time.time())}"
    session = await create_managed_session(user_id, desired_session_id)
    return {"session_id": session.id, "user_id": user_id}


# ---------- Memory endpoint ----------

@app.get("/api/users/{user_id}/memory")
async def get_user_memory(user_id: str):
    try:
        result = await memory_service.search_memory(
            app_name="fashionmind",
            user_id=user_id,
            query=(
                "style identity signature items comfort constraints visual style markers "
                "conference context preferred colors wishlist purchases occasions layering"
            ),
        )
        memories = []
        if result and hasattr(result, "memories"):
            for m in result.memories:
                if hasattr(m, "content") and m.content:
                    for part in m.content.parts:
                        if hasattr(part, "text") and part.text:
                            memories.append(part.text)
        return {"memories": memories}
    except Exception as e:
        logger.warning(f"Memory search failed for {user_id}: {e}")
        return {"memories": []}


async def _prefetch_memory(user_id: str) -> str | None:
    """Fetch memory once before live session starts. Returns formatted text or None."""
    if not USE_MEMORY_BANK:
        return None
    try:
        response = await memory_service.search_memory(
            app_name="fashionmind",
            user_id=user_id,
            query=(
                "style identity signature items comfort constraints visual style markers "
                "conference context preferred colors wishlist purchases occasions layering"
            ),
        )
        if not response or not response.memories:
            return None

        lines = []
        for memory in response.memories:
            if memory.timestamp:
                lines.append(f"Time: {memory.timestamp}")
            if memory.content and memory.content.parts:
                text = " ".join(
                    p.text for p in memory.content.parts
                    if hasattr(p, "text") and p.text
                )
                if text:
                    line = f"{memory.author}: {text}" if memory.author else text
                    lines.append(line)

        if not lines:
            return None

        return (
            "The following content is from your previous conversations with the user.\n"
            "They may be useful for answering the user's current query.\n"
            "<PAST_CONVERSATIONS>\n"
            + "\n".join(lines)
            + "\n</PAST_CONVERSATIONS>"
        )
    except Exception as e:
        logger.warning(f"Memory pre-fetch failed for {user_id}: {e}")
        return None


# ---------- WebSocket bidi streaming ----------

@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {user_id}/{session_id}")

    # Phase 2 — RunConfig
    model_name = root_agent.model or "gemini-live-2.5-flash-native-audio"
    use_audio = "native-audio" in model_name or "live" in model_name

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"] if use_audio else ["TEXT"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    # Ensure session exists
    session = await session_service.get_session(
        app_name="fashionmind", user_id=user_id, session_id=session_id
    )
    if not session:
        try:
            await create_managed_session(user_id, session_id)
        except ValueError:
            logger.error(
                "Session %s was not found, and the active session service does not "
                "support creating that exact session id on demand.",
                session_id,
            )
            await websocket.close(code=1011, reason="Session not found")
            return

    from google.adk.agents import LiveRequestQueue
    live_request_queue = LiveRequestQueue()

    # Inject user_id so the agent knows which UUID to pass to tools
    live_request_queue.send_content(
        types.Content(
            role="user",
            parts=[types.Part(text=(
                f"[Context] The current authenticated user's ID is: {user_id}. "
                "Use this exact value for user_id whenever calling any tool."
            ))],
        )
    )

    # Prefetch memory in the background — don't block live connection startup
    async def _inject_memory():
        memory_context = await _prefetch_memory(user_id)
        if memory_context:
            live_request_queue.send_content(
                types.Content(
                    role="user",
                    parts=[types.Part(text=memory_context)],
                )
            )
            logger.info(f"Injected pre-fetched memory for {user_id}")

    asyncio.create_task(_inject_memory())

    # Phase 3 — upstream task
    async def upstream_task():
        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Raw PCM audio from microphone
                    logger.info(f"Audio chunk: {len(message['bytes'])} bytes from {user_id}")
                    live_request_queue.send_realtime(
                        types.Blob(
                            mime_type="audio/pcm;rate=16000",
                            data=message["bytes"],
                        )
                    )

                elif "text" in message and message["text"]:
                    import json
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type", "")

                    if msg_type == "image":
                        # Outfit snapshot from user
                        frame_bytes = base64.b64decode(data["data"])
                        live_request_queue.send_realtime(
                            types.Blob(mime_type="image/jpeg", data=frame_bytes)
                        )
                        logger.info(f"Outfit snapshot received from {user_id}")
                        # Cue the agent to respond to the image
                        live_request_queue.send_content(
                            types.Content(parts=[
                                types.Part(text=(
                                    "The user just shared a camera snapshot of a style detail, "
                                    "accessory, or outfit element. Combine what you see with "
                                    "their nearby speech. If this reveals a stable preference, "
                                    "signature item, or comfort need, mention that naturally in "
                                    "your response while giving styling feedback."
                                ))
                            ])
                        )

                    elif msg_type == "text":
                        live_request_queue.send_content(
                            types.Content(parts=[types.Part(text=data["text"])])
                        )

                    elif msg_type == "end_turn":
                        # For native-audio live models, turn-taking is handled
                        # automatically — no need to inject a text prompt.
                        pass

                    elif msg_type == "init":
                        logger.info(f"Init received for user {data.get('user_id', user_id)}")

        except WebSocketDisconnect:
            raise
        except Exception as e:
            logger.error(f"Upstream error [{user_id}]: {e}")

    # Phase 3 — downstream task
    async def downstream_task():
        async for event in runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=live_request_queue,
            run_config=run_config,
        ):
            # Log transcriptions
            input_tx = getattr(event, "input_transcription", None)
            if input_tx and input_tx.finished and input_tx.text:
                logger.info(f"USER [{user_id}]: {input_tx.text}")

            output_tx = getattr(event, "output_transcription", None)
            if output_tx and output_tx.finished and output_tx.text:
                logger.info(f"AGENT → {user_id}: {output_tx.text}")

            # Forward every event as JSON to the frontend
            await websocket.send_text(
                event.model_dump_json(exclude_none=True, by_alias=True)
            )

    # Phase 4 — run both concurrently
    try:
        await asyncio.gather(upstream_task(), downstream_task())
    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {user_id}/{session_id}")
    except Exception as e:
        logger.error(f"WebSocket error [{user_id}]: {e}")
    finally:
        live_request_queue.close()
        logger.info(f"LiveRequestQueue closed: {user_id}/{session_id}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        reload=False,
    )
