import './src/utils/logger.js';
import { env } from './src/config/env.js';
import { createApp } from './src/app/createApp.js';
import { processExpiredPremiumUsers } from './src/service/premiumExpiryService.js';
import { processExpiredSubscriptions } from './src/service/dashboardSubscriptionExpiryService.js';

const app = createApp();
const PORT = env.PORT;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));

let isPremiumSweepRunning = false;

async function runPremiumExpirySweep() {
  if (isPremiumSweepRunning) return;
  isPremiumSweepRunning = true;
  try {
    await Promise.all([
      processExpiredPremiumUsers(new Date()),
      processExpiredSubscriptions(new Date()),
    ]);
  } catch (err) {
    console.error('[CRON] Premium expiry sweep failed:', err?.message || err);
  } finally {
    isPremiumSweepRunning = false;
  }
}

runPremiumExpirySweep();
setInterval(runPremiumExpirySweep, 30 * 60 * 1000);
