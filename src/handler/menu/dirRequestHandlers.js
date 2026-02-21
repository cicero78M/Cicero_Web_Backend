import { appendSubmenuBackInstruction } from './menuPromptHelpers.js';

export const CHAKRANARAYANA_MAIN_MENU_KEY = '54';

const chakranarayanaSubmenuMap = {
  direktorat: [3, 6, 9, 46, 47, 50, 51, 53],
  jajaran: [1, 48, 49],
};

const sortAscending = (menuNumbers) =>
  [...menuNumbers].sort((left, right) => left - right);

export const chakranarayanaMenuNumbers = {
  direktorat: sortAscending(chakranarayanaSubmenuMap.direktorat),
  jajaran: sortAscending(chakranarayanaSubmenuMap.jajaran),
};

export function isDirrequestCommand(text) {
  return /^dirrequest\b/i.test(String(text || '').trim());
}

export function buildDirrequestMainMenu() {
  return appendSubmenuBackInstruction(`*Menu Dirrequest*\n${CHAKRANARAYANA_MAIN_MENU_KEY}️⃣ chakranarayana\nBalas angka menu atau *batal* untuk keluar.`);
}

function buildMenuNumberList(menuNumbers) {
  return menuNumbers.map((menuNumber) => `${menuNumber}. Menu Dirrequest ${menuNumber}`).join('\n');
}

export function buildChakranarayanaSubmenu() {
  return appendSubmenuBackInstruction(`*Chakranarayana*\n1️⃣ Direktorat\n2️⃣ Jajaran\nBalas angka menu atau *batal* untuk keluar.`);
}

export function buildChakranarayanaDirektoratMenu() {
  return appendSubmenuBackInstruction(
    `*Chakranarayana - Direktorat*\n${buildMenuNumberList(chakranarayanaMenuNumbers.direktorat)}\nBalas nomor menu dirrequest, *back*, atau *batal*.`
  );
}

export function buildChakranarayanaJajaranMenu() {
  return appendSubmenuBackInstruction(
    `*Chakranarayana - Jajaran*\n${buildMenuNumberList(chakranarayanaMenuNumbers.jajaran)}\nBalas nomor menu dirrequest, *back*, atau *batal*.`
  );
}

function isBackInput(text) {
  return String(text || '').trim().toLowerCase() === 'back';
}

function isCancelInput(text) {
  return String(text || '').trim().toLowerCase() === 'batal';
}

async function sendInvalidMenuInputMessage(waClient, chatId) {
  await waClient.sendMessage(
    chatId,
    'Pilihan tidak valid. Balas angka sesuai menu, atau ketik *back*/*batal*.'
  );
}

async function routeToExistingDirrequestMenu({
  session,
  chatId,
  text,
  waClient,
  dispatchDirrequestNumber,
}) {
  const normalized = String(text || '').trim();

  if (!/^\d+$/.test(normalized)) {
    await sendInvalidMenuInputMessage(waClient, chatId);
    return;
  }

  await dispatchDirrequestNumber(Number(normalized), {
    session,
    chatId,
    text,
    waClient,
  });
}

export async function handleDirrequestCommandEntrypoint({
  session,
  chatId,
  text,
  waClient,
  dispatchDirrequestNumber,
}) {
  const normalized = String(text || '').trim().toLowerCase();

  if (!session.step || isDirrequestCommand(normalized)) {
    session.step = 'dirrequest_main';
    await waClient.sendMessage(chatId, buildDirrequestMainMenu());
    return;
  }

  if (isCancelInput(normalized)) {
    session.step = 'main';
    await waClient.sendMessage(chatId, 'Menu dirrequest dibatalkan.');
    return;
  }

  if (session.step === 'dirrequest_main') {
    if (normalized === CHAKRANARAYANA_MAIN_MENU_KEY || normalized === 'chakranarayana') {
      session.step = 'dirrequest_chakranarayana_submenu';
      await waClient.sendMessage(chatId, buildChakranarayanaSubmenu());
      return;
    }

    await routeToExistingDirrequestMenu({
      session,
      chatId,
      text,
      waClient,
      dispatchDirrequestNumber,
    });
    return;
  }

  if (session.step === 'dirrequest_chakranarayana_submenu') {
    if (isBackInput(normalized)) {
      session.step = 'dirrequest_main';
      await waClient.sendMessage(chatId, buildDirrequestMainMenu());
      return;
    }

    if (normalized === '1') {
      session.step = 'dirrequest_chakranarayana_direktorat';
      await waClient.sendMessage(chatId, buildChakranarayanaDirektoratMenu());
      return;
    }

    if (normalized === '2') {
      session.step = 'dirrequest_chakranarayana_jajaran';
      await waClient.sendMessage(chatId, buildChakranarayanaJajaranMenu());
      return;
    }

    await sendInvalidMenuInputMessage(waClient, chatId);
    return;
  }

  if (session.step === 'dirrequest_chakranarayana_direktorat') {
    if (isBackInput(normalized)) {
      session.step = 'dirrequest_chakranarayana_submenu';
      await waClient.sendMessage(chatId, buildChakranarayanaSubmenu());
      return;
    }

    if (!chakranarayanaMenuNumbers.direktorat.includes(Number(normalized))) {
      await sendInvalidMenuInputMessage(waClient, chatId);
      return;
    }

    await routeToExistingDirrequestMenu({
      session,
      chatId,
      text: normalized,
      waClient,
      dispatchDirrequestNumber,
    });
    return;
  }

  if (session.step === 'dirrequest_chakranarayana_jajaran') {
    if (isBackInput(normalized)) {
      session.step = 'dirrequest_chakranarayana_submenu';
      await waClient.sendMessage(chatId, buildChakranarayanaSubmenu());
      return;
    }

    if (!chakranarayanaMenuNumbers.jajaran.includes(Number(normalized))) {
      await sendInvalidMenuInputMessage(waClient, chatId);
      return;
    }

    await routeToExistingDirrequestMenu({
      session,
      chatId,
      text: normalized,
      waClient,
      dispatchDirrequestNumber,
    });
  }
}
