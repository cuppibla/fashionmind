import asyncio
import base64
import json
import logging
import os
import re
import time
import struct
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().with_name(".env"))

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
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
from agent.tools.wardrobe_tools import get_user_context as _get_user_context_data

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


# ---------- Keyword-based product matcher ----------
# Detects product names from the model's spoken output (output_transcription)
# using fuzzy regex keyword matching. Zero API calls, ~0.01ms per check.

_PRODUCT_MATCHERS: list[dict] = []  # built from _PRODUCT_CACHE at startup


def _build_product_matchers() -> None:
    """Build keyword regex patterns from the product cache.

    For each product, extract 2-3 distinctive keywords from the title and
    compile case-insensitive regex patterns. A product matches if 2+ keywords
    are found in the transcription text.
    """
    global _PRODUCT_MATCHERS
    _PRODUCT_MATCHERS.clear()

    for product in _PRODUCT_CACHE:
        title = product["title"]
        # Split title into words, remove very short/common words
        words = [w for w in re.split(r'[\s\-]+', title) if len(w) >= 3]

        # Build regex patterns for each keyword:
        # - Case-insensitive word boundary match
        # - Handle plurals/suffixes: boots? matches boot/boots
        # - Handle common variations: jeans? dress(es)? etc.
        patterns = []
        for word in words:
            base = word.lower().rstrip('s')
            # Create pattern that matches the base word with optional s/es suffix
            pattern = re.compile(
                rf'\b{re.escape(base)}(?:e?s)?\b',
                re.IGNORECASE
            )
            patterns.append((word, pattern))

        if len(patterns) >= 2:
            _PRODUCT_MATCHERS.append({
                "product": product,
                "patterns": patterns,
                "min_matches": 2,  # require 2+ keyword matches
            })
        elif len(patterns) == 1:
            # Single-word titles (rare) — still allow but only exact-ish match
            _PRODUCT_MATCHERS.append({
                "product": product,
                "patterns": patterns,
                "min_matches": 1,
            })

    logger.info(
        f"Product matchers built for {len(_PRODUCT_MATCHERS)} products: "
        + ", ".join(f"{m['product']['title']} ({len(m['patterns'])} kw)" for m in _PRODUCT_MATCHERS[:5])
        + ("..." if len(_PRODUCT_MATCHERS) > 5 else "")
    )


def _detect_products_in_text(text: str) -> list[dict]:
    """Detect product mentions in transcription text using keyword matching.

    Returns a list of product dicts from _PRODUCT_CACHE that were mentioned.
    """
    if not text or not _PRODUCT_MATCHERS:
        return []

    matches = []
    for matcher in _PRODUCT_MATCHERS:
        hit_count = sum(
            1 for _, pattern in matcher["patterns"]
            if pattern.search(text)
        )
        if hit_count >= matcher["min_matches"]:
            matches.append(matcher["product"])

    return matches


def _format_catalog_text() -> str:
    """Format _PRODUCT_CACHE as compact text for context injection (~8 tokens/product)."""
    if not _PRODUCT_CACHE:
        return ""
    lines = [
        "[Catalog] Products available in the store.",
        "Mention specific product titles by name when recommending — the app will display them automatically:",
    ]
    for p in _PRODUCT_CACHE:
        price_str = f"${p['price']:.2f}"
        cat_str = f" | {p['category']}" if p["category"] else ""
        lines.append(f"  {p['title']} | {price_str}{cat_str}")
    return "\n".join(lines)


# _extract_recommendations and _suppress_recommend_products_response are no
# longer needed — product detection is now done via keyword matching from the
# model's output_transcription, not from tool calls.


# ---------- Lifespan ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all_tables()
    await _load_product_cache()
    _build_product_matchers()
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
    _build_product_matchers()
    return {
        "count": len(_PRODUCT_CACHE),
        "status": "ok" if _PRODUCT_CACHE else "empty — check DB connectivity and run seed_products.py",
    }


