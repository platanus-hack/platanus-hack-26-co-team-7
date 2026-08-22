# AGENTS.md

Replica — emergency communication network (Platanus Hack 26 Bogotá, team-7, track Emergencias). Currently **docs-only**: there is no application code, build system, package manifest, or CI yet. Do not invent build/test/lint commands; none exist.

## Read first

- `openspec/DECISIONS.md` — the decision log and the single most important file. Every architectural choice (radio layer, stack, protocol limits, rejected alternatives) is recorded there. Before proposing or implementing anything, check whether it was already discussed/rejected in that file.
- `openspec/architecture.md` — component map and boundaries (newest doc, may be uncommitted).
- `openspec/*.md` (`protocol.md`, `communication.md`, `ledger.md`, `storage.md`, `orphan-device.md`, `api.md`) — the full technical spec, one topic per file.

## Locked-in decisions (do not relitigate)

- **Nearby Connections lives on each phone, never on the backend.** The backend has no radios; it only receives HTTP from gateway nodes. Any design where "Backend → Nearby → phones" appears is wrong by definition.
- **Mobile stack:** React Native UI + Kotlin native modules in one APK via Expo *dev build*. **Expo Go will not work** (no custom native modules).
- **Backend:** FastAPI as a single process (ingesta, trigger engine, H3 aggregation, AI reports, WebSocket are internal modules — no inter-module HTTP calls, they share the DB/process). PostgreSQL server-side.
- **Web:** static public dashboard, MapLibre GL + deck.gl HexagonLayer over aggregated H3 cells (~500 m).
- Protocol is store-and-forward + gossip with a distributed ledger per node — explicitly **not** IP mesh routing (B.A.T.M.A.N., cjdns, etc.).

## Domain constants (used across specs)

Telegram = ~120-byte JSON, deduped by UUID v4 (`id` ≠ `user_id`; group by `event_id`). Node states: IDLE/ADVERTISING/SYNC/RELAY/ORPHAN; person states: EMERGENCY/NEED_HELP/SAFE (orthogonal to node states). Ledger: 24 h window, 5 MB LRU cap, TTL 8 hops. Max 3 concurrent connections/node. HMAC-SHA256 signing. SAFE verification uses `question_id` + `answer_hash` — plaintext answers never travel over the mesh.

## Privacy invariant

Raw coordinates and person identifiers (`sid`) must never appear on any public endpoint or be sent to the LLM. Public surface exposes only H3-aggregated data. The LLM narrates SQL-computed aggregates; it never computes figures.

## Conventions

- Project documentation and specs are written in **Spanish**; keep that register for these files.
- Git: conventional commits (`docs:`, `feat:` …). Current working branch: `feature/web-module`.
- Before submitting, `platanus-hack-project.jsonc` needs its `deploy-url` filled (currently a placeholder).
