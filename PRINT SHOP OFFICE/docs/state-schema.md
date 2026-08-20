# Print Shop Office — State Schema

All runtime state is stored in `data/state.json`. Writes use atomic temp-rename to prevent corruption.

## Top-level keys

| Key | Type | Description |
|---|---|---|
| `products` | `Product[]` | Product catalog |
| `orders` | `Order[]` | All customer orders |
| `customers` | `Customer[]` | Customer records |
| `printJobs` | `PrintJob[]` | Print queue entries |
| `materials` | `Material[]` | Filament/resin stock |
| `approvalRequests` | `ApprovalRequest[]` | Human Gate queue |
| `artifacts` | `Artifact[]` | Generated images/assets |
| `settings` | `Settings` | Shop configuration |

---

## Product

```json
{
  "id": "prod_xxx",
  "name": "Dragon Figurine",
  "description": "...",
  "price_cents": 2500,
  "images": ["https://..."],
  "filament_grams": 60,
  "print_hours": 4.5,
  "status": "draft | active | archived",
  "stripe_product_id": "prod_stripe_xxx",
  "stripe_price_id": "price_stripe_xxx",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "published_at": "ISO8601"
}
```

Status flow: `draft → active → archived`

---

## Order

```json
{
  "id": "ord_xxx",
  "customer_id": "cust_xxx",
  "product_id": "prod_xxx",
  "quantity": 1,
  "total_cents": 2500,
  "status": "pending | paid | printing | shipped | delivered | refunded",
  "stripe_payment_intent": "pi_xxx",
  "stripe_session_id": "cs_xxx",
  "shipping_address": { "line1": "...", "city": "...", "country": "US" },
  "tracking_number": "",
  "carrier": "",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "refund_id": "",
  "refund_reason": "",
  "notes": ""
}
```

Status flow: `pending → paid → printing → shipped → delivered` (or `refunded`)

---

## Customer

```json
{
  "id": "cust_xxx",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "",
  "created_at": "ISO8601"
}
```

---

## PrintJob

```json
{
  "id": "job_xxx",
  "order_id": "ord_xxx",
  "product_id": "prod_xxx",
  "status": "queued | printing | done",
  "material_id": "mat_pla_black",
  "notes": "",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

---

## Material

```json
{
  "id": "mat_pla_black",
  "name": "PLA Black",
  "type": "PLA | Resin | PETG | ABS | TPU",
  "color": "Black",
  "grams_available": 1000,
  "cost_per_gram_cents": 3,
  "updated_at": "ISO8601"
}
```

---

## ApprovalRequest (Human Gate)

```json
{
  "id": "apr_xxx",
  "tool": "issue_refund",
  "input": { "order_id": "ord_xxx", "reason": "Customer request" },
  "status": "pending | approved | denied | timeout",
  "created_at": "ISO8601",
  "resolved_at": "ISO8601",
  "deny_reason": ""
}
```

---

## Settings

```json
{
  "shopName": "My 3D Print Shop",
  "stripeMode": "test | live",
  "currency": "usd",
  "defaultShippingDays": 5
}
```
