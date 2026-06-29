# API Reference

## KeyMate API

Base URL: `https://keygen-keymate.commercians.com/v1`

Auth: `X-API-Key` header (Keygen Token with `license.validate` permission)

### POST /v1/saas/licenses/verify

Main endpoint for license verification. Either `license_key` or `api_key` (header) must be provided.

**Request:**
```bash
curl -X POST https://keygen-keymate.commercians.com/v1/saas/licenses/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <order-api-token>" \
  -d '{
    "license_key": "ABCD-EFGH-IJKL-MNOP",
    "domain": "client-store.com"
  }'
```

**Response 200 (Valid):**
```json
{
  "valid": true,
  "plan": {
    "id": "uuid",
    "name": "Growth",
    "planType": "fixed",
    "price": 5000.0
  },
  "features": [
    "admin_brands",
    "storefront_cart",
    "admin_orders",
    "admin_customers"
  ],
  "limits": {
    "max_staff_users": 5,
    "max_products": 500,
    "max_monthly_orders": 2000,
    "storage_gb": 5,
    "max_customers": 2000
  },
  "domains": ["client-store.com", "admin.client-store.com"],
  "expiry": "2026-12-31T23:59:59Z",
  "lastCheckIn": "2026-06-29T10:30:00Z"
}
```

**Response 200 (Not Found):**
```json
{
  "valid": false,
  "code": "license_not_found",
  "detail": null
}
```

**Response 200 (Expired):**
```json
{
  "valid": false,
  "code": "license_expired",
  "detail": "License expired"
}
```

**Response 200 (Domain Mismatch):**
```json
{
  "valid": false,
  "code": "domain_mismatch",
  "detail": "Domain wrong-domain.com not in allowed list"
}
```

**Response 200 (Banned/Suspended):**
```json
{
  "valid": false,
  "code": "license_banned"
}
```

**Response 200 (Order Cancelled):**
```json
{
  "valid": false,
  "code": "order_cancelled"
}
```

### POST /v1/saas/licenses/:id/check-in

Same as verify but refreshes `last_check_in_at` on the license record.

**Request:**
```bash
curl -X POST https://keygen-keymate.commercians.com/v1/saas/licenses/uuid/check-in \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <order-api-token>" \
  -d '{
    "domain": "client-store.com"
  }'
```

**Response 200:** Same as verify.

**Response 422 (Domain Mismatch):**
```json
{
  "valid": false,
  "code": "domain_mismatch"
}
```

### GET /v1/saas/licenses/:id/status

Alias for verify — returns current license status without side effects.

**Request:**
```bash
curl -X GET https://keygen-keymate.commercians.com/v1/saas/licenses/uuid/status \
  -H "X-API-Key: <order-api-token>"
```

**Response 200:** Same as verify.

---

## EcoMate NestJS API

Base URL: `https://client-store.com/api`

Auth: Clerk httpOnly cookie (admin) or none (public endpoints)

### GET /api/gateways

Public. List enabled payment gateways for storefront.

**Request:**
```bash
curl https://client-store.com/api/gateways
```

**Response 200:**
```json
[
  {
    "id": "uuid",
    "code": "bkash",
    "name": "bKash (Manual)",
    "type": "manual",
    "paymentOptionType": "FULL_PAYMENT",
    "paymentOptionName": "Full Payment",
    "enabled": true,
    "mode": "personal",
    "phoneNumber": "01700000000"
  }
]
```

### GET /api/gateways/admin

Admin. List all gateways (including disabled). Requires `admin_payments` feature.

**Request:**
```bash
curl https://client-store.com/api/gateways/admin \
  -H "Cookie: <session-cookie>"
```

**Response 200:**
```json
[
  {
    "id": "uuid",
    "code": "cash",
    "name": "Cash",
    "type": "cash",
    "paymentOptionType": "CASH_ON_DELIVERY",
    "paymentOptionName": "Cash on Delivery",
    "enabled": true,
    "mode": "personal",
    "phoneNumber": null,
    "credentials": {},
    "sortOrder": 1
  }
]
```

### POST /api/gateways

Admin. Create a new payment gateway.

**Request:**
```bash
curl -X POST https://client-store.com/api/gateways \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{
    "code": "mygateway",
    "name": "My Gateway",
    "type": "manual",
    "paymentOptionType": "FULL_PAYMENT",
    "enabled": true,
    "mode": "personal",
    "phoneNumber": "01712345678",
    "sortOrder": 10
  }'
```

**Response 201:** Returns created gateway object.

### PUT /api/gateways/:code

Admin. Upsert a payment gateway by code.

**Request:**
```bash
curl -X PUT https://client-store.com/api/gateways/bkash \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{
    "name": "bKash (Updated)",
    "enabled": true,
    "phoneNumber": "01711111111"
  }'
```

**Response 200:** Returns upserted gateway.

### GET /api/gateways/options

Admin. List payment options with their gateways.

**Request:**
```bash
curl https://client-store.com/api/gateways/options \
  -H "Cookie: <session-cookie>"
```

**Response 200:**
```json
[
  {
    "id": "uuid",
    "type": "FULL_PAYMENT",
    "name": "Full Payment",
    "description": "Pay the full order amount online",
    "enabled": true,
    "sortOrder": 1,
    "gateways": []
  }
]
```

### PUT /api/gateways/options/:type

Admin. Update or create a payment option.

**Request:**
```bash
curl -X PUT https://client-store.com/api/gateways/options/PARTIAL_PAYMENT \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{
    "enabled": true,
    "description": "Pay partial, rest on delivery"
  }'
```

**Response 200:** Returns upserted payment option.

### GET /api/gateways/product-overrides/:productId

Admin. Get payment option overrides for a product.

**Response 200:**
```json
[
  {
    "productId": "uuid",
    "paymentOptionType": "PARTIAL_PAYMENT",
    "enabled": true,
    "partialPercentage": 30.0,
    "paymentOption": { "type": "PARTIAL_PAYMENT", "name": "Partial Payment" }
  }
]
```

### PUT /api/gateways/product-overrides/:productId/:type

Admin. Set partial payment config per product.

**Request:**
```bash
curl -X PUT https://client-store.com/api/gateways/product-overrides/uuid/PARTIAL_PAYMENT \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{
    "enabled": true,
    "partialPercentage": 30
  }'
```

### GET /api/gateways/:code

Admin. Get single gateway by code.

### GET /api/license/status

Public. Returns current license validation status of the EcoMate server.

```bash
curl https://client-store.com/api/license/status
```

**Response 200:**
```json
{
  "license": {
    "valid": true,
    "plan": { "id": "uuid", "name": "Growth", "planType": "fixed", "price": 5000 },
    "features": ["admin_orders", "admin_customers"],
    "limits": { "max_products": 500 },
    "expiry": "2026-12-31T23:59:59Z"
  },
  "active": true
}
```
