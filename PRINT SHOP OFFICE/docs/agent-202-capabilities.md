# Agent 202 — Capabilities Reference

Agent 202 is the AI operator for the Print Shop Office. Powered by Claude (claude-sonnet-4-6) via the Anthropic SDK. Uses SSE streaming and the Human Gate pattern.

## Safe Tools (no approval required)

| Tool | What it does |
|---|---|
| `list_products` | Returns product catalog, filterable by status |
| `list_orders` | Returns orders, filterable by status |
| `get_order` | Returns a single order with customer + product detail |
| `estimate_print_job` | Calculates print time, material cost, and suggested price |
| `generate_product_description` | Drafts a product listing description (text only) |
| `generate_social_post` | Drafts a TikTok/Instagram caption for a product |
| `draft_customer_email` | Drafts an order update email (does NOT send) |
| `check_material_stock` | Returns filament/material inventory |

## Human Gate Tools (operator must approve)

| Tool | Gate reason |
|---|---|
| `create_product` | Creates a persistent product record |
| `update_product_price` | Changes pricing |
| `publish_product` | Makes product visible to customers |
| `issue_refund` | Moves money via Stripe |
| `send_customer_email` | Contacts a real customer |
| `update_order_status` | Modifies a live order |
| `add_tracking_number` | Modifies a live order |
| `create_stripe_product` | Creates Stripe product/price objects |

## Human Gate Flow

1. Agent 202 decides to call a gated tool
2. Server creates an `ApprovalRequest` in `state.json` with status `pending`
3. SSE emits a `human_gate` event to the frontend
4. Frontend displays an Approve/Deny card in the chat
5. Operator clicks Approve → `POST /api/approvals/:id/approve`
6. Server marks approval `approved` → Agent 202's wait loop unblocks → tool executes
7. Or Deny → Agent 202 receives error result and informs the user

Approvals time out after 5 minutes if not resolved.

## System Prompt (summary)

Agent 202 is briefed as the AI operator of a 3D printing business. It:
- Knows the shop name and current date
- Uses dollars (not cents) when talking to humans
- Proposes and explains gated actions before requesting approval
- Never autonomously publishes, charges, or contacts customers

## Example Prompts

- "List all orders that are paid and waiting to print"
- "Estimate the cost of a 75g 6-hour PLA print"
- "Draft a product description for a dragon figurine"
- "Write an Instagram post for product prod_xxx"
- "Draft a shipping notification email for order ord_xxx"
- "How much black PLA filament do we have left?"
- "Create a new product called 'Mini Succulent Pot' at $12.99, 30g, 2 hours"
- "Mark order ord_xxx as shipped"
