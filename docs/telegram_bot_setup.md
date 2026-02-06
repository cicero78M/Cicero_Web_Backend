# Telegram Bot untuk Approval Dashboard User

## Overview

Sistem approval dashboard user telah diperbarui untuk menggunakan Telegram Bot sebagai metode utama. Mekanisme WhatsApp bot sebelumnya masih didukung sebagai fallback tetapi **sudah deprecated** dan akan dihapus di versi mendatang.

## Konfigurasi

### 1. Buat Telegram Bot

1. Buka [@BotFather](https://t.me/BotFather) di Telegram
2. Kirim perintah `/newbot`
3. Ikuti instruksi untuk memberi nama dan username bot
4. Simpan token yang diberikan oleh BotFather

### 2. Dapatkan Chat ID Admin

1. Buka bot yang baru dibuat
2. Kirim pesan `/start` ke bot
3. Buka URL ini di browser (ganti `<BOT_TOKEN>` dengan token bot Anda):
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```
4. Cari field `"chat":{"id":...}` - ini adalah Chat ID Anda

### 3. Konfigurasi Environment Variables

Tambahkan variabel berikut di file `.env`:

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_CHAT_ID=123456789
```

## Cara Penggunaan

### Approval Request Baru

Ketika ada registrasi dashboard user baru:

1. **Notifikasi Telegram** (Primary): Admin akan menerima pesan di Telegram berisi:
   - Username
   - ID pengguna
   - Role
   - WhatsApp
   - Client ID
   - Perintah untuk approve/deny

2. **Notifikasi WhatsApp** (Deprecated Fallback): Jika Telegram tidak dikonfigurasi, notifikasi akan dikirim via WhatsApp dengan warning deprecation.

### Perintah Approval

#### Via Telegram (Rekomendasi)

```
/approve <username>   - Menyetujui registrasi user
/deny <username>      - Menolak registrasi user
```

Contoh:
```
/approve johndoe
/deny janedoe
```

#### Via WhatsApp (Deprecated)

```
approvedash#<username>   - Menyetujui registrasi user
denydash#<username>      - Menolak registrasi user
```

**⚠️ WARNING**: Mekanisme approval via WhatsApp akan segera dihapus. Gunakan Telegram bot.

## Fitur Bot

### Perintah yang Tersedia

- `/start` - Menampilkan pesan selamat datang dan daftar perintah
- `/approve <username>` - Menyetujui registrasi dashboard user
- `/deny <username>` - Menolak registrasi dashboard user

### Keamanan

- Hanya chat ID yang terdaftar di `TELEGRAM_ADMIN_CHAT_ID` yang dapat menjalankan perintah approval
- Perintah dari chat ID lain akan ditolak dengan pesan error

### Notifikasi Otomatis

Setelah approval/denial:
- Admin mendapat konfirmasi di Telegram
- User mendapat notifikasi melalui WhatsApp (jika nomor terdaftar)

## Migrasi dari WhatsApp

### Langkah Migrasi

1. Setup Telegram bot sesuai petunjuk di atas
2. Set environment variables `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_ADMIN_CHAT_ID`
3. Restart aplikasi
4. Test dengan registrasi user baru - notifikasi akan dikirim ke Telegram
5. Informasikan admin untuk menggunakan perintah Telegram (`/approve`, `/deny`)

### Backward Compatibility

- Perintah WhatsApp (`approvedash#`, `denydash#`) masih berfungsi
- Setiap penggunaan perintah WhatsApp akan menampilkan warning deprecation
- Notifikasi WhatsApp akan tetap dikirim jika Telegram tidak dikonfigurasi

### Timeline Deprecation

- **v1.0** (Sekarang): Telegram sebagai primary, WhatsApp deprecated
- **v2.0** (Upcoming): WhatsApp approval commands akan dihapus

## Troubleshooting

### Bot tidak merespon

1. Pastikan `TELEGRAM_BOT_TOKEN` sudah benar
2. Pastikan bot sudah di-start dengan `/start` command
3. Cek log aplikasi untuk error

### Perintah approval ditolak

1. Pastikan `TELEGRAM_ADMIN_CHAT_ID` sesuai dengan chat ID Anda
2. Chat ID bisa berbeda untuk personal chat vs group chat
3. Gunakan `getUpdates` API untuk verifikasi chat ID

### Notifikasi tidak diterima

1. Pastikan aplikasi sudah di-restart setelah set environment variables
2. Cek log aplikasi:
   ```
   [TELEGRAM] Telegram bot initialized successfully
   ```
3. Test dengan registrasi user baru

### Polling Error: EFATAL: AggregateError

Error ini biasanya terjadi karena:

1. **Multiple bot instances**: Ada beberapa instance aplikasi yang mencoba polling bot yang sama secara bersamaan
   - **Solusi**: Pastikan hanya ada satu instance aplikasi yang berjalan
   - Cek dengan `pm2 list` atau `ps aux | grep node`
   - Stop instance duplikat dengan `pm2 stop <id>` atau `kill <pid>`

2. **Invalid bot token**: Token bot tidak valid atau telah dicabut
   - **Solusi**: Verifikasi token di [@BotFather](https://t.me/BotFather)
   - Generate token baru jika perlu dan update `.env`

3. **Network connectivity**: Masalah koneksi ke server Telegram
   - **Solusi**: Cek koneksi internet dan firewall
   - Test koneksi: `curl https://api.telegram.org/bot<TOKEN>/getMe`

4. **Rate limiting**: Terlalu banyak request ke Telegram API
   - **Solusi**: Bot akan otomatis berhenti setelah 5 error berturut-turut
   - Tunggu beberapa menit, kemudian restart aplikasi

#### Fitur Auto-Recovery

Bot sekarang dilengkapi dengan mekanisme auto-recovery:
- Tracking jumlah polling error
- Automatic shutdown setelah 5 error berturut-turut untuk mencegah spam log
- Log yang informatif untuk diagnosis masalah
- Status bot dapat dicek melalui `getBotStatus()` function

Jika bot berhenti karena terlalu banyak error, log akan menampilkan:
```
[TELEGRAM] Polling error #5: EFATAL
[TELEGRAM] Fatal polling error detected: ...
[TELEGRAM] Too many polling errors (5). Stopping polling to prevent continuous failures.
[TELEGRAM] Please check: 1) Bot token is valid, 2) No other bot instance is running, 3) Network connectivity
[TELEGRAM] Polling stopped successfully
```

Setelah memperbaiki masalah, restart aplikasi untuk mengaktifkan kembali bot.

## Contoh Log

### Sukses
```
[TELEGRAM] Telegram bot initialized successfully
[TELEGRAM] Approval request sent for johndoe
✅ User johndoe telah disetujui.
```

### Bot Tidak Dikonfigurasi
```
[TELEGRAM] Telegram bot is disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to enable.
[DEPRECATED] Using WhatsApp approval mechanism. Please configure Telegram bot.
```

## Support

Untuk pertanyaan atau masalah, silakan buat issue di GitHub repository.
