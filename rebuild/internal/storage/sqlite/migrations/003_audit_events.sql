CREATE TABLE audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;
