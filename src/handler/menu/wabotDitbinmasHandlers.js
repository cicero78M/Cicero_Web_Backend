import { clearSession } from "../../utils/sessionsHelper.js";
import * as cronJobConfigService from "../../service/cronJobConfigService.js";
import { appendSubmenuBackInstruction } from "./menuPromptHelpers.js";

const MAIN_MENU_MESSAGE = `┏━━━ *MENU WABOT DITBINMAS* ━━━
1️⃣ User Summary
2️⃣ Insta Summary
3️⃣ TikTok Summary
4️⃣ Config Cron Job
0️⃣ Keluar dari menu
┗━━━━━━━━━━━━━━━━━━━━━━━━━━
Ketik *angka menu* atau *batal* untuk keluar.`;

const SUB_MENU_OPTIONS = {
  userSummary: {
    title: "User Summary",
    responses: {
      1: "📈 *User Summary - Excel Data*\nLaporan Excel siap dibagikan kepada pimpinan.",
      2: "📊 *User Summary - Chart*\nGrafik rekap akan dikirim sesuai permintaan.",
      3: "📝 *User Summary - Narasi*\nNarasi ringkas disiapkan untuk laporan cepat.",
    },
  },
  instaSummary: {
    title: "Insta Summary",
    responses: {
      1: "📈 *Insta Summary - Excel Data*\nFile Excel performa Instagram akan tersedia.",
      2: "📊 *Insta Summary - Chart*\nVisualisasi capaian Instagram segera dikirim.",
      3: "📝 *Insta Summary - Narasi*\nNarasi performa Instagram disiapkan otomatis.",
    },
  },
  tiktokSummary: {
    title: "TikTok Summary",
    responses: {
      1: "📈 *TikTok Summary - Excel Data*\nData Excel TikTok akan dibagikan.",
      2: "📊 *TikTok Summary - Chart*\nGrafik perkembangan TikTok siap dikirim.",
      3: "📝 *TikTok Summary - Narasi*\nNarasi performa TikTok akan dirangkum.",
    },
  },
};

function buildSubMenuMessage(title) {
  return appendSubmenuBackInstruction(
    `*${title}*\n` +
      "1️⃣ Excel Data\n" +
      "2️⃣ Chart\n" +
      "3️⃣ Narasi\n" +
      "0️⃣ Kembali ke menu utama\n\n" +
      "Ketik angka menu atau *batal* untuk keluar."
  );
}

function handleSubMenuFactory(key) {
  const config = SUB_MENU_OPTIONS[key];
  return async function subMenuHandler(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    if (!choice) {
      session.step = `${key}_menu`;
      session.time = Date.now();
      await waClient.sendMessage(chatId, buildSubMenuMessage(config.title));
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      session.step = "main";
      session.time = Date.now();
      await wabotDitbinmasHandlers.main(session, chatId, "", waClient);
      return;
    }

    if (!["1", "2", "3"].includes(choice)) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Ketik angka menu yang tersedia.");
      await subMenuHandler(session, chatId, "", waClient);
      return;
    }

    const response = config.responses[choice];
    await waClient.sendMessage(chatId, response);
    session.time = Date.now();
    await subMenuHandler(session, chatId, "", waClient);
  };
}

function buildCronJobListMessage(jobs) {
  if (!jobs.length) {
    return appendSubmenuBackInstruction(
      "*⚙️ Konfigurasi Cron Job*\n" +
        "Belum ada cron job yang terdaftar.\n" +
        "0️⃣ Kembali ke menu utama\n" +
        "Ketik angka menu atau *batal* untuk keluar."
    );
  }

  const list = jobs
    .map((job, index) => {
      const statusText = job.is_active ? "✅ Aktif" : "❌ Nonaktif";
      const name = job.display_name || job.job_key;
      return `${index + 1}️⃣ ${name}\n   • Kode: ${job.job_key}\n   • Status: ${statusText}`;
    })
    .join("\n\n");

  return appendSubmenuBackInstruction(
    "*⚙️ Konfigurasi Cron Job*\n" +
      "Berikut daftar cron job yang tersedia:\n\n" +
      `${list}\n\n` +
      "Balas dengan nomor cron job untuk mengatur statusnya.\n" +
      "0️⃣ Kembali ke menu utama\n" +
      "Ketik *batal* kapan saja untuk keluar."
  );
}

