"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listInventory = listInventory;
exports.getVariantBySku = getVariantBySku;
exports.getVariantByExternalKey = getVariantByExternalKey;
exports.getVariantByProductId = getVariantByProductId;
exports.listInventoryPartnerJson = listInventoryPartnerJson;
const db_1 = require("./db");
function listInventory() {
    const db = (0, db_1.getDb)();
    const products = db
        .prepare('SELECT * FROM products ORDER BY createdAt ASC')
        .all();
    const variants = db
        .prepare('SELECT * FROM product_variants ORDER BY createdAt ASC')
        .all();
    return {
        products,
        variants
    };
}
function getVariantBySku(sku) {
    const db = (0, db_1.getDb)();
    return db
        .prepare('SELECT * FROM product_variants WHERE sku = ? LIMIT 1')
        .get(sku);
}
function getVariantByExternalKey(externalKey) {
    const db = (0, db_1.getDb)();
    return db
        .prepare('SELECT * FROM product_variants WHERE externalKey = ? LIMIT 1')
        .get(externalKey);
}
function getVariantByProductId(productId) {
    // Accept either sku (e.g. muslim-odin-1y) OR external service key (e.g. 18153)
    return getVariantBySku(productId) ?? getVariantByExternalKey(productId);
}
function listInventoryPartnerJson(params) {
    const { products, variants } = listInventory();
    const byProductId = new Map();
    for (const v of variants) {
        const list = byProductId.get(v.productId) ?? [];
        list.push(v);
        byProductId.set(v.productId, list);
    }
    const result = {};
    for (const p of products) {
        const groupName = p.name;
        const groupType = p.productType;
        const services = {};
        const productVariants = byProductId.get(p.id) ?? [];
        for (const v of productVariants) {
            if (params?.allowedSkus && !params.allowedSkus.has(v.sku))
                continue;
            const serviceKey = (v.externalKey ?? v.sku).toString();
            let requiresCustom = [];
            try {
                const parsed = JSON.parse(v.requiredFieldsJson);
                if (Array.isArray(parsed))
                    requiresCustom = parsed;
            }
            catch {
                // ignore
            }
            services[serviceKey] = {
                SERVICEID: v.serviceId ?? 0,
                SERVICETYPE: groupType,
                QNT: '0',
                SERVER: '1',
                MINQNT: '0',
                MAXQNT: '0',
                SERVICENAME: v.name,
                CREDIT: v.creditText ?? '',
                TIME: v.timeText ?? '',
                INFO: v.infoText ?? '',
                "Requires.Custom": requiresCustom
            };
        }
        result[groupName] = {
            GROUPNAME: groupName,
            GROUPTYPE: groupType,
            SERVICES: services
        };
    }
    return result;
}
