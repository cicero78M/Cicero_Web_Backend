# Cicero Flow Metadata
*Last updated: 2026-02-16*

This document outlines the flow of data and the main database tables used by the Cicero_V2 system. It provides an overview from the initial onboarding steps through to reporting and notifications.

## 1. Initial Flow

1. **Client and User Setup**
   - Administrators log in through the dashboard and register new clients using the `/clients` API.
   - Users for each client are created via the `/users` API, imported from Google Sheets, or self-service through the claim credential flow (`/api/claim/*`).
2. **Authentication & Claim**
   - Users authenticate by calling `/api/auth/login`, `/api/auth/user-login`, or `/api/auth/dashboard-login` and receive a JWT token.
   - Operators without updated records now register claim credentials through `/api/claim/register` menggunakan NRP dan password kuat. Kredensial ini dipakai untuk akses `/api/claim/user-data` dan `/api/claim/update` tanpa OTP email.
   - The JWT token or HTTP-only cookie is included in subsequent API calls to authorize access.

## 2. Database Overview

Key tables defined in [`sql/schema.sql`](../sql/schema.sql):

| Table              | Purpose                                   |
|--------------------|-------------------------------------------|
| `clients`          | Stores client information and social media identifiers. |
| `user`             | Holds user profiles linked to a client.   |
| `dashboard_user` / `dashboard_user_clients` | Dashboard accounts and their permitted clients. |
| `insta_post` / `insta_post_khusus` | Instagram posts fetched via RapidAPI (regular & khusus). |
| `insta_like` / `insta_comment` | List of likes and comments for each Instagram post. |
| `insta_profile`             | Basic profile info for Instagram accounts. |
| `instagram_user`, `instagram_user_metrics`, `ig_ext_*` | Detailed Instagram profile, metrics, and extended RapidAPI data. |
| `tiktok_post` / `tiktok_post_roles` | TikTok posts associated with a client and role-based visibility. |
| `tiktok_comment`            | Comments for each TikTok post.            |
| `editorial_event`, `press_release_detail`, `approval_request`, `change_log` | Penmas editorial workflow entities. |
| `premium_request`           | Premium subscription applications.        |
| `link_report`, `link_report_khusus` | Amplification links from field agents. |
| `saved_contact`             | Google contact references used for WhatsApp messaging. |

These tables are updated regularly by scheduled jobs and form the basis for analytics and attendance calculations.

> Catatan pemisahan konteks: ingest post **tugas khusus** hanya disimpan ke `insta_post_khusus` (tanpa mirror ke `insta_post`) agar alur laporan rutin (`link_report`) dan khusus (`link_report_khusus`) tidak saling tercampur.

## 3. Process Flow

1. **Data Collection**
   - Cron jobs (`cronDirRequestFetchSosmed.js`, etc.) fetch posts, metrics, and rankings once the relevant WhatsApp client becomes ready. Results are saved to PostgreSQL and cached in Redis.
2. **Analytics & Attendance**
   - The backend matches likes or comments with registered users to compute attendance statistics and generates aggregator summaries for dashboards.
   - Editorial submissions persist to `editorial_event` and related tables, awaiting approvals captured through WhatsApp.
3. **Reporting & Messaging**
  - Cron tasks (`cronDirRequestFetchSosmed.js`, `cronRekapLink.js`, `cronAmplifyLinkMonthly.js`, etc.) send recaps to administrators through `waClient` or `waGatewayClient`.
   - Complaint confirmations are sent immediately via SMTP to reduce follow-up latency. Claim flow does not use OTP email.
4. **Queue Processing (Optional)**
   - Heavy operations can publish tasks to RabbitMQ with `rabbitMQService.js` and are processed asynchronously.

## 4. Final Output

Administrators receive automated WhatsApp reports summarizing daily engagement. The dashboard retrieves analytics via REST endpoints, giving a complete view of social media activity per client.

## 5. Timezone Decision for Daily Instagram Ingestion

- Seluruh boundary harian pada pipeline fetch Instagram diseragamkan ke **Asia/Jakarta (WIB)**.
- Implementasi di `src/handler/fetchpost/instaFetchPost.js` memakai helper tunggal `getJakartaDateString()` (`YYYY-MM-DD`) untuk:
  - seleksi shortcode harian (`getShortcodesToday`),
  - quarantine/hard-delete shortcode harian (`deleteShortcodes`),
  - query summary harian setelah proses fetch.
- Filter post “hari ini” (`isTodayJakarta`) tetap berbasis `Asia/Jakarta`, sehingga konsisten dengan boundary query select/delete di database.
- Keputusan ini menghindari ketergantungan pada timezone lokal server saat job berjalan mendekati pergantian hari (sekitar 00:00 WIB).


Refer to [docs/naming_conventions.md](naming_conventions.md) for code style guidelines.
