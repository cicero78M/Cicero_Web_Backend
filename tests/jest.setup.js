// Unit tests must never start the production Telegram polling loop implicitly.
// Dedicated lifecycle tests may delete/override this flag with a mocked adapter.
process.env.TELEGRAM_SERVICE_SKIP_INIT = 'true';
