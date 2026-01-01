"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPartner = createPartner;
exports.getPartnerByUsername = getPartnerByUsername;
exports.verifyPartner = verifyPartner;
exports.partnersCount = partnersCount;
exports.listAllowedVariantSkus = listAllowedVariantSkus;
exports.grantVariantAccess = grantVariantAccess;
exports.grantAllVariantAccess = grantAllVariantAccess;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("./db");
function sha256Hex(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
function normalizeApiKey(value) {
    return value.replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
}
function generateGroupedApiKey() {
    // Format: XXX-XXX-XXX-XXX-XXX-XXX-XXX-XXX (8 groups of 3)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = node_crypto_1.default.randomBytes(24);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    const groups = [];
    for (let i = 0; i < chars.length; i += 3) {
        groups.push(chars.slice(i, i + 3).join(''));
    }
    return groups.join('-');
}
function timingSafeEqualHex(a, b) {
    const aBuf = Buffer.from(a, 'hex');
    const bBuf = Buffer.from(b, 'hex');
    if (aBuf.length !== bBuf.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(aBuf, bBuf);
}
function createPartner(params) {
    const db = (0, db_1.getDb)();
    const apiKey = generateGroupedApiKey();
    // Store hash of normalized key so users can send with/without dashes.
    const apiKeyHash = sha256Hex(normalizeApiKey(apiKey));
    const role = params.role ?? 'reseller';
    const balanceCredits = Number.isFinite(params.balanceCredits)
        ? Number(params.balanceCredits)
        : 0;
    const insert = db.prepare('INSERT INTO partners (username, apiKeyHash, active, balanceCredits, role) VALUES (?, ?, 1, ?, ?)');
    const info = insert.run(params.username, apiKeyHash, balanceCredits, role);
    const partnerId = Number(info.lastInsertRowid);
    // Default behavior: allow all variants unless explicitly disabled.
    const allowAll = params.allowAllVariants !== false;
    if (allowAll) {
        grantAllVariantAccess(partnerId);
    }
    else if (params.allowedVariantSkus && params.allowedVariantSkus.length > 0) {
        grantVariantAccess(partnerId, params.allowedVariantSkus);
    }
    return { username: params.username, apiaccesskey: apiKey };
}
function getPartnerByUsername(username) {
    const db = (0, db_1.getDb)();
    return db
        .prepare('SELECT * FROM partners WHERE username = ? LIMIT 1')
        .get(username);
}
function verifyPartner(username, apiaccesskey) {
    const db = (0, db_1.getDb)();
    const row = getPartnerByUsername(username);
    if (!row || row.active !== 1)
        return false;
    // Backward compatible:
    // - legacy keys were hashed as-is (e.g., lower hex)
    // - new keys are hashed normalized (uppercase, no dashes)
    const providedHashLegacy = sha256Hex(apiaccesskey);
    const providedHashNormalized = sha256Hex(normalizeApiKey(apiaccesskey));
    const ok = timingSafeEqualHex(row.apiKeyHash, providedHashLegacy) ||
        timingSafeEqualHex(row.apiKeyHash, providedHashNormalized);
    if (ok) {
        try {
            db.prepare('UPDATE partners SET lastUsedAt = datetime(\'now\') WHERE id = ?').run(row.id);
        }
        catch {
            // ignore
        }
    }
    return ok ? row : false;
}
function partnersCount() {
    const db = (0, db_1.getDb)();
    const row = db.prepare('SELECT COUNT(1) as c FROM partners').get();
    return Number(row.c ?? 0);
}
function listAllowedVariantSkus(partnerId) {
    const db = (0, db_1.getDb)();
    const rows = db
        .prepare('SELECT variantSku FROM partner_variant_access WHERE partnerId = ?')
        .all(partnerId);
    return new Set(rows.map((r) => r.variantSku));
}
function grantVariantAccess(partnerId, variantSkus) {
    const db = (0, db_1.getDb)();
    const insert = db.prepare('INSERT OR IGNORE INTO partner_variant_access (partnerId, variantSku) VALUES (?, ?)');
    const tx = db.transaction(() => {
        for (const sku of variantSkus)
            insert.run(partnerId, sku);
    });
    tx();
}
function grantAllVariantAccess(partnerId) {
    const db = (0, db_1.getDb)();
    const skus = db.prepare('SELECT sku FROM product_variants').all();
    grantVariantAccess(partnerId, skus.map((s) => s.sku));
}
