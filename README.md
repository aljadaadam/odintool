# odintool

سيرفر Node.js/TypeScript مبني على Express + SQLite.

يوفّر 4 مسارات رئيسية:

1) **Partner API** متوافق مع DHru/GsmHub عبر `GET/POST /api/index.php`.
2) **Admin API** لإدارة الشركاء/الطلبات/الزوار (محمية بـ `ADMIN_TOKEN`).
3) **Visitor Wallet** صفحات HTML + JSON (`/buy`/`/check`/`/profile`) لتفعيل مباشر عند توفر الرصيد.
4) **Webhook** HMAC لإنشاء ترخيص من أنظمة خارجية (`POST /webhook/purchase`).

## Base URL

- محليًا: `http://localhost:3001`
- خلف Nginx على مسار (مثال): `https://example.com/odintool/`

ملاحظة: عند العمل على مسار فرعي مثل `/odintool/` كل الروابط ستكون تحت هذا الـprefix.

## المتطلبات

- Node.js (يفضّل LTS 20+)
- npm

## الإعداد (Environment)

انسخ ملف الإعداد:

```bash
cp .env.example .env
```

أهم المتغيرات:

- `PORT`: المنفذ (افتراضيًا 3001)
- `DB_PATH`: مسار SQLite
- `ADMIN_TOKEN`: توكن واجهات الإدارة
- `WEBHOOK_SECRET`: سرّ توقيع Webhook
- `ALLOW_ENV_PARTNER_FALLBACK`: **افتراضيًا 0** (يعطّل أي توثيق partner من env)

مهم: لإنشاء شركاء Partner بشكل صحيح استخدم `/admin/partners` (ولا تعتمد على env fallback إلا مؤقتًا وبشكل مقصود).

## التشغيل

تثبيت الحزم:

```bash
npm ci
```

تشغيل تطوير:

```bash
npm run dev
```

Build للإنتاج:

```bash
npm run build
npm run start
```

## تشغيل عبر systemd (Ubuntu)

مثال ملف خدمة (عدّل المستخدم والمسارات حسب بيئتك):

```ini
[Unit]
Description=odintool
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/odintool
EnvironmentFile=/var/www/odintool/.env
ExecStart=/usr/bin/node /var/www/odintool/dist/index.js
Restart=always
RestartSec=2
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

ثم:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now odintool
sudo systemctl status odintool --no-pager
```

## Nginx (Reverse Proxy) على مسار `/odintool/`

مثال minimal:

