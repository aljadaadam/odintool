import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { verifyWebhookSignature } from './webhookSecurity';
import { createOrGetLicense } from './licenses';
import { getVariantByProductId } from './products';
import { handlePartnerApi } from './partnerApi';
import { createPartner } from './partners';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const upload = multer();

// DHru-like compatibility endpoint (accepts form-data)
app.post('/api/index.php', upload.none(), handlePartnerApi);

const createPartnerSchema = z.object({
  username: z.string().min(3),
  balanceCredits: z.number().nonnegative().optional(),
  role: z.string().min(1).optional(),
  allowAllVariants: z.boolean().optional()
});

app.post('/admin/partners', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(500).json({ ok: false, error: 'ADMIN_TOKEN not configured' });
  }

  const provided = String(req.header('x-admin-token') ?? '');
  if (provided !== adminToken) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const parsed = createPartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  try {
    const partner = createPartner({
      username: parsed.data.username,
      balanceCredits: parsed.data.balanceCredits,
      role: parsed.data.role,
      allowAllVariants: parsed.data.allowAllVariants
    });
    // Return the raw key ONCE
    return res.status(201).json({ ok: true, ...partner });
  } catch {
    return res.status(409).json({ ok: false, error: 'Username already exists' });
  }
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});


const purchaseSchema = z.object({
  orderId: z.string().min(1),
  email: z.string().email(),
  productId: z.string().min(1)
});

app.post('/webhook/purchase', verifyWebhookSignature, (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const variant = getVariantByProductId(parsed.data.productId);
  if (!variant) {
    return res.status(400).json({ ok: false, error: 'Unknown productId (sku)' });
  }

  const license = createOrGetLicense({
    orderId: parsed.data.orderId,
    email: parsed.data.email,
    productId: parsed.data.productId,
    durationYears: Number(variant.durationYears)
  });
  return res.status(200).json({
    ok: true,
    licenseKey: license.licenseKey,
    status: license.status,
    expiresAt: license.expiresAt
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[odintool] API listening on http://localhost:${port}`);
});
