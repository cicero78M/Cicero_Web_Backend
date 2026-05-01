# Audit Execution Plan (30/60/90)

## Tujuan
Meningkatkan maintainability backend, konsistensi akses role/scope, dan reliability operasional.

## Prioritas 0 (minggu ini)
1. Aktifkan quality gate CI (lint + test).
2. Petakan endpoint kritis + role matrix.
3. Freeze perubahan besar di file berisiko (`clientRequestHandlers.js`) selain bugfix prioritas.

## 30 Hari (Stabilisasi)
- Pecah `src/handler/menu/clientRequestHandlers.js` menjadi modul per domain:
  - auth/menu
  - absensi
  - engagement
  - complaint
- Introduce service boundary: handler -> service -> repository.
- Tambah integration smoke test untuk auth, users, dashboard, premium.

## 60 Hari (Standardisasi)
- Standarisasi response/error envelope semua controller.
- RBAC matrix formal (role x scope x endpoint) + test table-driven.
- Correlation ID middleware + structured log JSON.

## 90 Hari (Skalabilitas)
- Queue governance (retry/backoff/DLQ/alert).
- Audit trail mutasi data kritis (user, role, premium, approval).
- Query performance review + index tuning endpoint hot-path.

## KPI
- File > 1500 LOC berkurang signifikan
- Incident auth/akses turun >= 50%
- Test reliability tinggi (flaky test < 2%)
- API error observability lengkap (>= 95% endpoint punya code standar)
