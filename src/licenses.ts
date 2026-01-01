import crypto from 'node:crypto';
import { getDb } from './db';

export type LicenseRow = {
  id: number;
  orderId: string;
  email: string;
  productId: string;
  durationYears: number | null;
  activatedAt: string | null;
  expiresAt: string | null;
  licenseKey: string;
  status: string;
  createdAt: string;
};

export function generateLicenseKey() {
  // 32 hex chars, high entropy
  return crypto.randomBytes(16).toString('hex');
}

export function createOrGetLicense(params: {
  orderId: string;
  email: string;
  productId: string; // variant sku
  durationYears: number;
}) {
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM licenses WHERE orderId = ? AND productId = ? LIMIT 1')
    .get(params.orderId, params.productId) as LicenseRow | undefined;

  if (existing) return existing;

  const licenseKey = generateLicenseKey();

  const activatedAt = new Date().toISOString();
  const expiresAt = new Date(activatedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + params.durationYears);

  const insert = db.prepare(
    'INSERT INTO licenses (orderId, email, productId, durationYears, activatedAt, expiresAt, licenseKey) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const info = insert.run(
    params.orderId,
    params.email,
    params.productId,
    params.durationYears,
    activatedAt,
    expiresAt.toISOString(),
    licenseKey
  );

  const created = db
    .prepare('SELECT * FROM licenses WHERE id = ?')
    .get(info.lastInsertRowid) as LicenseRow;

  return created;
}

export function listLicenses(params?: { limit?: number }) {
  const db = getDb();
  const limit = Math.max(1, Math.min(500, params?.limit ?? 50));

  return db
    .prepare('SELECT * FROM licenses ORDER BY id DESC LIMIT ?')
    .all(limit) as LicenseRow[];
}
