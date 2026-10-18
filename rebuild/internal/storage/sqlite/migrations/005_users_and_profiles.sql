CREATE TABLE app_users (
    id TEXT PRIMARY KEY NOT NULL,
    phone TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN (
        'SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER', 'ADMIN',
        'LEADER', 'COORDINATOR', 'SEARCHER', 'VIEWER'
    )),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
) STRICT;

-- This is a device-local technical identity, not a verified phone account.
INSERT INTO app_users(id, role, active, created_at)
VALUES ('local-installation', 'SEARCHER', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL DEFAULT '',
    birth_date TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    extra_phone TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json)),
    has_transport INTEGER NOT NULL DEFAULT 0 CHECK (has_transport IN (0, 1)),
    available_for_searches INTEGER NOT NULL DEFAULT 1 CHECK (available_for_searches IN (0, 1)),
    emergency_contact_name TEXT NOT NULL DEFAULT '',
    emergency_contact_phone TEXT NOT NULL DEFAULT '',
    consent_personal_data INTEGER NOT NULL DEFAULT 0 CHECK (consent_personal_data IN (0, 1)),
    verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    updated_at TEXT NOT NULL
) STRICT;
