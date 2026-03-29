import asyncio
import base64
import json
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
from sqlalchemy import select

from google.adk.runners import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai import types

from db.database import create_all_tables, get_db_context
from db.models import Product
from api.routes.users import router as users_router
from api.routes.wardrobe import router as wardrobe_router
from api.routes.products import router as products_router
from agent.services import runner, session_service, memory_service
from agent.agent import root_agent, USE_MEMORY_BANK

logger = logging.getLogger("fashionmind")
logging.basicConfig(level=logging.INFO)


# ---------- Product catalog cache ----------
# Loaded once at server startup and shared across all sessions.
# Options 4: inject as context so the agent can recommend without tool calls.

_PRODUCT_CACHE: list[dict] = []


async def _load_product_cache() -> None:
    """Load all products from CloudSQL into memory at server startup."""
    try:
        async with get_db_context() as db:
            result = await db.execute(select(Product).order_by(Product.created_at))
            products = result.scalars().all()
            _PRODUCT_CACHE.clear()
            for p in products:
                images = json.loads(p.images) if p.images else []
                _PRODUCT_CACHE.append({
                    "id": str(p.id),
                    "title": p.title,
                    "subtitle": p.subtitle,
                    "price": float(p.price),
                    "images": images,
                    "category": p.category,
                })
        if _PRODUCT_CACHE:
            logger.info(
                f"Product cache loaded: {len(_PRODUCT_CACHE)} products — "
                + ", ".join(p["title"] for p in _PRODUCT_CACHE[:5])
                + ("..." if len(_PRODUCT_CACHE) > 5 else "")
            )
        else:
            logger.error(
                "Product cache is EMPTY after load — DB connected but products table has no rows. "
                "Run seed_products.py to populate the catalog."
            )
    except Exception as e:
        logger.error(
            f"Product cache load FAILED — agent will hallucinate products. "
            f"Check DATABASE_URL and DB connectivity. Error: {e}"
        )


def _format_catalog_text() -> str:
    """Format _PRODUCT_CACHE as compact text for context injection (~8 tokens/product)."""
    if not _PRODUCT_CACHE:
        return ""
    lines = [
        "[Catalog] Products available in the store.",
        "Use the exact id values when calling recommend_products():",
    ]
    for p in _PRODUCT_CACHE:
        price_str = f"${p['price']:.2f}"
        cat_str = f" | {p['category']}" if p["category"] else ""
        lines.append(f"  id:{p['id']} | {p['title']} | {price_str}{cat_str}")
    return "\n".join(lines)


def _extract_recommendations(event) -> list[dict] | None:
    """
    Detect a recommend_products function_call event in the ADK event stream.
    Returns the matching full product dicts from _PRODUCT_CACHE, or None if
    this event is not a recommend_products call.
    """
    try:
        content = getattr(event, "content", None)
        if not content:
            return None
        parts = getattr(content, "parts", None) or []
        for part in parts:
            fn_call = getattr(part, "function_call", None)
            if fn_call:
                name = getattr(fn_call, "name", "")
                args = getattr(fn_call, "args", None) or {}
                logger.info(f"[tool-detect] function_call seen: name={name!r} args={args}")
                if name == "recommend_products":
                    product_ids = args.get("product_ids", [])
                    id_set = {str(pid) for pid in product_ids}
                    logger.info(f"[tool-detect] recommend_products ids={list(id_set)}")
                    matched = [p for p in _PRODUCT_CACHE if p["id"] in id_set]
                    unmatched = id_set - {p["id"] for p in matched}
                    if unmatched:
                        logger.warning(f"[tool-detect] IDs not in cache (hallucinated?): {unmatched}")
                    logger.info(f"[tool-detect] matched {len(matched)}/{len(id_set)} products from cache")
                    return matched
    except Exception as e:
        logger.error(f"[tool-detect] _extract_recommendations error: {e}")
    return None


# ---------- Lifespan ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all_tables()
    await _load_product_cache()
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