```nginx
location /odintool/ {
  proxy_pass http://127.0.0.1:3001/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# توصية: أوقف الضغط/التحويل تحديدًا لـ DHru endpoint
location = /odintool/api/index.php {
  gzip off;
  proxy_pass http://127.0.0.1:3001/api/index.php;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Fortinet (ملاحظات ربط)

الربط المعتاد يكون: Internet → Fortinet → Nginx (443) → odintool (localhost:3001).

نقاط مهمة غالبًا:

- افتح/حوّل 443 فقط إلى Nginx (لا تفتح 3001 خارجيًا).
- لو تستخدم WAF/IPS/SSL inspection: تجنّب أي **تحويل/ضغط** على مسار `/api/index.php` لأن بعض عملاء DHru حسّاسين.
- استخدم allow-list لـ IPs إن كان DHru client ثابت، أو على الأقل rate-limit على Nginx.

---

## Health

- `GET /health` → `{ ok: true }`

## Admin API (محمية بـ `x-admin-token`)

كل طلب Admin يجب أن يرسل header:

- `x-admin-token: <ADMIN_TOKEN>`

### إنشاء Partner

- `POST /admin/partners`

Body:

```json
{ "username": "partner1", "email": "p1@example.com", "balanceCredits": 350, "role": "reseller", "allowAllVariants": true }
```

Response (يعيد `apiaccesskey` مرة واحدة فقط):

```json
{ "ok": true, "username": "partner1", "apiaccesskey": "..." }
```

### تقارير سريعة (للبيع/المراقبة)

- `GET /admin/reports/summary` → totals + breakdowns + sums

### استعراض Partner وطلباته

- `GET /admin/partners/:username?limit=100`

### استعراض الطلبات (licenses)

- `GET /admin/orders?limit=200&username=partner1`
- `GET /admin/orders?limit=200&partnerId=1`

### سجل أحداث الطلب

- `GET /admin/orders/:orderId/logs`

### تغيير حالة ترخيص (licenses)

- `PATCH /admin/orders/:orderId/status`

Body:

```json
{ "status": "active" }
```

Allowed: `active | pending | processing | inprocess | rejected | refunded`.

### زوّار (Visitor Wallet)

- `POST /admin/visitors` → ينشئ زائر ويعيد `accessCode` مرة واحدة
- `PATCH /admin/visitors/:email/balance` → يضبط الرصيد

Endpoint اختياري/قديم (عادة غير مطلوب لأن `/buy` يفعّل مباشرة عند توفر الرصيد):

- `POST /admin/visitor-orders/:referenceId/activate`

---

## Visitor endpoints

### شراء/تفعيل مباشر

- `GET /buy` (HTML)
- `POST /buy` (JSON)

Body (form-urlencoded أو JSON):

- `accessCode`, `email`, `sku`, `imei`, `name`, `phone`, `country`

Response عند النجاح:

```json
{ "ok": true, "referenceId": "1234567", "licenseKey": "...", "activatedAt": "...", "expiresAt": "..." }
```

### متابعة الطلب

- `GET /check` (HTML)
- `POST /check` (JSON)

Body:

- `accessCode`, `referenceId`, `email`

يرجع `licenseKey` فقط إذا كانت الحالة `active`.

### ملف الزائر

- `GET /profile` (HTML)
- `POST /profile` (JSON)

Body:

- `email`, `accessCode`
- اختياري: `includeOrders=1` و `limit=20`

---

## Partner API (DHru-compatible)

Endpoint:

- `GET /api/index.php`
- `POST /api/index.php`

يدعم استقبال القيم من:

- body (form-data أو x-www-form-urlencoded)
- query string
- headers (`username` أو `x-username` ... إلخ)

Fields الأساسية:

- `username`
- `apiaccesskey`
- `requestformat=JSON`
- `action`

شكل الأخطاء (دائمًا HTTP 200):

```json
{ "ERROR": [ { "MESSAGE": "..." } ], "apiversion": "2025.03" }
```

### Actions المدعومة

- `accountinfo`
- `imeiservicelist`
- `placeorder` أو `placeimeiorder`
- `placeimeiorderbulk`
- `getimeiorder`
- `getimeiorderbulk`
- `orderslist`

### placeimeiorder / placeorder

Required:

- `service` (يمكن أن يكون `sku` أو `externalKey` أو `serviceId`)

Optional:

- `recipient_email` (وإلا يستخدم email الخاص بالـpartner)
- `customfields` (JSON string)

كما يدعم DHru `parameters` (base64(JSON)) أو XML داخل `<PARAMETERS>` مع `ID/IMEI/customfield`.

Response:

```json
{ "SUCCESS": [ { "MESSAGE": "Order received", "REFERENCEID": "1234567" } ], "apiversion": "2025.03" }
```

### getimeiorder

يرجع حالة رقمية:

- `STATUS`: 0 جديد/غير موجود، 1 قيد المعالجة، 3 رفض/Refund، 4 متاح
- `CODE`: مفتاح الترخيص فقط عندما `STATUS=4`

يمرر `ID` أو `REFERENCEID` أو `ORDERID` (داخل parameters).

### orderslist

Optional:

- `limit` (افتراضي 50)

يرجع فقط طلبات الـpartner الحالي.

---

## Webhook (HMAC)

- `POST /webhook/purchase`

Body:

```json
{ "orderId": "order_123", "email": "buyer@example.com", "productId": "muslim-odin-1y" }
```

Headers:

- `x-timestamp`: Unix ms
- `x-signature`: HMAC-SHA256 hex على `"{timestamp}.{rawJsonBody}"` باستخدام `WEBHOOK_SECRET`

ملاحظة: السيرفر يرفض أي طلب أقدم من 5 دقائق.
