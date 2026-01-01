import { getDb } from './db';

export type ProductRow = {
  id: string;
  name: string;
  productType: string;
  createdAt: string;
};

export type ProductVariantRow = {
  sku: string;
  productId: string;
  name: string;
  externalKey: string | null;
  serviceId: number | null;
  durationYears: number;
  activationMode: string;
  requiredFieldsJson: string;
  requiredAction: string;
  variantType: string;
  creditText: string;
  creditCost: number;
  timeText: string;
  infoText: string;
  createdAt: string;
};

export function listInventory() {
  const db = getDb();

  const products = db
    .prepare('SELECT * FROM products ORDER BY createdAt ASC')
    .all() as ProductRow[];

  const variants = db
    .prepare('SELECT * FROM product_variants ORDER BY createdAt ASC')
    .all() as ProductVariantRow[];

  return {
    products,
    variants
  };
}

export function getVariantBySku(sku: string) {
  const db = getDb();

  return db
    .prepare('SELECT * FROM product_variants WHERE sku = ? LIMIT 1')
    .get(sku) as ProductVariantRow | undefined;
}

export function getVariantByExternalKey(externalKey: string) {
  const db = getDb();

  return db
    .prepare('SELECT * FROM product_variants WHERE externalKey = ? LIMIT 1')
    .get(externalKey) as ProductVariantRow | undefined;
}

export function getVariantByProductId(productId: string) {
  // Accept either sku (e.g. muslim-odin-1y) OR external service key (e.g. 18153)
  return getVariantBySku(productId) ?? getVariantByExternalKey(productId);
}

export function listInventoryPartnerJson(params?: { allowedSkus?: Set<string> }) {
  const { products, variants } = listInventory();

  const byProductId = new Map<string, ProductVariantRow[]>();
  for (const v of variants) {
    const list = byProductId.get(v.productId) ?? [];
    list.push(v);
    byProductId.set(v.productId, list);
  }

  const result: Record<string, any> = {};

  for (const p of products) {
    const groupName = p.name;
    const groupType = p.productType;
    const services: Record<string, any> = {};

    const productVariants = byProductId.get(p.id) ?? [];
    for (const v of productVariants) {
      if (params?.allowedSkus && !params.allowedSkus.has(v.sku)) continue;
      const serviceKey = (v.externalKey ?? v.sku).toString();
      let requiresCustom: any[] = [];

      try {
        const parsed = JSON.parse(v.requiredFieldsJson);
        if (Array.isArray(parsed)) requiresCustom = parsed;
      } catch {
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
