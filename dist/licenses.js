"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLicenseKey = generateLicenseKey;
exports.createOrGetLicense = createOrGetLicense;
exports.listLicenses = listLicenses;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("./db");
function generateLicenseKey() {
    // 32 hex chars, high entropy
    return node_crypto_1.default.randomBytes(16).toString('hex');
}
function createOrGetLicense(params) {
    const db = (0, db_1.getDb)();
    const existing = db
        .prepare('SELECT * FROM licenses WHERE orderId = ? AND productId = ? LIMIT 1')
        .get(params.orderId, params.productId);
    if (existing)
        return existing;
    const licenseKey = generateLicenseKey();
    const activatedAt = new Date().toISOString();
    const expiresAt = new Date(activatedAt);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + params.durationYears);
    const insert = db.prepare('INSERT INTO licenses (orderId, email, productId, durationYears, activatedAt, expiresAt, licenseKey) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = insert.run(params.orderId, params.email, params.productId, params.durationYears, activatedAt, expiresAt.toISOString(), licenseKey);
    const created = db
        .prepare('SELECT * FROM licenses WHERE id = ?')
        .get(info.lastInsertRowid);
    return created;
}
function listLicenses(params) {
    const db = (0, db_1.getDb)();
    const limit = Math.max(1, Math.min(500, params?.limit ?? 50));
    return db
        .prepare('SELECT * FROM licenses ORDER BY id DESC LIMIT ?')
        .all(limit);
}
