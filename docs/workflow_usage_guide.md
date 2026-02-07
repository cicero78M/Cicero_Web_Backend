# Panduan Lengkap Penggunaan Cicero_V2
*Last updated: 2026-02-07*

Dokumen ini menjelaskan alur fungsi utama dan langkah penggunaan aplikasi **Cicero_V2**. Backend ini berjalan bersama dashboard Next.js (lihat repository `Cicero_Web`).

## 1. Persiapan Lingkungan

1. Install Node.js 20 dan PostgreSQL.
2. Jalankan `npm install` untuk mengunduh dependensi (butuh koneksi internet).
3. Salin file `.env.example` menjadi `.env` dan sesuaikan variabel berikut:
   - `PORT`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `REDIS_URL`, dll.
4. Import skema database dari `sql/schema.sql` ke PostgreSQL.
5. Pastikan Redis dan RabbitMQ (opsional) sudah aktif.

## 2. Menjalankan Aplikasi

```bash
npm start        # menjalankan server produksi
npm run dev      # menjalankan dengan nodemon (hot reload untuk kode saja)
```
Server Express akan aktif di port yang ditentukan dan memuat semua route API serta jadwal cron.
Hot reload hanya memantau kode (`app.js` dan folder `src`). Folder data seperti `laphar/`, `logs/`, dan file `*.txt`/`*.csv` diabaikan agar tidak memicu restart saat proses impor data berjalan.

## 3. Alur Pekerjaan Backend

1. **Autentikasi** – Endpoint `/api/auth/login` memberikan JWT. Token dipakai pada seluruh request berikutnya.
2. **Pengambilan Data** – Cron harian di `src/cron` mengambil postingan Instagram/TikTok, menyimpan like & komentar, lalu menganalisis hashtag.
3. **Penyimpanan** – Data tersimpan di tabel PostgreSQL seperti `insta_post`, `insta_like`, `tiktok_post`, dll. Struktur lengkap ada di `docs/database_structure.md`.
4. **Notifikasi** – Modul `waService.js` mengirim laporan harian dan pengingat via WhatsApp sesuai jadwal pada `docs/activity_schedule.md`.
5. **Antrian (opsional)** – Tugas berat dapat dikirim ke RabbitMQ melalui `publishToQueue` di `src/service/rabbitMQService.js`.

## 4. Fitur WhatsApp Bot

Bot WhatsApp menyediakan beberapa perintah untuk operator dan pengguna:
- `oprrequest` → mengelola data user, rekap link harian, serta **Menu Manajemen Engagement** untuk absensi Likes Instagram/Komentar TikTok sesuai status aktif akun client. Laporan absensi engagement pada mode akumulasi kini dikelompokkan per satfung dengan sub-list **lengkap/kurang/belum**. Operator/Super Admin client dapat masuk langsung, sedangkan Admin WhatsApp wajib memilih client bertipe **org** sebelum masuk menu operator. Submenu **Absensi registrasi user** dan **Absensi update data username** berada di *Kelola User* dan seluruh submenu menampilkan instruksi **ketik back** untuk kembali. Detail pada `docs/wa_operator_request.md`.
- `userrequest` → registrasi dan pengelolaan data user. Lihat `docs/wa_user_registration.md`.
- *Bulk Penghapusan Status User* menggunakan format pesan
  `Permohonan Penghapusan Data Personil – <SATKER>` yang berisi daftar ber-
  nomor `Nama – NRP/NIP – Alasan`. Bot menonaktifkan status, mengosongkan
  WhatsApp, dan mengirim ringkasan sukses/gagal. Header dengan penebalan
  (mis. `📄 **Permohonan ...**`) kini juga dikenali sebagai ringkasan balasan
  bot sehingga tidak diproses ulang jika pesan tersebut dikirim kembali. Jika
  format kosong, header tidak sesuai, atau daftar personel tidak ditemukan, bot
  mengirim pesan penjelasan lalu menutup sesi agar pengguna kembali ke menu
  utama.
