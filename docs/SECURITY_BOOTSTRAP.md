# Secure SYSTEM_OWNER bootstrap and account onboarding

KuKLA must never ship reusable administrator passwords in source control.

## Role model

- `SYSTEM_OWNER` is the first and highest-trust owner of an installation.
- `SUPERADMIN` is a delegated system administrator.
- `SUPERUSER` is retained as a compatibility role during the RBAC migration.
- `ADMIN`, `LEADER`, `COORDINATOR`, `SEARCHER`, and `VIEWER` are operational roles.

GitHub contributor permissions and KuKLA application permissions are independent. Being a project contributor must never grant a user a KuKLA system role.

## First installation

1. Apply all migrations with the server migration runner.
2. Do not restore old public seed credentials.
3. Call the one-time PostgreSQL function `kukla_bootstrap_system_owner(name,email,password)` from a trusted administrative database session, or use `infrastructure/scripts/bootstrap-owner.sh` after the local stack is ready.
4. Use a unique password of at least 12 characters.
5. Store credentials in the deployment's secret manager or password manager.
6. Verify that a second bootstrap attempt is rejected.

Example conceptually:

```sql
SELECT kukla_bootstrap_system_owner(
  'Installation Owner',
  'owner@example.invalid',
  'GENERATE-A-UNIQUE-SECRET-HERE'
);
```

Never commit real values to Git.

## Invite additional users

After the owner signs in, an authorized administrator can create a one-time invitation through `POST /api/v1/users/invitations`. The API returns a random token once; only its SHA-256 hash is stored. Deliver the token to the invitee through a trusted out-of-band channel. The invitee chooses a password with `POST /api/v1/auth/accept-invitation`. Invitations expire after 24 hours and can be revoked before acceptance.

The API does not send email or SMS. A temporary create/revoke/accept screen exists in the deprecated Tauri/React desktop client; the target Go/C and mobile clients do not yet have onboarding screens. Public self-registration should remain disabled. The inviter's role is checked when the invitation is issued and accepted. `SYSTEM_OWNER` cannot be assigned through an invitation; it is reserved for the one-time bootstrap process.

## Existing installations

Migration `005_rbac_bootstrap.sql` disables the legacy public seed account `admin@kukla.local` if it exists. Existing legitimate administrators must be migrated deliberately by an operator.

The manager-only membership endpoint prevents new self-joins, but older `search_members` rows do not record who granted access. Review existing operation rosters before exposing an upgraded database to real users.
