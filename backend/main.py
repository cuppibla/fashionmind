import asyncio
import base64
import logging
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google.adk.runners import RunConfig, StreamingMode
from google.genai import types

from db.database import create_all_tables
from api.routes.users import router as users_router
from api.routes.wardrobe import router as wardrobe_router
from agent.services import runner, session_service, memory_service
from agent.agent import root_agent

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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router, prefix="/api")
app.include_router(wardrobe_router, prefix="/api")


@app.get("/")
async def root():
    return {"status": "ok", "service": "fashionmind"}


# ---------- Session endpoint ----------

@app.post("/api/sessions/{user_id}")
async def create_session(user_id: str):
    session_id = f"{user_id}-{int(time.time())}"
    await session_service.create_session(
        app_name="fashionmind",
        user_id=user_id,
        session_id=session_id,
    )
    return {"session_id": session_id, "user_id": user_id}


# ---------- Memory endpoint ----------

@app.get("/api/users/{user_id}/memory")
async def get_user_memory(user_id: str):
    try:
        result = await memory_service.search_memory(
            app_name="fashionmind",
            user_id=user_id,
            query="style preferences purchases occasions",
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
        session_resumption=types.SessionResumptionConfig(transparent=True),
    )

    # Ensure session exists
    session = await session_service.get_session(
        app_name="fashionmind", user_id=user_id, session_id=session_id
    )
    if not session:
        await session_service.create_session(
            app_name="fashionmind", user_id=user_id, session_id=session_id
        )

    live_request_queue = runner.create_live_request_queue()

    # Phase 3 — upstream task
    async def upstream_task():
        # Initial greeting stimulus
        live_request_queue.send_content(
            types.Content(parts=[
                types.Part(text=(
                    f"Session started. user_id={user_id}. "
                    f"Please call get_user_context('{user_id}') and greet the user."
                ))
            ])
        )

        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Raw PCM audio from microphone
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
                                    "The user just shared a photo of their outfit. "
                                    "Please look at it and give your honest styling feedback."
                                ))
                            ])
                        )

                    elif msg_type == "text":
                        live_request_queue.send_content(
                            types.Content(parts=[types.Part(text=data["text"])])
                        )

                    elif msg_type == "init":
                        logger.info(f"Init received for user {data.get('user_id', user_id)}")
                        # Already handled by the initial stimulus above

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
            input_tx = getattr(event, "input_audio_transcription", None)
            if input_tx and getattr(input_tx, "final_transcript", None):
                logger.info(f"USER [{user_id}]: {input_tx.final_transcript}")

            output_tx = getattr(event, "output_audio_transcription", None)
            if output_tx and getattr(output_tx, "final_transcript", None):
                logger.info(f"AGENT → {user_id}: {output_tx.final_transcript}")

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
