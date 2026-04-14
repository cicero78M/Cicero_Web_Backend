import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

export async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Kode OTP Anda',
    text: `Kode OTP Anda: ${otp}`,
  });
}

export async function sendComplaintEmail(email, subject, message) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text: message,
  });
}

export async function sendApprovalEmail(email, username) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Registrasi Dashboard Disetujui',
    text: `Halo ${username},\n\nRegistrasi akun dashboard Anda telah disetujui. Silakan login ke dashboard.\n\nSalam,\nAdmin`,
  });
}

export async function sendRejectionEmail(email, username, reason) {
  const reasonText = reason ? `\n\nAlasan penolakan: ${reason}` : '';
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Registrasi Dashboard Ditolak',
    text: `Halo ${username},\n\nRegistrasi akun dashboard Anda ditolak.${reasonText}\n\nSilakan perbaiki data Anda dan daftar kembali.\n\nSalam,\nAdmin`,
  });
}

export async function sendClaimPasswordResetEmail(email, token, options = {}) {
  const { nrp, expiryMinutes = 15, resetBaseUrl } = options;
  const baseUrl = (resetBaseUrl || process.env.DASHBOARD_PASSWORD_RESET_URL || '').trim();
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const resetLink = normalizedBaseUrl
    ? `${normalizedBaseUrl}?token=${encodeURIComponent(token)}`
    : null;

  const lines = [
    'Halo,',
    '',
    'Kami menerima permintaan reset password akun CICERO Anda.',
    `NRP: ${nrp}`,
    `Token reset: ${token}`,
    `Token berlaku selama ${expiryMinutes} menit.`,
  ];

  if (resetLink) {
    lines.push(`Link reset: ${resetLink}`);
  }

  lines.push('', 'Jika Anda tidak merasa melakukan permintaan ini, abaikan email ini.', '', 'Salam,', 'Tim CICERO');

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Reset Password CICERO',
    text: lines.join('\n'),
  });
}
