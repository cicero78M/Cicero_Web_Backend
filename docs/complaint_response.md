# Panduan Respon Komplain

> **Untuk Frontend Developers**: Jika Anda mengalami error 403 atau ingin mengintegrasikan endpoint komplain, lihat panduan lengkap di [frontend_complaint_api_guide.md](./frontend_complaint_api_guide.md) yang mencakup solusi troubleshooting, contoh implementasi, dan penjelasan detail tentang authentication.

Modul `respondComplaint` menyampaikan langkah tindak lanjut kepada pelapor saat laporan aktivitas media sosial belum tercatat. Ringkasan panduan yang dikirim ke pelapor menekankan pengecekan kembali likes Instagram dan komentar TikTok.

## Langkah verifikasi yang dikirim
- Pastikan aksi dilakukan dengan akun yang tercatat di Cicero.
- Lampirkan tautan konten beserta waktu pelaksanaan untuk pengecekan.
- Gunakan menu **Absensi Likes Instagram** atau **Absensi Komentar TikTok** di dashboard Cicero, pilih ulang satker dan periode, lalu tekan **Refresh** untuk memuat data terbaru.
- Jika data masih belum tercatat setelah sinkronisasi sekitar satu jam, kirim bukti tangkapan layar dan eskalasi ke operator piket.

Catatan: Narasi lama yang menyebut "Absensi Amplifikasi" sudah diganti agar selaras dengan terminologi likes/komentar di Instagram dan TikTok.

## Perilaku sesi setelah respon
- Setelah pesan komplain dibalas dan ringkasan admin dikirim, sesi menu *Client Request* ditutup otomatis.
- Penutupan sesi mencegah pengiriman ulang pesan menu utama seperti:
  ```
  ┏━━━ *MENU CLIENT CICERO* ━━━
  1️⃣ Manajemen Client & User
  2️⃣ Operasional Media Sosial
  3️⃣ Transfer & Laporan
  4️⃣ Administratif
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Ketik *angka* menu, atau *batal* untuk keluar.
  ```
- Admin dapat membuka kembali menu dengan perintah `clientrequest` bila diperlukan.

## API respon komplain
Endpoint komplain dipakai untuk menghasilkan diagnosis dan teks tindak lanjut yang ditampilkan di dashboard.

**Endpoint**
- `POST /api/dashboard/komplain/insta`
- `POST /api/tiktok/komplain`

**Header**
- Untuk Instagram: gunakan token login dashboard (`POST /api/auth/dashboard-login`).
- Untuk TikTok: gunakan token login dashboard atau token client (`POST /api/auth/login`).
- Kirim token sebagai `Authorization: Bearer <token>` atau simpan pada cookie `token`.
- Jika memakai token client, akses hanya diizinkan untuk personel dengan `client_id` yang sama.

**Payload minimal**
```json
{
  "nrp": "75020201",
  "issue": "Sudah melaksanakan Instagram belum terdata.",
  "solution": "Mohon cek kembali data like di dashboard dan kirim bukti jika masih belum tercatat."
}
```

Field `issue`/`solution` boleh diganti dengan `kendala`, `solusi`, atau `tindak_lanjut`. Jika tidak diisi, sistem akan menyusun diagnosis, kendala, dan solusi otomatis dengan modul `complaintService`. Anda dapat mengirimkan `message`/`pesan` berisi format *Pesan Komplain* agar sistem mengekstrak daftar kendala dan menghasilkan solusi otomatis sesuai akun Instagram/TikTok pelapor. Respons API mengembalikan diagnosis dan teks tindak lanjut untuk ditampilkan di dashboard; endpoint tidak memiliki kontrak pengiriman pesan.

**Format payload**
```json
{
  "nrp": "75020201",
  "issue": "Sudah melaksanakan Instagram belum terdata.",
  "solution": "Mohon cek kembali data like di dashboard dan kirim bukti jika masih belum tercatat.",
  "message": "Pesan Komplain\\nNRP: 75020201\\nNama: Nama Pelapor\\nUsername IG: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata.",
  "instagram": "@username",
  "tiktok": "@username",
  "complaint": "Isi komplain mentah (opsional)."
}
```

Keterangan:
- `nrp` **wajib** diisi dengan NRP/NIP personel yang terdaftar.
- `issue`/`solution` **opsional**. Jika kosong, sistem akan menggunakan fallback berdasarkan platform dan status akun.
- `message`/`pesan`/`complaint`/`raw`/`text` **opsional** untuk menyuplai format *Pesan Komplain* agar parser mengekstrak `nrp`, `nama`, `polres`, `instagram`, `tiktok`, dan daftar kendala otomatis.
- `instagram`/`insta`/`username_ig`/`username_instagram` dan `tiktok`/`username_tiktok` **opsional** sebagai fallback bila handle tidak tercantum di pesan.

**Payload komplain otomatis**
```json
{
  "nrp": "75020201",
  "message": "Pesan Komplain\\nNRP: 75020201\\nNama: Nama Pelapor\\nUsername IG: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata."
}
```

## Response diagnosis

Response berisi diagnosis dan teks tindak lanjut yang siap ditampilkan oleh frontend di dashboard.

**Contoh response (ringkas)**
```json
{
  "success": true,
  "data": {
    "platform": "Instagram",
    "message": "Selamat pagi! Kami menindaklanjuti laporan yang Anda sampaikan.\\n\\n*Pelapor*: Nama Pelapor\\n\\n*NRP/NIP*: 75020201\\n\\n*Kendala*:\\n- Sudah melaksanakan Instagram belum terdata.\\n\\n*Solusi/Tindak Lanjut*:\\n1) Pastikan like dan komentar dilakukan menggunakan akun yang tercatat (Instagram: @username).\\n2) Pastikan sudah mengisi absensi likes Instagram di dashboard.",
    "issue": "Pesan Komplain\\nNRP/NIP: 75020201\\nNama: Nama Pelapor\\nInstagram: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata.",
    "solution": "1) Pastikan like dan komentar dilakukan menggunakan akun yang tercatat (Instagram: @username).\\n2) Pastikan sudah mengisi absensi likes Instagram di dashboard.",
    "reporter": {
      "nrp": "75020201",
      "name": "Nama Pelapor",
      "whatsapp": "6281234567890",
      "email": "pelapor@example.com"
    }
  }
}
```