function buildCronJobActionMessage(job) {
  const statusText = job.is_active ? "✅ Aktif" : "❌ Nonaktif";
  const name = job.display_name || job.job_key;
  return appendSubmenuBackInstruction(
    `*⚙️ Atur Cron Job: ${name}*\n` +
      `Kode: ${job.job_key}\n` +
      `Status saat ini: ${statusText}\n\n` +
      "Pilih aksi:\n" +
      "1️⃣ Aktifkan cron job\n" +
      "2️⃣ Nonaktifkan cron job\n" +
      "0️⃣ Kembali ke daftar cron job\n" +
      "Ketik *menu* untuk kembali ke menu utama atau *batal* untuk keluar."
  );
}

function buildCronJobConfirmationMessage(job, nextStatus) {
  const name = job.display_name || job.job_key;
  const statusText = nextStatus ? "Aktif" : "Nonaktif";
  return appendSubmenuBackInstruction(
    `Anda akan mengubah status cron job *${name}* (${job.job_key}) menjadi *${statusText}*.\n` +
      "Balas *YA* untuk konfirmasi atau ketik *0* untuk kembali memilih aksi.\n" +
      "Ketik *menu* untuk kembali ke menu utama atau *batal* untuk keluar."
  );
}

function findSelectedJob(session) {
  const cronSession = session.cronConfig;
  if (!cronSession?.selectedJobKey) {
    return null;
  }
  return cronSession.jobs?.find((job) => job.job_key === cronSession.selectedJobKey) ?? null;
}

async function backToMainMenu(session, chatId, waClient) {
  delete session.cronConfig;
  session.step = "main";
  session.time = Date.now();
  await wabotDitbinmasHandlers.main(session, chatId, "", waClient);
}

