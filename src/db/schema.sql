-- SQLite schema for odintool

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId TEXT NOT NULL,
  email TEXT NOT NULL,
  productId TEXT NOT NULL,
  licenseKey TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_order_product
  ON licenses(orderId, productId);