- Normalisasi pesan (lowercase dan trim) dilakukan di awal fungsi `processMessage`
  agar seluruh percabangan—termasuk perintah `batal` di menu interaktif—selalu
  menggunakan teks yang sudah stabil tanpa memicu `ReferenceError`.

Sistem menjalankan *dua* nomor WhatsApp:
1. **Nomor utama** menangani seluruh perintah bot seperti `oprrequest`, `dashrequest`, dan lainnya.
2. **Nomor kedua** khusus untuk perintah `userrequest` (registrasi dan pemutakhiran data user).

### Konfigurasi Environment
Tambahkan variabel berikut pada `.env` untuk mengatur sesi WhatsApp:

```
# ID sesi untuk WhatsApp client (default: wa-admin)
APP_SESSION_NAME=wa-admin

# Lokasi folder sesi Baileys auth (opsional, harus writable oleh runtime user)
WA_AUTH_DATA_PATH=/var/lib/cicero/wa-sessions

# Hapus sesi sebelum re-init ketika auth gagal/logged out (opsional)
WA_AUTH_CLEAR_SESSION_ON_REINIT=false

# Enable debug logging untuk troubleshooting (opsional)
WA_DEBUG_LOGGING=false

```

**Catatan**: Variabel `WA_WEB_VERSION_CACHE_URL`, `WA_WEB_VERSION`, `WA_WEB_VERSION_RECOMMENDED`, dan timeout Puppeteer yang disebutkan di atas adalah **legacy configuration** dari implementasi wwebjs sebelumnya dan tidak lagi digunakan. Sistem sekarang menggunakan Baileys yang tidak memerlukan konfigurasi browser/cache.

### Langkah Login
1. Jalankan `npm run dev` atau `npm start`.
2. Terminal menampilkan QR code dengan prefix `[BAILEYS]` untuk autentikasi WhatsApp.
3. Pindai QR code tersebut dengan aplikasi WhatsApp mobile Anda.
4. Setelah dipindai, sesi akan tersimpan di folder `~/.cicero/baileys_auth/` (atau `WA_AUTH_DATA_PATH` jika di-set). Pastikan folder tersebut writable oleh runtime user.
5. Saat terjadi `auth_failure` atau disconnection, adapter akan otomatis melakukan reinisialisasi dengan logging yang jelas.
6. Untuk troubleshooting, aktifkan `WA_DEBUG_LOGGING=true` untuk mendapatkan log detail dari Baileys adapter.

Pengguna cukup menyimpan nomor bot yang sesuai, mengirim perintah `userrequest`, lalu mengikuti instruksi balasan.

## 5. Akses Dashboard

Dashboard Next.js (`Cicero_Web`) menggunakan variabel `NEXT_PUBLIC_API_URL` untuk terhubung ke backend. Fitur utama di dashboard:
1. Login dengan nomor WhatsApp dan `client_id`.
2. Melihat statistik Instagram/TikTok pada halaman analytics.
3. Mengelola data client dan user melalui antarmuka atau endpoint REST.

Catatan: untuk role **operator**, endpoint statistik dashboard selalu menggunakan `client_id` dari sesi pengguna. Parameter `client_id` dari query string atau header akan diabaikan, dan permintaan ditolak jika sesi tidak memiliki `client_id`.

## 6. Tips Penggunaan

- Jalankan `npm run lint` dan `npm test` sebelum melakukan commit.
- Monitor cron job pada jam yang tercantum di `docs/activity_schedule.md`.
- Gunakan Redis agar permintaan tidak duplikat (`dedupRequestMiddleware.js`).
- Cadangkan database secara rutin (lihat `docs/pg_backup_gdrive.md`).

Dokumen lain seperti `enterprise_architecture.md`, `business_process.md`, dan `metadata_flow.md` dapat dijadikan referensi untuk memahami detail alur data.
