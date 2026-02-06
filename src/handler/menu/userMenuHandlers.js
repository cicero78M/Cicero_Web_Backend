// src/handler/userMenuHandlers.js

import {
  sortTitleKeys,
  sortDivisionKeys,
  getGreeting,
} from "../../utils/utilsHelper.js";
import { saveContactIfNew } from "../../service/googleContactsService.js";
import { formatToWhatsAppId, normalizeWhatsappNumber } from "../../utils/waHelper.js";
import { appendSubmenuBackInstruction } from "./menuPromptHelpers.js";

// --- Helper Format Pesan ---
function formatUserReport(user) {
  const polresName = user.client_name || user.client_id || "-";
  return [
    "👤 *Identitas Anda*",
    "",
    `*Nama Polres*: ${polresName}`,
    `*Nama*     : ${user.nama || "-"}`,
    `*Pangkat*  : ${user.title || "-"}`,
    `*NRP/NIP*  : ${user.user_id || "-"}`,
    `*Satfung*  : ${user.divisi || "-"}`,
    `*Jabatan*  : ${user.jabatan || "-"}`,
    ...(user.ditbinmas ? [`*Desa Binaan* : ${user.desa || "-"}`] : []),
    `*Instagram*: ${user.insta ? "@" + user.insta.replace(/^@/, "") : "-"}`,
    `*TikTok*   : ${user.tiktok || "-"}`,
    `*Status*   : ${(user.status === true || user.status === "true") ? "🟢 AKTIF" : "🔴 NONAKTIF"}`,
  ].join("\n").trim();
}

function formatFieldList(showDesa = false) {
  return appendSubmenuBackInstruction(`
✏️ *Pilih field yang ingin diupdate:*
1. Nama
2. Pangkat
3. Satfung
4. Jabatan
5. Instagram
6. TikTok${showDesa ? "\n7. Desa Binaan" : ""}

Balas angka field di atas atau *batal* untuk keluar.
`.trim());
}


export const SESSION_CLOSED_MESSAGE =
  "Terima kasih. Sesi ditutup. Ketik *userrequest* untuk memulai lagi.";

export const closeSession = async (
  session,
  chatId,
  waClient,
  message = SESSION_CLOSED_MESSAGE
) => {
  session.exit = true;
  await waClient.sendMessage(chatId, message);
};



