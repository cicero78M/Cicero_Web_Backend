import { sendDebug } from './debugHandler.js';

export function notFound(req, res) {
  sendDebug({ tag: 'ERROR', msg: `NotFound ${req.originalUrl}` });
  res.status(404).json({ success: false, message: 'Endpoint not found' });
}

export function errorHandler(err, req, res, next) {
  void next;
  const code = err.statusCode || 500;
  const safeMessage =
    typeof err?.message === 'string' && err.message.trim()
      ? err.message
      : 'Internal server error';

  sendDebug({
    tag: 'ERROR',
    msg: {
      message: safeMessage,
      method: req.method,
      path: req.originalUrl,
      status: code
    }
  });

  res.status(code).json({
    success: false,
    message: safeMessage
  });
}
