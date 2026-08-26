# Production hardening checklist

- [ ] HTTPS/TLS and trusted certificates.
- [ ] Replace all demo passwords.
- [ ] Strong random POSTGRES_PASSWORD and JWT_SECRET.
- [ ] Firewall: expose only 22 and 443 as required.
- [ ] Automated daily database backup and off-host copy.
- [ ] Restore test at least monthly.
- [ ] Centralized logs and disk monitoring.
- [ ] Rate limiting and brute-force protection.
- [ ] Refresh-token rotation and device/session management.
- [ ] Push notifications.
- [ ] Background GPS policy reviewed for Android/iOS.
- [ ] Map tile/provider policy reviewed for operational use.
- [ ] Formal privacy/data-retention policy.
