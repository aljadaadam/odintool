"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const webhookSecurity_1 = require("./webhookSecurity");
const licenses_1 = require("./licenses");
const products_1 = require("./products");
const partnerApi_1 = require("./partnerApi");
const partners_1 = require("./partners");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '1mb' }));
app.use(express_1.default.urlencoded({ extended: false }));
const upload = (0, multer_1.default)();
// DHru-like compatibility endpoint (accepts form-data)
app.post('/api/index.php', upload.none(), partnerApi_1.handlePartnerApi);
const createPartnerSchema = zod_1.z.object({
    username: zod_1.z.string().min(3),
    balanceCredits: zod_1.z.number().nonnegative().optional(),
    role: zod_1.z.string().min(1).optional(),
    allowAllVariants: zod_1.z.boolean().optional()
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
        const partner = (0, partners_1.createPartner)({
            username: parsed.data.username,
            balanceCredits: parsed.data.balanceCredits,
            role: parsed.data.role,
            allowAllVariants: parsed.data.allowAllVariants
        });
        // Return the raw key ONCE
        return res.status(201).json({ ok: true, ...partner });
    }
    catch {
        return res.status(409).json({ ok: false, error: 'Username already exists' });
    }
});
app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
});
const purchaseSchema = zod_1.z.object({
    orderId: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    productId: zod_1.z.string().min(1)
});
app.post('/webhook/purchase', webhookSecurity_1.verifyWebhookSignature, (req, res) => {
    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }
    const variant = (0, products_1.getVariantByProductId)(parsed.data.productId);
    if (!variant) {
        return res.status(400).json({ ok: false, error: 'Unknown productId (sku)' });
    }
    const license = (0, licenses_1.createOrGetLicense)({
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
