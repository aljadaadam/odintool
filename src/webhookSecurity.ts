import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

function timingSafeEqualHex(a: string, b: string) {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: 'WEBHOOK_SECRET not configured' });
  }

  const signature = String(req.header('x-signature') ?? '');
  const timestamp = String(req.header('x-timestamp') ?? '');

  if (!signature || !timestamp) {
    return res.status(401).json({ ok: false, error: 'Missing signature headers' });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return res.status(401).json({ ok: false, error: 'Invalid timestamp' });
  }

  // Reject old requests (5 minutes)
  const ageMs = Math.abs(Date.now() - ts);
  if (ageMs > 5 * 60 * 1000) {
    return res.status(401).json({ ok: false, error: 'Request too old' });
  }

  const rawBody = JSON.stringify(req.body ?? {});
  const message = `${timestamp}.${rawBody}`;

  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const ok = timingSafeEqualHex(expected, signature);

  if (!ok) {
    return res.status(401).json({ ok: false, error: 'Invalid signature' });
  }

  return next();
}
