"""SGC (Servicio Geológico Colombiano) earthquake trigger poller module.

Polls the SGC five-day GeoJSON summary feed over HTTP (``httpx``) instead of a
WebSocket like the sibling ``trigger_emsc`` module. Quakes are filtered to the
configured Colombia box + minimum magnitude and each qualifying one opens a new
``events`` row (``event_id`` = the SGC feature ``id``), broadcasting an
``EVENT_OPENED`` alert to the dashboard WS. Fully opt-in via ``SGC_ENABLED``;
when disabled the poller is never started, so tests and demos carry zero
dependency on archive.sgc.gov.co. Both SGC and EMSC may run at once and
write ``EARTHQUAKE`` events, each deduplicated by their own source id.
"""