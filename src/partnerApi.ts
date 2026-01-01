import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { listInventoryPartnerJson } from './products';
import { generateLicenseKey, listLicenses } from './licenses';
import { getVariantByProductId, getVariantByExternalKey, getVariantBySku } from './products';
import {
  partnersCount,
  verifyPartner,
  listAllowedVariantSkus,
  getPartnerByUsername
} from './partners';
import { getDb } from './db';

function getField(req: Request, key: string) {
  const bodyVal = (req.body as any)?.[key];
  if (bodyVal !== undefined && bodyVal !== null && String(bodyVal).length > 0) return String(bodyVal);
  const headerVal = req.header(key);
  if (headerVal !== undefined && headerVal !== null && String(headerVal).length > 0) return String(headerVal);
  // Some clients might send x- prefixed headers
  const headerValX = req.header(`x-${key}`);
  if (headerValX !== undefined && headerValX !== null && String(headerValX).length > 0) return String(headerValX);
  return undefined;
}

export function handlePartnerApi(req: Request, res: Response) {
  const username = getField(req, 'username') ?? '';
  const apiaccesskey = getField(req, 'apiaccesskey') ?? '';
  const requestformat = (getField(req, 'requestformat') ?? 'JSON').toUpperCase();
  const action = (getField(req, 'action') ?? '').toLowerCase();

  let authedPartner:
    | {
        id: number;
        username: string;
        balanceCredits: number;
        role: string;
      }
    | undefined;

  const hasPartners = partnersCount() > 0;
  if (hasPartners) {
    const row = verifyPartner(username, apiaccesskey);
    if (!row) return res.status(401).json({ ERROR: 1, MESSAGE: 'Authentication failed' });
    authedPartner = {
      id: (row as any).id,
      username: (row as any).username,
      balanceCredits: Number((row as any).balanceCredits ?? 0),
      role: String((row as any).role ?? 'reseller')
    };
  } else {
    // Fallback for first-time setup
    const expectedUser = process.env.PARTNER_USERNAME;
    const expectedKey = process.env.PARTNER_APIACCESSKEY;

    if (!expectedUser || !expectedKey) {
      return res.status(500).json({ ERROR: 1, MESSAGE: 'Partner credentials not configured' });
    }
    if (username !== expectedUser || apiaccesskey !== expectedKey) {
      return res.status(401).json({ ERROR: 1, MESSAGE: 'Authentication failed' });
    }
    // no DB-backed partner => no filtering/balance
  }

  if (requestformat !== 'JSON') {
    return res.status(400).json({ ERROR: 1, MESSAGE: 'Only JSON supported' });
  }

  if (action === 'imeiservicelist') {
    // Return only services allowed for this partner
    if (authedPartner) {
      const allowedSkus = listAllowedVariantSkus(authedPartner.id);
      return res.status(200).json(listInventoryPartnerJson({ allowedSkus }));
    }
    return res.status(200).json(listInventoryPartnerJson());
  }

  if (action === 'placeorder' || action === 'placeimeiorder') {
    if (!authedPartner) {
      return res.status(400).json({ ERROR: 1, MESSAGE: 'Partner DB auth required for placeorder' });
    }

    const service = getField(req, 'service') ?? '';
    const recipientEmail = getField(req, 'recipient_email') ?? '';
    const customFieldsRaw = getField(req, 'customfields');

    if (!service) return res.status(400).json({ ERROR: 1, MESSAGE: 'Missing service' });
    if (!recipientEmail) return res.status(400).json({ ERROR: 1, MESSAGE: 'Missing recipient_email' });

    // Resolve service by sku or externalKey
    const variant = getVariantByProductId(service);
    if (!variant) return res.status(400).json({ ERROR: 1, MESSAGE: 'Unknown service' });

    const allowedSkus = listAllowedVariantSkus(authedPartner.id);
    if (!allowedSkus.has(variant.sku)) {
      return res.status(403).json({ ERROR: 1, MESSAGE: 'Service not allowed' });
    }

    // Parse custom fields JSON (optional)
    let customFields: any = undefined;
    if (customFieldsRaw) {
      try {
        customFields = JSON.parse(customFieldsRaw);
      } catch {
        // Allow plain string
        customFields = { value: customFieldsRaw };
      }
    }

    // Validate required custom fields (from variant.requiredFieldsJson)
    try {
      const requires = JSON.parse(variant.requiredFieldsJson ?? '[]');
      if (Array.isArray(requires)) {
        for (const f of requires) {
          if (f && typeof f === 'object' && f.required === 'on' && typeof f.fieldname === 'string') {
            const key = f.fieldname;
            const hasValue =
              customFields &&
              typeof customFields === 'object' &&
              customFields[key] !== undefined &&
              String(customFields[key]).trim().length > 0;
            if (!hasValue) {
              return res.status(400).json({
                ERROR: 1,
                MESSAGE: `Missing required custom field: ${key}`
              });
            }
          }
        }
      }
    } catch {
      // ignore invalid schema
    }

    const db = getDb();
    const creditCost = Number((variant as any).creditCost ?? 0);

    try {
      const result = db.transaction(() => {
        const partner = db
          .prepare('SELECT * FROM partners WHERE id = ? LIMIT 1')
          .get(authedPartner!.id) as any;

        if (!partner || Number(partner.active) !== 1) {
          throw new Error('Partner inactive');
        }

        const balance = Number(partner.balanceCredits ?? 0);
        if (balance < creditCost) {
          throw new Error('Insufficient balance');
        }

        const newBalance = balance - creditCost;
        db.prepare('UPDATE partners SET balanceCredits = ? WHERE id = ?').run(newBalance, partner.id);

        const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const licenseKey = generateLicenseKey();
        const activatedAt = new Date().toISOString();
        const expiresAt = new Date(activatedAt);
        const years = Number((variant as any).durationYears ?? 0);
        if (years > 0) expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + years);

        db.prepare(
          'INSERT INTO licenses (orderId, email, productId, durationYears, activatedAt, expiresAt, partnerId, customFieldsJson, licenseKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          orderId,
          recipientEmail,
          variant.sku,
          years,
          activatedAt,
          years > 0 ? expiresAt.toISOString() : null,
          partner.id,
          customFields ? JSON.stringify(customFields) : null,
          licenseKey
        );

        return {
          ORDERID: orderId,
          LICENSEKEY: licenseKey,
          EXPIRESAT: years > 0 ? expiresAt.toISOString() : null,
          BALANCE: newBalance
        };
      })();

      return res.status(200).json({ ERROR: 0, MESSAGE: 'OK', ...result });
    } catch (e: any) {
      const msg = String(e?.message ?? 'Error');
      if (msg === 'Insufficient balance') {
        return res.status(400).json({ ERROR: 1, MESSAGE: 'Insufficient balance' });
      }
      return res.status(400).json({ ERROR: 1, MESSAGE: msg });
    }
  }

  if (action === 'orderslist') {
    const limitRaw = getField(req, 'limit');
    const limit = limitRaw ? Number(limitRaw) : 50;
    const rows = listLicenses({ limit });

    const orders: Record<string, any> = {};
    for (const row of rows) {
      orders[String(row.orderId)] = {
        ORDERID: row.orderId,
        EMAIL: row.email,
        SERVICE: row.productId,
        LICENSEKEY: row.licenseKey,
        STATUS: row.status,
        ACTIVATEDAT: row.activatedAt,
        EXPIRESAT: row.expiresAt,
        CREATEDAT: row.createdAt
      };
    }

    return res.status(200).json({ ERROR: 0, MESSAGE: 'OK', ORDERS: orders });
  }

  return res.status(400).json({ ERROR: 1, MESSAGE: 'Unknown action' });
}
