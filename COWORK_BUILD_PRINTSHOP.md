# Cowork Build Prompt — 3D Print Shop Office
# Paste the block below into a new Cowork session to start the build.

---

## HOW TO USE THIS FILE

1. Open a new Cowork session
2. Copy everything between the === START === and === END === lines
3. Paste it as your first message
4. Claude will build the entire system

---

=== START ===

I need you to build a complete **3D Print Shop Office** for my Argentum OS project.

Argentum OS is a supervised AI operating company console. It already has one business module called **Clipping Office** (a content clipping and posting system built in Node.js). I need a second module built the same way — a standalone **3D Print Shop Office** that handles the full order lifecycle for a 3D printing business, with its own Agent (Agent 202) powered by the Anthropic Claude API.

**My workspace folder is at `/Volumes/ZYLO/Argentum/`.**
The new module should live at `/Volumes/ZYLO/Argentum/PRINT SHOP OFFICE/`.

---

## What This Business Does

I 3D print physical products (figurines, custom parts, enclosures, prototypes, etc.) and ship them to customers. I need a system that:

- Lets customers browse products and place orders via a website
- Collects payment via Stripe
- Manages the full order queue (new → printing → shipped → delivered)
- Generates product images and descriptions using AI
- Tracks filament/material costs per print
- Lets Agent 202 handle routine tasks (update listings, draft emails, estimate print times, generate social content)
- Requires Human Gate approval before anything touches money, customer data, or shipping

---

## Architecture to Follow

Match the Clipping Office pattern exactly:

```
PRINT SHOP OFFICE/
├── server.js           # Node.js HTTP server, all routes, Agent 202 tool loop
├── package.json
├── .env.example        # All env var placeholders, no real values
├── data/
│   └── state.json      # Runtime state (orders, products, customers, jobs)
├── public/
│   ├── index.html      # Single-page app shell
│   ├── app.js          # Vanilla JS frontend, same pattern as Clipping Office
│   └── styles.css      # Dark theme matching Argentum OS color vars
├── services/
│   ├── stripe-service.js       # Stripe checkout, webhook handler
│   ├── image-gen-service.js    # DALL-E / Stability AI image generation
│   ├── email-service.js        # Resend/Sendgrid order confirmation emails
│   └── print-estimator.js      # Print time + cost estimator
├── storefront/
│   ├── index.html      # Public-facing shop (customers see this)
│   ├── shop.js
│   └── shop.css
├── agent/
│   └── agent-tools.js  # All Agent 202 tools (Anthropic tool-use format)
└── docs/
    ├── state-schema.md
    └── agent-202-capabilities.md
```

---

## State Schema (state.json shape)

```json
{
  "products": [],
  "orders": [],
  "customers": [],
  "printJobs": [],
  "materials": [],
  "approvalRequests": [],
  "artifacts": [],
  "settings": {
    "shopName": "",
    "stripeMode": "test",
    "currency": "usd",
    "defaultShippingDays": 5
  }
}
```

**Product shape:**
```json
{
  "id": "prod_xxx",
  "name": "",
  "description": "",
  "price_cents": 0,
  "images": [],
  "filament_grams": 0,
  "print_hours": 0,
  "status": "draft | active | archived",
  "stripe_price_id": "",
  "created_at": ""
}
```

**Order shape:**
```json
{
  "id": "ord_xxx",
  "customer_id": "",
  "product_id": "",
  "quantity": 1,
  "total_cents": 0,
  "status": "pending | paid | printing | shipped | delivered | refunded",
  "stripe_payment_intent": "",
  "shipping_address": {},
  "tracking_number": "",
  "created_at": "",
  "notes": ""
}
```

---

## Agent 202 — Tools to Implement

Use the Anthropic Claude SDK (`@anthropic-ai/sdk`) with `claude-sonnet-4-6` as the model.
All tools follow the same Human Gate pattern as Agent 101 in the Clipping Office.

### Safe tools (no Human Gate required):
| Tool | What it does |
|---|---|
| `list_products` | Return all products from state |
| `list_orders` | Return orders, filterable by status |
| `get_order` | Return a single order by ID |
| `estimate_print_job` | Calculate time + filament cost for a product |
| `generate_product_description` | Write a product listing description using Claude |
| `generate_social_post` | Write a TikTok/Instagram caption for a product |
| `draft_customer_email` | Draft an order update email (does NOT send) |
| `check_material_stock` | Return current filament/material inventory |

### Human Gate required (operator must approve):
| Tool | Gate reason |
|---|---|
| `create_product` | Creates a live product listing |
| `update_product_price` | Changes pricing |
| `publish_product` | Makes product visible in storefront |
| `issue_refund` | Moves money |
| `send_customer_email` | Contacts a real customer |
| `update_order_status` | Marks order as shipped/delivered |
| `add_tracking_number` | Modifies a live order |
| `create_stripe_product` | Creates a Stripe product/price object |

