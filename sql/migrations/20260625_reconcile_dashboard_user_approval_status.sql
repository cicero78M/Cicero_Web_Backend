-- Reconcile legacy dashboard approvals after the Telegram approval-status split.
-- Before approval_status existed, dashboard_user.status=true was the approval marker.
-- Preserve those users as approved so Telegram pending lists and dashboard login
-- do not treat already-approved legacy users as new pending registrations.
-- Keep the legacy status default unchanged; public dashboard registration already
-- writes status=false explicitly.

UPDATE dashboard_user
SET approval_status = 'approved'
WHERE status IS TRUE
  AND approval_status <> 'approved';

UPDATE dashboard_user
SET status = TRUE
WHERE approval_status = 'approved'
  AND status IS NOT TRUE;

UPDATE dashboard_user
SET status = FALSE
WHERE approval_status IN ('pending', 'rejected')
  AND status IS DISTINCT FROM FALSE;
