-- Preserve the existing application's ownership model when search-scoped
-- authorization is enabled. Every historical search created by a user must
-- keep its creator as a member so the creator does not lose access after the
-- authorization hardening.

INSERT INTO search_members(search_id, user_id)
SELECT s.id, s.created_by
FROM searches s
WHERE s.created_by IS NOT NULL
ON CONFLICT (search_id, user_id) DO NOTHING;
