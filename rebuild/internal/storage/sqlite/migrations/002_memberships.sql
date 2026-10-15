CREATE TABLE search_members (
    search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (search_id, user_id)
) STRICT;
