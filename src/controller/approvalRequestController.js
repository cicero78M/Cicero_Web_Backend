import * as approvalModel from '../model/approvalRequestModel.js';
import { sendSuccess } from '../utils/response.js';

export async function getApprovals(req, res, next) {
  try {
    const data = await approvalModel.getApprovalRequests();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function createApproval(req, res, next) {
  try {
    const body = { ...req.body, requested_by: req.penmasUser.user_id };
    const ap = await approvalModel.createRequest(body);
    sendSuccess(res, ap, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateApproval(req, res, next) {
  try {
    const ap = await approvalModel.updateRequest(Number(req.params.id), req.body);
    sendSuccess(res, ap);
  } catch (err) {
    next(err);
  }
}
