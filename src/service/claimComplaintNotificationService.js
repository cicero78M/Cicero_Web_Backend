import * as claimComplaintModel from '../model/claimComplaintModel.js';
import { formatClaimTriageText } from './claimTriageResponseService.js';

const maxAttempts = 3;

function deliveryStatus(delivery) {
  const status = delivery?.personnel?.status;
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

export async function deliverClaimComplaintNotification(complaint, eventType) {
  const reservation = await claimComplaintModel.reserveNotification(
    complaint.complaint_id,
    eventType,
    maxAttempts
  );
  if (!reservation) {
    return claimComplaintModel.findNotification(complaint.complaint_id, eventType);
  }

  try {
    // Load the repository's verified WhatsApp adapter only when a real lifecycle
    // event needs delivery. Triage requests never initialize messaging code.
    const { sendComplaintWhatsappResponse } = await import('./complaintService.js');
    const triage = complaint.triage_payload;
    const message = [
      eventType === 'created' ? 'Laporan claim baru' : 'Laporan claim dieskalasi',
      `Complaint ID: ${complaint.complaint_id}`,
      formatClaimTriageText(triage),
    ].join('\n\n');
    const deliveryResult = await sendComplaintWhatsappResponse({
      message,
      personnelWhatsapp: process.env.ADMIN_WHATSAPP || '',
    });
    return claimComplaintModel.finishNotification(complaint.complaint_id, eventType, {
      status: deliveryStatus(deliveryResult),
      attemptCount: reservation.attempt_count,
      deliveryResult,
    });
  } catch (error) {
    return claimComplaintModel.finishNotification(complaint.complaint_id, eventType, {
      status: 'failed',
      attemptCount: reservation.attempt_count,
      error: error?.message || 'WhatsApp delivery failed',
    });
  }
}