@app.get("/api/debug/catalog")
async def debug_catalog():
    """Returns the current in-memory product cache state.
    Use this to verify the catalog loaded correctly at startup."""
    return {
        "count": len(_PRODUCT_CACHE),
        "catalog_text_tokens_approx": len(_format_catalog_text().split()),
        "products": [
            {"id": p["id"], "title": p["title"], "price": p["price"], "category": p["category"]}
            for p in _PRODUCT_CACHE
        ],
    }


@app.post("/api/admin/reload-catalog")
async def reload_catalog():
    """Reload the product cache from the DB without restarting the server.
    Use after adding/updating products or if the cache loaded empty at startup."""
    await _load_product_cache()
    return {
        "count": len(_PRODUCT_CACHE),
        "status": "ok" if _PRODUCT_CACHE else "empty — check DB connectivity and run seed_products.py",
    }


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

    # Inject product catalog from in-memory cache — reads _PRODUCT_CACHE so
    # this is effectively instant (~0ms). Runs as a background task alongside
    # _inject_memory() to keep session startup non-blocking.
    async def _inject_catalog():
        catalog_text = _format_catalog_text()
        if catalog_text:
            live_request_queue.send_content(
                types.Content(
                    role="user",
                    parts=[types.Part(text=catalog_text)],
                )
            )
            logger.info(f"[{user_id}] Injected product catalog: {len(_PRODUCT_CACHE)} products")
        else:
            # Tell the model explicitly so it knows not to invent products
            live_request_queue.send_content(
                types.Content(
                    role="user",
                    parts=[types.Part(text=(
                        "[Catalog] No products are currently loaded. "
                        "Do not describe or recommend any specific products — "
                        "tell the user the catalog is unavailable if they ask."
                    ))],
                )
            )
            logger.error(
                f"[{user_id}] Catalog injection skipped — _PRODUCT_CACHE is empty. "
                "POST /api/admin/reload-catalog or restart the server after fixing DB."
            )

    # Prefetch memory in the background — Vertex AI call, ~1-2s
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

    # Both run in parallel — catalog arrives in ~5ms, memory in ~1500ms
    asyncio.create_task(_inject_catalog())
    asyncio.create_task(_inject_memory())

    # Phase 3 — upstream task
    async def upstream_task():
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
                    logger.info(f"Audio chunk: {len(message['bytes'])} bytes from {user_id}")

                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type", "")

                    if msg_type == "image":
                        # Explicit outfit snapshot — send image + prompt as one
                        # multipart Content turn so the model responds immediately.
                        # send_realtime() is for streaming media; send_content() with
                        # inline_data is the correct path for a single user-initiated share.
                        frame_bytes = base64.b64decode(data["data"])
                        live_request_queue.send_content(
                            types.Content(
                                role="user",
                                parts=[
                                    types.Part(
                                        inline_data=types.Blob(
                                            mime_type="image/jpeg",
                                            data=frame_bytes,
                                        )
                                    ),
                                    types.Part(text=(
                                        "The user just shared a photo of their outfit or a style "
                                        "detail. Analyze what you see — colors, silhouette, "
                                        "layering, fit, vibe — and give specific, actionable "
                                        "styling feedback. If this reveals a signature item, "
                                        "preferred color, or stable preference, reflect it back "
                                        "naturally in your response."
                                    )),
                                ],
                            )
                        )
                        logger.info(f"Outfit snapshot received from {user_id}")

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

            # Log every function call the agent makes (any tool) for diagnostics
            _content = getattr(event, "content", None)
            for _part in (getattr(_content, "parts", None) or []):
                _fn = getattr(_part, "function_call", None)
                if _fn:
                    logger.info(
                        f"[tool-call] [{user_id}] {getattr(_fn, 'name', '?')}("
                        f"{getattr(_fn, 'args', {})})"
                    )

            # Detect recommend_products function call → push product highlights
            # to the frontend as a clean typed event separate from the ADK stream.
            recommendations = _extract_recommendations(event)
            if recommendations is not None:
                await websocket.send_text(json.dumps({
                    "type": "product_recommendations",
                    "products": recommendations,
                }))
                logger.info(
                    f"Pushed {len(recommendations)} product recommendation(s) to {user_id}"
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
