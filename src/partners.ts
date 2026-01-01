import crypto from 'node:crypto';
import { getDb } from './db';

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeApiKey(value: string) {
  return value.replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
}

function generateGroupedApiKey() {
  // Format: XXX-XXX-XXX-XXX-XXX-XXX-XXX-XXX (8 groups of 3)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(24);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);

  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 3) {
    groups.push(chars.slice(i, i + 3).join(''));
  }

  return groups.join('-');
}

function timingSafeEqualHex(a: string, b: string) {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export type PartnerRow = {
  id: number;
  username: string;
  apiKeyHash: string;
  active: 0 | 1;
  balanceCredits: number;
  role: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function createPartner(params: {
  username: string;
  role?: string;
  balanceCredits?: number;
  allowAllVariants?: boolean;
  allowedVariantSkus?: string[];
}) {
  const db = getDb();

  const apiKey = generateGroupedApiKey();
  // Store hash of normalized key so users can send with/without dashes.
  const apiKeyHash = sha256Hex(normalizeApiKey(apiKey));

  const role = params.role ?? 'reseller';
  const balanceCredits = Number.isFinite(params.balanceCredits)
    ? Number(params.balanceCredits)
    : 0;

  const insert = db.prepare(
    'INSERT INTO partners (username, apiKeyHash, active, balanceCredits, role) VALUES (?, ?, 1, ?, ?)'
  );
  const info = insert.run(params.username, apiKeyHash, balanceCredits, role);
  const partnerId = Number(info.lastInsertRowid);

  // Default behavior: allow all variants unless explicitly disabled.
  const allowAll = params.allowAllVariants !== false;
  if (allowAll) {
    grantAllVariantAccess(partnerId);
  } else if (params.allowedVariantSkus && params.allowedVariantSkus.length > 0) {
    grantVariantAccess(partnerId, params.allowedVariantSkus);
  }

  return { username: params.username, apiaccesskey: apiKey };
}

export function getPartnerByUsername(username: string) {
  const db = getDb();

  return db
    .prepare('SELECT * FROM partners WHERE username = ? LIMIT 1')
    .get(username) as PartnerRow | undefined;
}

export function verifyPartner(username: string, apiaccesskey: string) {
  const db = getDb();

  const row = getPartnerByUsername(username);

  if (!row || row.active !== 1) return false;

  // Backward compatible:
  // - legacy keys were hashed as-is (e.g., lower hex)
  // - new keys are hashed normalized (uppercase, no dashes)
  const providedHashLegacy = sha256Hex(apiaccesskey);
  const providedHashNormalized = sha256Hex(normalizeApiKey(apiaccesskey));
  const ok =
    timingSafeEqualHex(row.apiKeyHash, providedHashLegacy) ||
    timingSafeEqualHex(row.apiKeyHash, providedHashNormalized);

  if (ok) {
    try {
      db.prepare('UPDATE partners SET lastUsedAt = datetime(\'now\') WHERE id = ?').run(row.id);
    } catch {
      // ignore
    }
  }

  return ok ? row : false;
}

export function partnersCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(1) as c FROM partners').get() as { c: number };
  return Number(row.c ?? 0);
}

export function listAllowedVariantSkus(partnerId: number) {
  const db = getDb();
  const rows = db
    .prepare('SELECT variantSku FROM partner_variant_access WHERE partnerId = ?')
    .all(partnerId) as Array<{ variantSku: string }>;
  return new Set(rows.map((r) => r.variantSku));
}

export function grantVariantAccess(partnerId: number, variantSkus: string[]) {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO partner_variant_access (partnerId, variantSku) VALUES (?, ?)'
  );
  const tx = db.transaction(() => {
    for (const sku of variantSkus) insert.run(partnerId, sku);
  });
  tx();
}

export function grantAllVariantAccess(partnerId: number) {
  const db = getDb();
  const skus = db.prepare('SELECT sku FROM product_variants').all() as Array<{ sku: string }>;
  grantVariantAccess(
    partnerId,
    skus.map((s) => s.sku)
  );
}
