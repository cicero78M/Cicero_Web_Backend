# RBAC Matrix Draft (Initial)

## Legend
- ✅ allowed
- 🔒 denied
- ⚠ conditional (scope/regional/ownership)

## Endpoint Group vs Role (draft)

| Endpoint Group | operator | ditbinmas | bidhumas | ditsamapta | ditlantas | admin-system |
|---|---|---|---|---|---|---|
| /api/users | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /api/user_roles | 🔒 | ✅ | ✅ | ✅ | ✅ | ✅ |
| /api/dashboard | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /api/likes | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /api/amplify | ⚠ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /api/premium* | 🔒 | ⚠ | ⚠ | ⚠ | ⚠ | ✅ |
| /api/admin-system/* | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |

## Next Action
1. Sinkronkan matrix ini dengan implementasi middleware aktual per route.
2. Tambahkan test table-driven untuk semua kombinasi role x endpoint kritis.
3. Dokumentasikan scope enforcement (`ORG` vs `DIREKTORAT` + `regional_id`).
