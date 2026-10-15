CREATE TABLE searches (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
    area TEXT,
    description TEXT,
    incident_lat REAL CHECK (incident_lat IS NULL OR incident_lat BETWEEN -90 AND 90),
    incident_lng REAL CHECK (incident_lng IS NULL OR incident_lng BETWEEN -180 AND 180),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
) STRICT;
