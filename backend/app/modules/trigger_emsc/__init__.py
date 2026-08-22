"""EMSC near-real-time earthquake trigger listener module.

Subscribes to the EMSC standing-order WebSocket feed, filters quakes to the
configured Colombia box + minimum magnitude, and opens a new ``events`` row
(``event_id`` = the seismic ``unid``) broadcasting an ``EVENT_OPENED`` alert
to the dashboard WS. Fully opt-in via ``EMSC_ENABLED``; when disabled the
listener is never started, so tests and demos carry zero dependency on
seismicportal.eu.
"""