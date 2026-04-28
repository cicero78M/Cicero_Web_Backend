import {
  getDashboardPremiumExecutiveRecap,
  getDashboardPremiumRiskSummary,
} from '../service/dashboardPremiumInsightService.js';

function getDashboardUser(req) {
  return req.dashboardUser || req.user || null;
}

export async function getDashboardPremiumExecutiveRecapController(req, res, next) {
  try {
    const result = await getDashboardPremiumExecutiveRecap({
      dashboardUser: getDashboardUser(req),
      query: req.query || {},
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDashboardPremiumRiskSummaryController(req, res, next) {
  try {
    const result = await getDashboardPremiumRiskSummary({
      dashboardUser: getDashboardUser(req),
      query: req.query || {},
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