@app.post("/api/demo/screenshot")
async def receive_demo_screenshot(request: Request):
    """Receive a base64-encoded screenshot of the demo page for logging."""
    body = await request.json()
    b64 = body.get("data", "")
    ts = body.get("timestamp", "unknown")
    logger.info(f"[screenshot] received {len(b64)} base64 chars at {ts}")
    return {"status": "ok"}


async def _prefetch_memory(user_id: str) -> tuple[str | None, list[dict]]:
    """Fetch memory once before live session starts.
    Returns (formatted_text_for_agent, list_of_facts_for_frontend).

    NOTE: The ADK's memory_service.search_memory() defaults to top_k=3 and
    doesn't expose a way to increase it.  We call the Vertex AI API directly
    — omitting similarity_search_params returns ALL memories for the scope.
    """
    if not USE_MEMORY_BANK:
        return None, []
    try:
        import traceback

        # Re-use the memory service's internal async client (properly authed).
        engine_id = getattr(memory_service, "_agent_engine_id", "")
        if not engine_id:
            logger.warning("Memory Bank engine ID not available")
            return None, []

        api_client = memory_service._get_api_client()
        # Omit similarity_search_params → returns ALL memories for this scope
        # (no top_k=3 limit).  See: https://cloud.google.com/vertex-ai/docs/...
        retrieved_memories = await api_client.agent_engines.memories.retrieve(
            name=f"reasoningEngines/{engine_id}",
            scope={
                "app_name": "fashionmind",
                "user_id": user_id,
            },
        )

        lines = []
        facts = []
        async for mem in retrieved_memories:
            fact_text = mem.memory.fact if mem.memory else None
            if not fact_text:
                continue
            ts_str = (
                mem.memory.update_time.isoformat()
                if mem.memory.update_time else None
            )
            if ts_str:
                lines.append(f"Time: {ts_str}")
            lines.append(fact_text)
            facts.append({
                "text": fact_text,
                "author": None,
                "timestamp": ts_str,
            })

        logger.info(
            f"[{user_id}] Memory Bank recalled {len(facts)} fact(s): "
            + "; ".join(f['text'][:60] for f in facts)
        )

        if not facts:
            logger.info(f"[{user_id}] Memory Bank search returned no memories")
            return None, []

        context = (
            "The following content is from your previous conversations with the user.\n"
            "They may be useful for answering the user's current query.\n"
            "<PAST_CONVERSATIONS>\n"
            + "\n".join(lines)
            + "\n</PAST_CONVERSATIONS>"
        )
        return context, facts
    except Exception as e:
        import traceback
        logger.warning(f"Memory pre-fetch failed for {user_id}: {e}\n{traceback.format_exc()}")
        return None, []


def _format_user_context_text(ctx: dict | None) -> str:
    """Format structured user context compactly for startup instruction state."""
    if not ctx:
        return ""

    profile = ctx.get("profile") or {}
    occasions = ctx.get("upcoming_occasions") or []
    wishlist = ctx.get("wishlist") or []
    purchases = ctx.get("recent_purchases") or []

    lines = ["[User Context] Current structured profile and shopping context."]
    name = profile.get("name")
    body_type = profile.get("body_type")
    age = profile.get("age")
    profile_bits = []
    if name:
        profile_bits.append(f"name: {name}")
    if age:
        profile_bits.append(f"age: {age}")
    if body_type:
        profile_bits.append(f"body_type: {body_type}")
    if profile_bits:
        lines.append("Profile: " + " | ".join(profile_bits))

    if occasions:
        lines.append("Upcoming occasions:")
        for item in occasions[:5]:
            bits = [item.get("name") or "occasion"]
            if item.get("date"):
                bits.append(str(item["date"]))
            if item.get("notes"):
                bits.append(str(item["notes"]))
            lines.append("  - " + " | ".join(bits))

    if wishlist:
        lines.append("Wishlist:")
        for item in wishlist[:5]:
            bits = [item.get("item_name") or "item"]
            if item.get("brand"):
                bits.append(str(item["brand"]))
            if item.get("category"):
                bits.append(str(item["category"]))
            if item.get("price") is not None:
                bits.append(f"${float(item['price']):.2f}")
            lines.append("  - " + " | ".join(bits))

    if purchases:
        lines.append("Recent purchases:")
        for item in purchases[:3]:
            bits = [item.get("item_name") or "item"]
            if item.get("category"):
                bits.append(str(item["category"]))
            if item.get("notes"):
                bits.append(str(item["notes"]))
            lines.append("  - " + " | ".join(bits))

    return "\n".join(lines)