// ===== Handler utama usermenu =====
export const userMenuHandlers = {
  main: async (session, chatId, _text, waClient, _pool, userModel) => {
    const pengirim = normalizeWhatsappNumber(chatId);
    const userByWA = await userModel.findUserByWhatsApp(pengirim);

    if (userByWA) {
      session.isDitbinmas = !!userByWA.ditbinmas;
      const salam = getGreeting();
      if (session.identityConfirmed && session.user_id === userByWA.user_id) {
        const msgText = `${salam}, Bapak/Ibu\n${formatUserReport(
          userByWA
        )}\n\nApakah Anda ingin melakukan perubahan data?\nBalas *ya* jika ingin update data, *tidak* untuk keluar, atau *batal* untuk menutup sesi.`;
        session.step = "tanyaUpdateMyData";
        await waClient.sendMessage(chatId, msgText.trim());
        return;
      }
    const msgText = `
${salam}, Bapak/Ibu
${formatUserReport(userByWA)}

Apakah data di atas benar milik Anda?
Balas *ya* jika benar, *tidak* jika bukan, atau *batal* untuk menutup sesi.
`.trim();
      session.step = "confirmUserByWaIdentity";
      session.user_id = userByWA.user_id;
      await waClient.sendMessage(chatId, msgText);
      return;
    }

    session.step = "inputUserId";
    await waClient.sendMessage(
      chatId,
      [
        "Untuk menampilkan data Anda, silakan ketik NRP/NIP Anda (hanya angka).",
        "Ketik *batal* untuk keluar.",
        "",
        "Contoh:",
        "87020990",
      ].join("\n")
    );
  },

  // --- Konfirmasi identitas (lihat data)
  confirmUserByWaIdentity: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.identityConfirmed = true;
      session.step = "tanyaUpdateMyData";
      await waClient.sendMessage(
        chatId,
        "Apakah Anda ingin melakukan perubahan data?\nBalas *ya* jika ingin update data, *tidak* untuk keluar, atau *batal* untuk menutup sesi."
      );
    } else if (answer === "tidak") {
      await closeSession(session, chatId, waClient);
    } else if (answer === "batal") {
      await closeSession(session, chatId, waClient);
    } else {
      await waClient.sendMessage(
        chatId,
        "Jawaban tidak dikenali. Balas *ya* jika benar data Anda, *tidak* jika bukan, atau *batal* untuk menutup sesi."
      );
    }
  },

  // --- Konfirmasi identitas untuk update data
  confirmUserByWaUpdate: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.identityConfirmed = true;
      session.updateUserId = session.user_id;
      session.step = "updateAskField";
      await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      return;
    } else if (answer === "tidak") {
      await closeSession(session, chatId, waClient);
      return;
    } else if (answer === "batal") {
      await closeSession(session, chatId, waClient);
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Jawaban tidak dikenali. Balas *ya* jika benar data Anda, *tidak* jika bukan, atau *batal* untuk menutup sesi."
    );
  },

  // --- Input User ID manual
  inputUserId: async (session, chatId, text, waClient, pool, userModel) => {
    const lower = text.trim().toLowerCase();
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "✅ Menu ditutup. Terima kasih.");
      return;
    }
    if (lower === "userrequest") {
      await userMenuHandlers.main(session, chatId, "", waClient, pool, userModel);
      return;
    }
    const digits = text.replace(/\D/g, "");
    if (!digits) {
      await waClient.sendMessage(
        chatId,
        "❌ NRP/NIP harus berupa angka. Sistem otomatis menghapus karakter non-angka sehingga pastikan angka yang tersisa membentuk NRP/NIP yang benar.\nContoh: 87020990\nKetik *batal* untuk keluar."
      );
      return;
    }
    const minLength = 6;
    const maxLength = 18;
    if (digits.length < minLength || digits.length > maxLength) {
      await waClient.sendMessage(
        chatId,
        `❌ NRP/NIP harus terdiri dari ${minLength}-${maxLength} digit angka setelah karakter non-angka dibuang.\nContoh: 87020990\nKetik *batal* untuk keluar.`
      );
      return;
    }
    try {
      const user = await userModel.findUserById(digits);
      if (!user) {
        await waClient.sendMessage(
          chatId,
          `❌ NRP/NIP *${digits}* tidak ditemukan. Jika yakin benar, hubungi Opr Humas Polres Anda.`
        );
        await waClient.sendMessage(chatId, "Silakan masukkan NRP/NIP lain atau ketik *batal* untuk keluar.");
      } else {
        session.step = "confirmBindUser";
        session.bindUserId = digits;
        await waClient.sendMessage(
          chatId,
          `NRP/NIP *${digits}* ditemukan. Nomor WhatsApp ini belum terdaftar.\n` +
            "Apakah Anda ingin menghubungkannya dengan akun tersebut?\n" +
            "Balas *ya* untuk menghubungkan atau *tidak* untuk membatalkan."
        );
        return;
      }
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal mengambil data: ${err.message}`);
      await waClient.sendMessage(chatId, "Silakan masukkan NRP/NIP lain atau ketik *batal* untuk keluar.");
    }
  },

  confirmBindUser: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    const waNum = normalizeWhatsappNumber(chatId);
    if (answer === "ya") {
      const user_id = session.bindUserId;
      await userModel.updateUserField(user_id, "whatsapp", waNum);
      await saveContactIfNew(formatToWhatsAppId(waNum));
      const user = await userModel.findUserById(user_id);
      session.isDitbinmas = !!user.ditbinmas;
      await waClient.sendMessage(
        chatId,
        `✅ Nomor WhatsApp telah dihubungkan ke NRP/NIP *${user_id}*. Berikut datanya:\n` +
          formatUserReport(user)
      );
      session.identityConfirmed = true;
      session.user_id = user_id;
      session.step = "tanyaUpdateMyData";
      await waClient.sendMessage(
        chatId,
        "Apakah Anda ingin melakukan perubahan data?\nBalas *ya* jika ingin update data, *tidak* untuk keluar, atau *batal* untuk menutup sesi."
      );
      return;
    }
    if (answer === "tidak") {
      await waClient.sendMessage(
        chatId,
        "Nomor WhatsApp ini tetap tidak terhubung dengan NRP/NIP. Jika ingin mencoba lagi, ketik *userrequest* atau hubungi operator bila membutuhkan bantuan."
      );
      session.exit = true;
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Balas *ya* untuk menghubungkan nomor, atau *tidak* untuk membatalkan."
    );
  },

  confirmBindUpdate: async (session, chatId, text, waClient, pool, userModel) => {
    const ans = text.trim().toLowerCase();
    const waNum = normalizeWhatsappNumber(chatId);
    if (ans === "ya") {
      const nrp = session.updateUserId;
      await userModel.updateUserField(nrp, "whatsapp", waNum);
      await saveContactIfNew(formatToWhatsAppId(waNum));
      await waClient.sendMessage(chatId, `✅ Nomor berhasil dihubungkan ke NRP/NIP *${nrp}*.`);
      session.identityConfirmed = true;
      session.user_id = nrp;
      session.step = "updateAskField";
      await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      return;
    }
    if (ans === "tidak") {
      await waClient.sendMessage(
        chatId,
        "Nomor WhatsApp ini tidak dihubungkan ke NRP/NIP. Ketik *userrequest* untuk kembali ke menu atau hubungi operator bila membutuhkan bantuan."
      );
      session.exit = true;
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Balas *ya* untuk menghubungkan nomor, atau *tidak* untuk membatalkan."
    );
  },

  // --- Pilih field update
  updateAskField: async (session, chatId, text, waClient, pool, userModel) => {
    const allowedFields = [
      { key: "nama", label: "Nama" },
      { key: "pangkat", label: "Pangkat" },
      { key: "satfung", label: "Satfung" },
      { key: "jabatan", label: "Jabatan" },
      { key: "insta", label: "Instagram" },
      { key: "tiktok", label: "TikTok" },
    ];
    if (session.isDitbinmas) {
      allowedFields.push({ key: "desa", label: "Desa Binaan" });
    }

    const lower = text.trim().toLowerCase();
    const maxOption = allowedFields.length;
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "✅ Menu ditutup. Terima kasih.");
      return;
    }
    if (!new RegExp(`^[1-${maxOption}]$`).test(lower)) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan tidak valid. Balas dengan angka sesuai daftar (contoh: 1) atau ketik *batal* untuk keluar."
      );
      await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      return;
    }

    const idx = parseInt(lower) - 1;
    const field = allowedFields[idx].key;
    session.updateField = field;

    // Tampilkan list pangkat/satfung jika perlu
    if (field === "pangkat") {
      const titles = await userModel.getAvailableTitles();
      if (titles && titles.length) {
        const sorted = sortTitleKeys(titles, titles);
        let msgList = sorted
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n");
        // Simpan list pangkat di session agar bisa dipakai saat validasi
        session.availableTitles = sorted;
        await waClient.sendMessage(chatId, "Daftar pangkat yang dapat dipilih:\n" + msgList);
        await waClient.sendMessage(
          chatId,
          "Balas dengan angka dari daftar atau ketik nama pangkat persis. Ketik *batal* untuk membatalkan."
        );
      }
    }
    if (field === "satfung") {
      let clientId = null;
      try {
        const user = await userModel.findUserById(session.updateUserId);
        clientId = user?.client_id || null;
      } catch (e) { console.error(e); }
      const satfung = userModel.mergeStaticDivisions(
        await userModel.getAvailableSatfung(clientId)
      );
      if (satfung && satfung.length) {
        const sorted = sortDivisionKeys(satfung);
        let msgList = sorted.map((s, i) => `${i + 1}. ${s}`).join("\n");
        session.availableSatfung = sorted;
        await waClient.sendMessage(
          chatId,
          "Daftar satfung yang dapat dipilih:\n" + msgList
        );
        await waClient.sendMessage(
          chatId,
          "Balas dengan angka dari daftar atau ketik nama satfung persis. Ketik *batal* untuk membatalkan."
        );
      }
    }
    session.step = "updateAskValue";
    let extra = "";
    if (field === "pangkat") extra = " (pilih dari daftar pangkat)";
    else if (field === "satfung") extra = " (pilih dari daftar satfung)";
    else if (field === "insta")
      extra = " (masukkan link profil atau username Instagram)";
    else if (field === "tiktok")
      extra = " (masukkan link profil atau username TikTok)";

    await waClient.sendMessage(
      chatId,
      `Ketik nilai baru untuk field *${allowedFields[idx].label}*${extra}. Balas dengan angka atau nama pada daftar, atau ketik *batal* untuk membatalkan:`
    );
  },

  updateAskValue: async (session, chatId, text, waClient, pool, userModel) => {
    const lower = text.trim().toLowerCase();
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "Perubahan dibatalkan. Ketik *userrequest* untuk memulai lagi.");
      return;
    }
    const user_id = session.updateUserId;
    let field = session.updateField;
    let value = text.trim();

    // Normalisasi field DB
    if (field === "pangkat") field = "title";
    if (field === "satfung") field = "divisi";

    // Validasi khusus
    if (field === "title") {
      const titles = session.availableTitles || (await userModel.getAvailableTitles());
      const normalizedTitles = titles.map((t) => t.toUpperCase());
      if (/^\d+$/.test(value)) {
        const idx = parseInt(value) - 1;
        if (idx >= 0 && idx < titles.length) {
          value = titles[idx];
        } else {
          const msgList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
          await waClient.sendMessage(chatId, `❌ Pangkat tidak valid! Pilih sesuai daftar:\n${msgList}`);
          return;
        }
      } else if (!normalizedTitles.includes(value.toUpperCase())) {
        const msgList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
        await waClient.sendMessage(chatId, `❌ Pangkat tidak valid! Pilih sesuai daftar:\n${msgList}`);
        return;
      }
    }
    if (field === "divisi") {
      let clientId = null;
      try {
        const user = await userModel.findUserById(session.updateUserId);
        clientId = user?.client_id || null;
      } catch (e) { console.error(e); }
      const satfungList = userModel.mergeStaticDivisions(
        session.availableSatfung || (await userModel.getAvailableSatfung(clientId))
      );
      const normalizedSatfung = satfungList.map((s) => s.toUpperCase());
      if (/^\d+$/.test(value)) {
        const idx = parseInt(value, 10) - 1;
        if (idx >= 0 && idx < satfungList.length) {
          value = satfungList[idx];
        } else {
          const msgList = satfungList.map((s, i) => `${i + 1}. ${s}`).join("\n");
          await waClient.sendMessage(
            chatId,
            `❌ Satfung tidak valid! Pilih sesuai daftar:\n${msgList}`
          );
          return;
        }
      } else if (!normalizedSatfung.includes(value.toUpperCase())) {
        const msgList = satfungList.map((s, i) => `${i + 1}. ${s}`).join("\n");
        await waClient.sendMessage(
          chatId,
          `❌ Satfung tidak valid! Pilih sesuai daftar:\n${msgList}`
        );
        return;
      }
    }
    if (field === "insta") {
      const igMatch = value.match(
        /^(?:https?:\/\/(?:www\.)?instagram\.com\/)?@?([A-Za-z0-9._]+)\/?(?:\?.*)?$/i
      );
      if (!igMatch) {
        await waClient.sendMessage(
          chatId,
          "❌ Input Instagram tidak valid! Masukkan *link profil* atau *username Instagram* (contoh: https://www.instagram.com/username atau @username)"
        );
        return;
      }
      value = igMatch[1].toLowerCase();
      if (value === "cicero_devs") {
        await waClient.sendMessage(
          chatId,
          "❌ Instagram tersebut adalah milik Super Admin. Gunakan akun Instagram Anda sendiri."
        );
        return;
      }
      const existing = await userModel.findUserByInsta(value);
      if (existing && existing.user_id !== user_id) {
        await waClient.sendMessage(
          chatId,
          "❌ Akun Instagram tersebut sudah terdaftar pada pengguna lain."
        );
        return;
      }
    }
    if (field === "tiktok") {
      const ttMatch = value.match(
        /^(?:https?:\/\/(?:www\.)?tiktok\.com\/@)?@?([A-Za-z0-9._]+)\/?(?:\?.*)?$/i
      );
      if (!ttMatch) {
        await waClient.sendMessage(
          chatId,
          "❌ Input TikTok tidak valid! Masukkan *link profil* atau *username TikTok* (contoh: https://www.tiktok.com/@username atau @username)"
        );
        return;
      }
      value = ttMatch[1].toLowerCase();
      const existing = await userModel.findUserByTiktok(value);
      if (existing && existing.user_id !== user_id) {
        await waClient.sendMessage(
          chatId,
          "❌ Akun TikTok tersebut sudah terdaftar pada pengguna lain."
        );
        return;
      }
    }
    if (field === "whatsapp") value = normalizeWhatsappNumber(value);
    if (["nama", "title", "divisi", "jabatan", "desa"].includes(field)) value = value.toUpperCase();

    await userModel.updateUserField(user_id, field, value);
    if (field === "whatsapp" && value) {
      await saveContactIfNew(formatToWhatsAppId(value));
    }
    const displayValue =
      field === "insta" || field === "tiktok" ? `@${value}` : value;
    await waClient.sendMessage(
      chatId,
      `✅ Data *${
        field === "title"
          ? "pangkat"
          : field === "divisi"
          ? "satfung"
          : field === "desa"
          ? "desa binaan"
          : field
      }* untuk NRP ${user_id} berhasil diupdate menjadi *${displayValue}*.`
    );
    delete session.availableTitles;
    delete session.availableSatfung;
    await userMenuHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  tanyaUpdateMyData: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.step = "confirmUserByWaUpdate";
      await userMenuHandlers.confirmUserByWaUpdate(
        session,
        chatId,
        "ya",
        waClient,
        pool,
        userModel
      );
      return;
    } else if (answer === "tidak") {
      await closeSession(session, chatId, waClient);
      return;
    } else if (answer === "batal") {
      await closeSession(session, chatId, waClient);
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Balas *ya* jika ingin update data, *tidak* untuk kembali, atau *batal* untuk menutup sesi."
    );
  },
};