export const wabotDitbinmasHandlers = {
  async main(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    if (!choice) {
      session.step = "main";
      session.time = Date.now();
      await waClient.sendMessage(chatId, MAIN_MENU_MESSAGE);
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      clearSession(chatId);
      await waClient.sendMessage(chatId, "✅ Menu Wabot Ditbinmas ditutup.");
      return;
    }

    if (!["1", "2", "3", "4"].includes(choice)) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas dengan angka menu yang tersedia.");
      await wabotDitbinmasHandlers.main(session, chatId, "", waClient);
      return;
    }

    const mapStep = {
      1: "userSummary_menu",
      2: "instaSummary_menu",
      3: "tiktokSummary_menu",
      4: "cronConfig_menu",
    };

    session.step = mapStep[choice];
    session.time = Date.now();
    await wabotDitbinmasHandlers[session.step](session, chatId, "", waClient);
  },
  userSummary_menu: handleSubMenuFactory("userSummary"),
  instaSummary_menu: handleSubMenuFactory("instaSummary"),
  tiktokSummary_menu: handleSubMenuFactory("tiktokSummary"),
  async cronConfig_menu(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    const lowerChoice = choice.toLowerCase();

    if (!choice) {
      session.step = "cronConfig_menu";
      session.time = Date.now();

      try {
        const jobs = await cronJobConfigService.list();
        session.cronConfig = { jobs };
        await waClient.sendMessage(chatId, buildCronJobListMessage(jobs));
      } catch (error) {
        console.error("Failed to load cron job list for Ditbinmas menu", error);
        await waClient.sendMessage(
          chatId,
          "❌ Gagal mengambil daftar cron job. Silakan coba lagi nanti atau ketik *menu* untuk kembali.",
        );
      }
      return;
    }

    if (
      choice === "0" ||
      lowerChoice === "menu" ||
      lowerChoice === "back" ||
      lowerChoice === "batal"
    ) {
      await backToMainMenu(session, chatId, waClient);
      return;
    }

    const cronSession = session.cronConfig;
    if (!cronSession?.jobs?.length) {
      await waClient.sendMessage(
        chatId,
        "Daftar cron job belum tersedia. Ketik *menu* untuk kembali ke menu utama.",
      );
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
      return;
    }

    const selectedIndex = Number.parseInt(choice, 10);
    if (Number.isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > cronSession.jobs.length) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Silakan pilih nomor cron job yang tersedia.");
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
      return;
    }

    const job = cronSession.jobs[selectedIndex - 1];
    cronSession.selectedJobKey = job.job_key;
    session.step = "cronConfig_jobAction";
    session.time = Date.now();
    await wabotDitbinmasHandlers.cronConfig_jobAction(session, chatId, "", waClient);
  },
  async cronConfig_jobAction(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    const lowerChoice = choice.toLowerCase();
    const job = findSelectedJob(session);

    if (!job) {
      await waClient.sendMessage(chatId, "Cron job tidak ditemukan. Mengembalikan ke daftar cron job.");
      delete session.cronConfig?.selectedJobKey;
      session.step = "cronConfig_menu";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
      return;
    }

    if (!choice) {
      session.step = "cronConfig_jobAction";
      session.time = Date.now();
      await waClient.sendMessage(chatId, buildCronJobActionMessage(job));
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      delete session.cronConfig?.selectedJobKey;
      session.step = "cronConfig_menu";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
      return;
    }

    if (lowerChoice === "menu" || lowerChoice === "back" || lowerChoice === "batal") {
      await backToMainMenu(session, chatId, waClient);
      return;
    }

    if (!["1", "2"].includes(choice)) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Silakan pilih 1 untuk aktifkan atau 2 untuk nonaktifkan.");
      await wabotDitbinmasHandlers.cronConfig_jobAction(session, chatId, "", waClient);
      return;
    }

    const nextStatus = choice === "1";
    session.cronConfig.pendingStatus = nextStatus;
    session.step = "cronConfig_confirm";
    session.time = Date.now();
    await wabotDitbinmasHandlers.cronConfig_confirm(session, chatId, "", waClient);
  },
  async cronConfig_confirm(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    const lowerChoice = choice.toLowerCase();
    const job = findSelectedJob(session);
    const cronSession = session.cronConfig;

    if (!job || typeof cronSession?.pendingStatus !== "boolean") {
      await waClient.sendMessage(chatId, "Sesi konfigurasi cron job tidak valid. Mengembalikan ke daftar cron job.");
      if (cronSession) {
        delete cronSession.selectedJobKey;
        delete cronSession.pendingStatus;
      }
      session.step = "cronConfig_menu";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
      return;
    }

    if (!choice) {
      session.step = "cronConfig_confirm";
      session.time = Date.now();
      await waClient.sendMessage(chatId, buildCronJobConfirmationMessage(job, cronSession.pendingStatus));
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      delete cronSession.pendingStatus;
      session.step = "cronConfig_jobAction";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_jobAction(session, chatId, "", waClient);
      return;
    }

    if (lowerChoice === "menu" || lowerChoice === "back" || lowerChoice === "batal") {
      await backToMainMenu(session, chatId, waClient);
      return;
    }

    if (!["ya", "y"].includes(lowerChoice)) {
      await waClient.sendMessage(chatId, "Jawaban tidak dikenali. Balas *YA* untuk konfirmasi atau *0* untuk kembali.");
      await wabotDitbinmasHandlers.cronConfig_confirm(session, chatId, "", waClient);
      return;
    }

    try {
      const updatedJob = await cronJobConfigService.updateCronJobStatus(job.job_key, cronSession.pendingStatus);
      const statusText = updatedJob.is_active ? "Aktif" : "Nonaktif";
      await waClient.sendMessage(
        chatId,
        `✅ Status cron job *${updatedJob.display_name || updatedJob.job_key}* berhasil diubah menjadi *${statusText}*.`,
      );
      delete session.cronConfig;
      session.step = "cronConfig_menu";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_menu(session, chatId, "", waClient);
    } catch (error) {
      console.error("Failed to update cron job status for Ditbinmas menu", error);
      await waClient.sendMessage(
        chatId,
        "❌ Terjadi kesalahan saat memperbarui cron job. Silakan coba lagi atau ketik *menu* untuk kembali.",
      );
      delete cronSession.pendingStatus;
      session.step = "cronConfig_jobAction";
      session.time = Date.now();
      await wabotDitbinmasHandlers.cronConfig_jobAction(session, chatId, "", waClient);
    }
  },
};
