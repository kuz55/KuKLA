# Secure SYSTEM_OWNER / SUPERADMIN bootstrap

KuKLA must never ship a reusable administrator password in source control.

## Role model

- `SYSTEM_OWNER` is the first and highest-trust owner of an installation.
- `SUPERADMIN` is a delegated system administrator.
- `SUPERUSER` is retained as a compatibility role during the RBAC migration.
- `ADMIN`, `LEADER`, `COORDINATOR`, `SEARCHER`, and `VIEWER` remain operational roles.

GitHub contributor permissions and KuKLA application permissions are independent. Being a project contributor must never grant a user a KuKLA system role.

## First installation

1. Apply migrations through `005_rbac_bootstrap.sql`.
2. Do not restore the old public seed credentials.
3. Call the one-time PostgreSQL function `kukla_bootstrap_system_owner(name,email,password)` from a trusted administrative database session.
4. Use a unique password of at least 12 characters.
5. Store the credentials in the deployment's secret manager or password manager.
6. Verify that a second bootstrap attempt is rejected.

Example conceptually:

```sql
SELECT kukla_bootstrap_system_owner(
  'Installation Owner',
  'owner@example.invalid',
  'GENERATE-A-UNIQUE-SECRET-HERE'
);
```

Never commit the real values above to Git.

## Existing installations

Migration `005_rbac_bootstrap.sql` disables the legacy public seed account `admin@kukla.local` if it exists. Existing legitimate administrators must be migrated deliberately by an operator.

## Application requirement

The server authorization layer must recognize `SYSTEM_OWNER` and `SUPERADMIN` explicitly before these roles are exposed to normal users. Until that application-layer migration is complete, `SUPERUSER` remains the compatibility authorization role.

The bootstrap function is intentionally one-time and cannot be called by ordinary application users.