# ---------- WebSocket bidi streaming ----------

@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {user_id}/{session_id}")

    # Phase 2 — RunConfig
    model_name = root_agent.model or "gemini-3.1-flash-live-preview"
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
            session = await create_managed_session(user_id, session_id)
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

    ws_closed = asyncio.Event()
    ui_notification_queue = asyncio.Queue()

    async def _ui_sender_task():
        while not ws_closed.is_set():
            try:
                msg = await asyncio.wait_for(ui_notification_queue.get(), timeout=1.0)
                if msg is None:
                    break
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                # Connection likely closed
                ws_closed.set()
                break

    async def _prepare_startup_context() -> dict:
        """Populate session state used by the agent instruction before audio starts."""
        assert session is not None

        t0 = time.monotonic()
        memory_context = None
        memory_facts = []
        user_context = None
        user_context_task = asyncio.create_task(_get_user_context_data(user_id))
        try:
            memory_context, memory_facts = await asyncio.wait_for(
                _prefetch_memory(user_id),
                timeout=8.0,
            )
        except asyncio.TimeoutError:
            logger.warning(f"[{user_id}] Memory pre-fetch timed out; starting without memory")

        try:
            user_context = await asyncio.wait_for(user_context_task, timeout=2.0)
            ui_notification_queue.put_nowait(json.dumps({
                "type": "user_context",
                **user_context,
            }))
            logger.info(f"[{user_id}] Prepared user_context for startup")
        except asyncio.TimeoutError:
            logger.warning(f"[{user_id}] User context fetch timed out; starting without it")
        except Exception as e:
            logger.warning(f"[{user_id}] Failed to prepare user_context: {e}")

        fetch_ms = int((time.monotonic() - t0) * 1000)
        if memory_context:
            logger.info(f"Prepared pre-fetched memory for {user_id} ({fetch_ms}ms)")
        else:
            logger.info(f"[{user_id}] No memory prepared ({fetch_ms}ms)")

        try:
            ui_notification_queue.put_nowait(json.dumps({
                "type": "memory_recalled",
                "raw": memory_context or "",
                "facts": memory_facts,
                "fetch_ms": fetch_ms,
            }))
        except Exception:
            pass

        context_blocks = [
            (
                "[Runtime] The current authenticated user's ID is: "
                f"{user_id}. Use this exact value for user_id whenever calling any tool."
            ),
            (
                "[Runtime] This section is setup context only. Do not greet, answer, "
                "or call tools because of this context alone. Wait until the user "
                "speaks, types, or shares an image."
            ),
        ]

        catalog_text = _format_catalog_text()
        if catalog_text:
            context_blocks.append(catalog_text)
            logger.info(f"[{user_id}] Prepared product catalog: {len(_PRODUCT_CACHE)} products")
        else:
            context_blocks.append(
                "[Catalog] No products are currently loaded. "
                "Do not describe or recommend any specific products — "
                "tell the user the catalog is unavailable if they ask."
            )
            logger.error(
                f"[{user_id}] Catalog context is empty — _PRODUCT_CACHE is empty. "
                "POST /api/admin/reload-catalog or restart the server after fixing DB."
            )

        if memory_context:
            context_blocks.append(memory_context)

        user_context_text = _format_user_context_text(user_context)
        if user_context_text:
            context_blocks.append(user_context_text)

        session.state["startup_context"] = "\n\n".join(context_blocks)
        return {
            "type": "session_ready",
            "memory_fetch_ms": fetch_ms,
            "catalog_count": len(_PRODUCT_CACHE),
            "has_memory": bool(memory_context),
        }

    async def _startup_task():
        ready_event = await _prepare_startup_context()
        if not ws_closed.is_set():
            ui_notification_queue.put_nowait(json.dumps(ready_event))

    # Start the UI sender while memory is loading, then delay live audio until
    # the model context has been placed in session state.
    ui_sender = asyncio.create_task(_ui_sender_task())
    try:
        await _startup_task()
    except Exception as e:
        ws_closed.set()
        logger.error(f"Startup context failed [{user_id}]: {e}")
        try:
            await websocket.close(code=1011, reason="Startup context failed")
        except Exception:
            pass
        live_request_queue.close()
        ui_notification_queue.put_nowait(None)
        await ui_sender
        return

    if ws_closed.is_set():
        live_request_queue.close()
        ui_notification_queue.put_nowait(None)
        await ui_sender
        return

    # Phase 3 — upstream task
    async def upstream_task():
        try:
            audio_chunk_count = 0
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    raw = message["bytes"]
                    # Validate: s16le requires even byte count
                    if len(raw) % 2 != 0:
                        logger.warning(
                            f"[audio] ODD byte count {len(raw)} from {user_id} — "
                            "skipping (invalid for s16le)"
                        )
                        continue
                    audio_chunk_count += 1
                    if audio_chunk_count <= 3 or audio_chunk_count % 100 == 0:
                        try:
                            int16_samples = struct.unpack(f"<{len(raw)//2}h", raw)
                            rms = (sum(s*s for s in int16_samples) / len(int16_samples)) ** 0.5
                            logger.info(
                                f"[audio] chunk #{audio_chunk_count}: "
                                f"{len(raw)} bytes ({len(raw)//2} samples) from {user_id}, rms={rms:.4f}"
                            )
                        except Exception:
                            logger.info(
                                f"[audio] chunk #{audio_chunk_count}: "
                                f"{len(raw)} bytes ({len(raw)//2} samples) from {user_id}"
                            )
                    # Raw PCM audio from microphone
                    live_request_queue.send_realtime(
                        types.Blob(
                            mime_type="audio/pcm;rate=16000",
                            data=raw,
                        )
                    )

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
                        # Signal end of user input so model responds faster
                        live_request_queue.send_activity_end()
                        logger.info(f"[{user_id}] Activity end signalled")

                    elif msg_type == "init":
                        logger.info(f"Init received for user {data.get('user_id', user_id)}")

        except WebSocketDisconnect:
            ws_closed.set()
            raise
        except Exception as e:
            ws_closed.set()
            logger.error(f"Upstream error [{user_id}]: {e}")

    # Phase 3 — downstream task
    sent_product_ids: set[str] = set()  # dedup: track IDs already pushed to client
    all_recommended_products: list[dict] = []  # accumulate all recommended products
    # Collect finished transcriptions for memory save.  Live sessions store
    # transcripts in event.input_transcription / output_transcription, NOT in
    # event.content.parts — so the Memory Bank's fact extractor can't see them.
    # We'll inject synthetic text events before memory save.
    transcript_turns: list[tuple[str, str]] = []  # [("user"|"model", text), ...]
    async def downstream_task():
        async for event in runner.run_live(
            session=session,
            live_request_queue=live_request_queue,
            run_config=run_config,
        ):
            if event is None:
                continue
            if ws_closed.is_set():
                break

            # Log transcriptions and collect for memory
            input_tx = getattr(event, "input_transcription", None)
            if input_tx and input_tx.finished and input_tx.text:
                logger.info(f"USER [{user_id}]: {input_tx.text}")
                transcript_turns.append(("user", input_tx.text))

            output_tx = getattr(event, "output_transcription", None)
            if output_tx and output_tx.finished and output_tx.text:
                logger.info(f"AGENT → {user_id}: {output_tx.text}")
                transcript_turns.append(("model", output_tx.text))

                # Keyword-based product detection from the model's speech.
                # No tool call, no round-trip, no audio pause.
                detected = _detect_products_in_text(output_tx.text)
                if detected and not ws_closed.is_set():
                    new_products = [
                        p for p in detected if p["id"] not in sent_product_ids
                    ]
                    if new_products:
                        new_ids = {p["id"] for p in new_products}
                        sent_product_ids.update(new_ids)
                        all_recommended_products.extend(new_products)
                        try:
                            # Send ALL accumulated products — frontend does a
                            # full replace of the recommendations panel.
                            ui_notification_queue.put_nowait(json.dumps({
                                "type": "product_recommendations",
                                "products": all_recommended_products,
                            }))
                            names = ", ".join(p["title"] for p in new_products)
                            logger.info(
                                f"[keyword-match] Pushed {len(new_products)} new product(s) "
                                f"to {user_id}: {names} "
                                f"(total: {len(all_recommended_products)})"
                            )
                        except Exception:
                            pass

            # Forward every event as JSON to the frontend
            try:
                await websocket.send_text(
                    event.model_dump_json(exclude_none=True, by_alias=True)
                )
            except Exception:
                break

            # Log every function call and push a typed event to the frontend
            _content = getattr(event, "content", None)
            for _part in (getattr(_content, "parts", None) or []):
                _fn = getattr(_part, "function_call", None)
                if _fn:
                    _fn_name = getattr(_fn, 'name', '?')
                    _fn_args = dict(getattr(_fn, 'args', {}) or {})
                    logger.info(
                        f"[tool-call] [{user_id}] {_fn_name}({_fn_args})"
                    )
                    if not ws_closed.is_set():
                        try:
                            ui_notification_queue.put_nowait(json.dumps({
                                "type": "tool_called",
                                "tool": _fn_name,
                                "args": _fn_args,
                            }))
                        except Exception:
                            pass

    # Phase 4 — run both concurrently
    stream_tasks = []
    try:
        stream_tasks = [
            asyncio.create_task(upstream_task()),
            asyncio.create_task(downstream_task()),
        ]
        done, pending = await asyncio.wait(
            stream_tasks,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            exc = task.exception()
            if exc:
                raise exc
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {user_id}/{session_id}")
    except Exception as e:
        logger.error(f"WebSocket error [{user_id}]: {e}")
    finally:
        ws_closed.set()
        for task in stream_tasks:
            if not task.done():
                task.cancel()
        live_request_queue.close()
        # Explicitly save session to memory bank on disconnect.
        # Live audio sessions store transcripts in event.input_transcription /
        # output_transcription — NOT in event.content.parts.  The Memory Bank
        # only reads content.parts.text, so we inject synthetic text events
        # from the collected transcripts before saving.
        if USE_MEMORY_BANK:
            try:
                session = await session_service.get_session(
                    app_name="fashionmind", user_id=user_id, session_id=session_id
                )
                if session and transcript_turns:
                    from google.adk.events import Event
                    now = time.time()
                    for i, (role, text) in enumerate(transcript_turns):
                        synthetic = Event(
                            invocation_id=session.id,
                            author=role,
                            content=types.Content(
                                role=role,
                                parts=[types.Part(text=text)],
                            ),
                        )
                        synthetic.id = f"memory-tx-{i}"
                        synthetic.timestamp = now + i * 0.001
                        session.events.append(synthetic)
                    logger.info(
                        f"Saving session to memory bank: {session_id} "
                        f"({len(transcript_turns)} transcript turns injected)"
                    )
                    await memory_service.add_session_to_memory(session)
                    logger.info(f"Memory saved successfully: {session_id}")
                elif session:
                    logger.info(f"No transcripts to save for {session_id}")
                else:
                    logger.warning(f"Session not found for memory save: {session_id}")
            except Exception as e:
                logger.error(f"Memory save on disconnect failed [{session_id}]: {e}")
        try:
            ui_notification_queue.put_nowait(None)
        except Exception:
            pass
        try:
            await ui_sender
        except Exception:
            pass
        logger.info(f"Session closed: {user_id}/{session_id}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        reload=False,
    )
