"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
let db;
const schemaSql = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  productType TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_variants (
  sku TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  name TEXT NOT NULL,
  externalKey TEXT,
  serviceId INTEGER,
  durationYears INTEGER NOT NULL,
  activationMode TEXT NOT NULL,
  requiredFieldsJson TEXT NOT NULL,
  requiredAction TEXT NOT NULL,
  variantType TEXT NOT NULL,
  creditText TEXT NOT NULL DEFAULT '',
  creditCost REAL NOT NULL DEFAULT 0,
  timeText TEXT NOT NULL DEFAULT '',
  infoText TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  apiKeyHash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  balanceCredits REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'reseller',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastUsedAt TEXT
);

CREATE TABLE IF NOT EXISTS partner_variant_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partnerId INTEGER NOT NULL,
  variantSku TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(partnerId, variantSku),
  FOREIGN KEY (partnerId) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (variantSku) REFERENCES product_variants(sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId TEXT NOT NULL,
  email TEXT NOT NULL,
  productId TEXT NOT NULL,
  durationYears INTEGER,
  activatedAt TEXT,
  expiresAt TEXT,
  partnerId INTEGER,
  customFieldsJson TEXT,
  licenseKey TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_order_product
  ON licenses(orderId, productId);
`;
function ensureDirForFile(filePath) {
    const dir = node_path_1.default.dirname(filePath);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function getDb() {
    if (db)
        return db;
    const dbPath = process.env.DB_PATH ?? './data/odintool.sqlite';
    ensureDirForFile(dbPath);
    db = new better_sqlite3_1.default(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(schemaSql);
    migrate(db);
    seedInventory(db);
    return db;
}
function migrate(db) {
    // Add new columns to existing installs safely.
    const alters = [
        "ALTER TABLE licenses ADD COLUMN durationYears INTEGER",
        "ALTER TABLE licenses ADD COLUMN activatedAt TEXT",
        "ALTER TABLE licenses ADD COLUMN expiresAt TEXT",
        "ALTER TABLE product_variants ADD COLUMN externalKey TEXT",
        "ALTER TABLE product_variants ADD COLUMN serviceId INTEGER",
        "ALTER TABLE product_variants ADD COLUMN creditText TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE product_variants ADD COLUMN creditCost REAL NOT NULL DEFAULT 0",
        "ALTER TABLE product_variants ADD COLUMN timeText TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE product_variants ADD COLUMN infoText TEXT NOT NULL DEFAULT ''"
    ];
    for (const sql of alters) {
        try {
            db.exec(sql);
        }
        catch {
            // ignore if already exists
        }
    }
    // Indexes that depend on newly-added columns
    try {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_externalKey ON product_variants(externalKey)');
    }
    catch {
        // ignore
    }
    // partners table expansion (best-effort)
    for (const sql of [
        "ALTER TABLE partners ADD COLUMN balanceCredits REAL NOT NULL DEFAULT 0",
        "ALTER TABLE partners ADD COLUMN role TEXT NOT NULL DEFAULT 'reseller'"
    ]) {
        try {
            db.exec(sql);
        }
        catch {
            // ignore
        }
    }
    // New tables (safe)
    try {
        db.exec("CREATE TABLE IF NOT EXISTS partner_variant_access (id INTEGER PRIMARY KEY AUTOINCREMENT, partnerId INTEGER NOT NULL, variantSku TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(partnerId, variantSku), FOREIGN KEY (partnerId) REFERENCES partners(id) ON DELETE CASCADE, FOREIGN KEY (variantSku) REFERENCES product_variants(sku) ON DELETE CASCADE)");
    }
    catch {
        // ignore
    }
    // licenses table expansion (best-effort)
    for (const sql of [
        'ALTER TABLE licenses ADD COLUMN partnerId INTEGER',
        'ALTER TABLE licenses ADD COLUMN customFieldsJson TEXT'
    ]) {
        try {
            db.exec(sql);
        }
        catch {
            // ignore
        }
    }
    // Backfill creditCost from creditText when possible
    try {
        db.exec("UPDATE product_variants SET creditCost = COALESCE(creditCost, 0) WHERE creditCost IS NULL");
        db.exec("UPDATE product_variants SET creditCost = CASE WHEN creditCost = 0 AND creditText <> '' THEN CAST(creditText AS REAL) ELSE creditCost END");
    }
    catch {
        // ignore
    }
    // Backfill for older rows (best-effort)
    try {
        db.exec("UPDATE licenses SET durationYears = COALESCE(durationYears, 1) WHERE durationYears IS NULL");
        db.exec("UPDATE licenses SET activatedAt = COALESCE(activatedAt, createdAt) WHERE activatedAt IS NULL");
        db.exec("UPDATE licenses SET expiresAt = COALESCE(expiresAt, datetime(activatedAt, '+1 year')) WHERE expiresAt IS NULL");
    }
    catch {
        // ignore
    }
}
function seedInventory(db) {
    const upsertProduct = db.prepare(`INSERT INTO products (id, name, productType) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, productType=excluded.productType`);
    const upsertVariant = db.prepare(`INSERT INTO product_variants (
        sku, productId, name, externalKey, serviceId, durationYears, activationMode, requiredFieldsJson, requiredAction, variantType, creditText, timeText, infoText
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO UPDATE SET
        productId=excluded.productId,
        name=excluded.name,
        externalKey=excluded.externalKey,
        serviceId=excluded.serviceId,
        durationYears=excluded.durationYears,
        activationMode=excluded.activationMode,
        requiredFieldsJson=excluded.requiredFieldsJson,
        requiredAction=excluded.requiredAction,
        variantType=excluded.variantType,
        creditText=excluded.creditText,
        timeText=excluded.timeText,
        infoText=excluded.infoText`);
    // Group / product
    upsertProduct.run('muslim-odin', 'Muslim Odin Activation', 'SERVER');
    // Partner-style required fields
    const requiredUserAndPhone = JSON.stringify([
        {
            type: 'serviceimei',
            fieldname: 'User',
            fieldtype: 'text',
            description: '',
            fieldoptions: '',
            regexpr: '',
            adminonly: '',
            required: 'on'
        },
        {
            type: 'serviceimei',
            fieldname: 'phone number',
            fieldtype: 'text',
            description: '',
            fieldoptions: '',
            regexpr: '',
            adminonly: '',
            required: 'on'
        }
    ]);
    const requiredUserOnly = JSON.stringify([
        {
            type: 'serviceimei',
            fieldname: 'User',
            fieldtype: 'text',
            description: '',
            fieldoptions: '',
            regexpr: '',
            adminonly: '',
            required: 'on'
        }
    ]);
    // Existing examples (kept as-is)
    upsertVariant.run('muslim-odin-lifetime-mtkpro', 'muslim-odin', 'Muslim Odin life time activation + MTK PRO', '18153', 163382, 99, 'manual', requiredUserAndPhone, 'create_activation_job', 'activation', '22.000', '1-24 Hours', '');
    upsertVariant.run('xiaomi-sideload-v8', 'muslim-odin', 'Xiaomi Sideload v8.0', '18389', 165506, 0, 'manual', requiredUserOnly, 'create_activation_job', 'service', '22.000', '1-24 Hours', '');
    // 3 subscriptions (new)
    const requiredForSubscriptions = JSON.stringify([
        {
            type: 'serviceimei',
            fieldname: 'User',
            fieldtype: 'text',
            description: '',
            fieldoptions: '',
            regexpr: '',
            adminonly: '',
            required: 'on'
        },
        {
            type: 'serviceimei',
            fieldname: 'phone number',
            fieldtype: 'text',
            description: '',
            fieldoptions: '',
            regexpr: '',
            adminonly: '',
            required: 'on'
        }
    ]);
    upsertVariant.run('muslim-odin-1y', 'muslim-odin', 'تفعيل سنة', '19001', 19001, 1, 'immediate', requiredForSubscriptions, 'issue_license', 'subscription', '0.000', 'Instant', '');
    upsertVariant.run('muslim-odin-2y', 'muslim-odin', 'تفعيل سنتين', '19002', 19002, 2, 'immediate', requiredForSubscriptions, 'issue_license', 'subscription', '0.000', 'Instant', '');
    upsertVariant.run('muslim-odin-3y', 'muslim-odin', 'تفعيل 3 سنوات', '19003', 19003, 3, 'immediate', requiredForSubscriptions, 'issue_license', 'subscription', '0.000', 'Instant', '');
}