---

## Frontend Views (app.js)

Build a single-page app with these nav views:

1. **Dashboard** — KPI cards: total orders, revenue this month, active print jobs, products live
2. **Orders** — sortable table of all orders, click to expand detail, status update button (Human Gate)
3. **Products** — product grid with images, draft/active/archived filter, "Add product" button
4. **Print Queue** — kanban board: To Print → Printing → Done, drag to update status
5. **Agent 202** — chat interface, same SSE streaming pattern as Clipping Office Agent 101
6. **Storefront Preview** — iframe preview of the public shop

---

## Storefront (public-facing shop)

Build a clean, fast customer-facing shop at `/storefront/index.html`:

- Product grid with images and prices
- "Order Now" button → Stripe Checkout (test mode by default)
- Order confirmation page after payment
- No login required for customers
- Mobile-friendly (most traffic will be from TikTok/Instagram links)

---

## Stripe Integration

- Use Stripe Checkout (hosted page) — no card data touches our server
- Webhook endpoint: `POST /api/stripe/webhook` — handles `checkout.session.completed`
- On webhook: create order in state.json, send confirmation email (Human Gate for real email)
- Test mode by default (`STRIPE_SECRET_KEY=sk_test_...`)
- Real mode requires Human Gate approval: `stripe_live_mode_enabled`

---

## Environment Variables (.env.example)

```
# Anthropic (Agent 202)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Image generation
OPENAI_API_KEY=sk-...

# Email
RESEND_API_KEY=re_...

# Shop
SHOP_NAME=My 3D Print Shop
SHOP_PORT=3001
SHOP_BASE_URL=http://localhost:3001

# Storage
PRINT_SHOP_DATA_DIR=data
```

---

## Integration with Argentum OS Main Console

After building the Print Shop Office module, update the **Argentum OS main launcher**:

1. Check if `/Volumes/ZYLO/Argentum/` has an `argentum-launcher.js` or `main.js` or `index.html` — if it does, add a "Print Shop Office" card to the main nav alongside the Clipping Office card.

2. If no main launcher exists, create a simple `/Volumes/ZYLO/Argentum/index.html` that acts as a launchpad with cards for each office:
   - **Clipping Office** → `http://localhost:3000`
   - **Print Shop Office** → `http://localhost:3001`
   - Matching dark theme, same color variables

3. Add a `start-all.sh` script at the Argentum root that launches all offices:
```bash
#!/bin/bash
echo "Starting Argentum OS..."
cd "CLIPPING OFFICE" && node server.js &
cd "../PRINT SHOP OFFICE" && node server.js &
echo "Clipping Office: http://localhost:3000"
echo "Print Shop Office: http://localhost:3001"
```

---

## Safety Rules (must be enforced throughout)

- Never store Stripe secret keys, customer card data, or payment tokens in state.json
- All money-moving actions require Human Gate approval
- Real/Practice mode separation: practice orders use fake Stripe test data and are labeled `PRACTICE ORDER`
- Agent 202 may draft and propose but never autonomously publish, charge, or contact customers
- `saveState()` must write to a temp file then rename (atomic write) — never direct overwrite
- All API keys come from environment variables only — never hardcoded
- No authentication = internal tool only, do not expose the admin port publicly
- Human Gate approves one bounded action at a time, never a global unlock

---

## Delivery Checklist

Before finishing, confirm each item exists and works:

- [ ] `PRINT SHOP OFFICE/server.js` — runs on port 3001 with `node server.js`
- [ ] `PRINT SHOP OFFICE/package.json` — all dependencies listed
- [ ] `PRINT SHOP OFFICE/.env.example` — all vars present, no real values
- [ ] `PRINT SHOP OFFICE/data/state.json` — valid initial empty state
- [ ] `PRINT SHOP OFFICE/public/index.html` + `app.js` + `styles.css` — admin UI
- [ ] `PRINT SHOP OFFICE/storefront/index.html` — public shop
- [ ] `PRINT SHOP OFFICE/services/stripe-service.js` — Stripe Checkout + webhook
- [ ] `PRINT SHOP OFFICE/agent/agent-tools.js` — all 16 tools defined
- [ ] Agent 202 tool loop in server.js — Claude SDK, SSE streaming, Human Gate wired
- [ ] Human Gate required for all money/customer/publish actions
- [ ] `/Volumes/ZYLO/Argentum/index.html` — main launchpad with both offices
- [ ] `/Volumes/ZYLO/Argentum/start-all.sh` — launches both offices

Do not stop until every item on this checklist is complete and the server starts without errors.

=== END ===
