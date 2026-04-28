import './src/utils/logger.js';
import { env } from './src/config/env.js';
import { createApp } from './src/app/createApp.js';

const app = createApp();
const PORT = env.PORT;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
