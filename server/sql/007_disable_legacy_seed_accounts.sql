-- Existing installations may already contain the old development accounts.
-- Disable every known seeded identity so upgrading an existing database cannot
-- leave a public/default credential active.

UPDATE users
SET active = false
WHERE lower(email) IN (
  'admin@kukla.local',
  'leader@kukla.local',
  'coordinator@kukla.local',
  'searcher@kukla.local'
);
