"""WS /ws — anonymous broadcast channel (design D7).

Public single-channel notification endpoint. Accepts connections without
authentication; browser origins are validated against the configured CORS
origins. The socket only receives typed notification messages and is kept
open with a receive loop until the client disconnects (clean teardown in
``finally``).
"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not manager.origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)  # policy violation: untrusted origin
        return

    await manager.connect(websocket)
    try:
        while True:
            # Broadcast-only channel: client frames are read and ignored,
            # the loop doubles as liveness detection for clean disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
