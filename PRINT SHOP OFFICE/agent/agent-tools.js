// ─────────────────────────────────────────────────────────────────────────────
// Argentum OS — Agent 202 Tool Definitions
// All tools use Anthropic tool-use format.
// Tools marked HUMAN_GATE require operator approval before execution.
// ─────────────────────────────────────────────────────────────────────────────

/** Tool definitions for the Anthropic API */
const TOOL_DEFINITIONS = [
  // ── Safe tools ─────────────────────────────────────────────────────────────
  {
    name: 'list_products',
    description: 'Return all products from state, optionally filtered by status (draft|active|archived).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'active', 'archived', 'all'], description: 'Filter by status' }
      },
      required: []
    }
  },
  {
    name: 'list_orders',
    description: 'Return all orders, optionally filtered by status.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'paid', 'printing', 'shipped', 'delivered', 'refunded', 'all'],
          description: 'Filter by order status'
        }
      },
      required: []
    }
  },
  {
    name: 'get_order',
    description: 'Return a single order by ID, including customer and product details.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID (ord_xxx)' }
      },
      required: ['order_id']
    }
  },
  {
    name: 'estimate_print_job',
    description: 'Calculate estimated print time, filament cost, and suggested price for a product.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Product ID to estimate (uses its filament_grams and print_hours)' },
        filament_grams: { type: 'number', description: 'Override: filament grams to use' },
        print_hours: { type: 'number', description: 'Override: print hours to use' },
        material_id: { type: 'string', description: 'Material to use for cost calculation' }
      },
      required: []
    }
  },
  {
    name: 'generate_product_description',
    description: 'Write a compelling product listing description using Claude. Returns draft text only — does NOT update the product.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Product name' },
        product_type: { type: 'string', description: 'Type of item (figurine, enclosure, part, etc.)' },
        key_features: { type: 'array', items: { type: 'string' }, description: 'Key features or selling points' },
        tone: { type: 'string', enum: ['professional', 'playful', 'technical'], description: 'Tone of the description' }
      },
      required: ['product_name']
    }
  },
  {
    name: 'generate_social_post',
    description: 'Write a TikTok/Instagram caption for a product. Returns draft text only.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Product ID to write about' },
        platform: { type: 'string', enum: ['tiktok', 'instagram', 'twitter'], description: 'Target platform' },
        angle: { type: 'string', description: 'Creative angle or hook for the post' }
      },
      required: ['product_id', 'platform']
    }
  },
  {
    name: 'draft_customer_email',
    description: 'Draft an order update email for a customer. Returns draft text only — does NOT send it.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID to reference' },
        email_type: {
          type: 'string',
          enum: ['confirmation', 'printing_started', 'shipped', 'delayed', 'custom'],
          description: 'Type of email to draft'
        },
        custom_message: { type: 'string', description: 'Additional custom message to include' }
      },
      required: ['order_id', 'email_type']
    }
  },
  {
    name: 'check_material_stock',
    description: 'Return current filament/material inventory levels and costs.',
    input_schema: {
      type: 'object',
      properties: {
        material_id: { type: 'string', description: 'Optional: get a specific material only' }
      },
      required: []
    }
  },

  // ── Research tools (safe — read-only, no state changes) ───────────────────
  {
    name: 'research_trending_products',
    description: 'Use OpenAI with live web search to find real trending 3D printable products selling NOW on Etsy, Amazon, TikTok Shop. Returns ranked product ideas with pricing, competition level, and design sources.',
    input_schema: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Optional niche focus, e.g. "desk accessories", "gaming", "home decor", "pet products", "plant holders"' },
        count: { type: 'number', description: 'Number of product ideas to return (default 10, max 20)' }
      },
      required: []
    }
  },
  {
    name: 'analyze_product_opportunity',
    description: 'Deep market research on a specific product using live web search. Returns real competitor data, Etsy/Amazon price benchmarks, demand signals, marketing angles, STL sources, and a Go/Caution/Skip verdict.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Product to research, e.g. "cable management box", "succulent planter"' },
        product_description: { type: 'string', description: 'Optional brief description to narrow the research' }
      },
      required: ['product_name']
    }
  },
  {
    name: 'find_design_sources',
    description: 'Search Printables, Thingiverse, MakerWorld, and Cults3D for STL/design files for a product. Returns real links, license types, and commercial-use status.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Product to find designs for' },
        style: { type: 'string', description: 'Optional style preference, e.g. "minimalist", "detailed", "functional"' }
      },
      required: ['product_name']
    }
  },

  // ── Human Gate required ────────────────────────────────────────────────────
  {
    name: 'create_product_from_research',
    description: '[HUMAN GATE] Generate a complete optimized product spec from research data and create the product listing. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Product name to build a listing for' },
        research_data: { type: 'object', description: 'Optional: pass in result from analyze_product_opportunity' }
      },
      required: ['product_name']
    }
  },
  {
    name: 'create_product',
    description: '[HUMAN GATE] Create a new product listing in the shop. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Product name' },
        description: { type: 'string', description: 'Product description' },
        price_cents: { type: 'number', description: 'Price in cents (e.g. 2500 = $25.00)' },
        filament_grams: { type: 'number', description: 'Filament used in grams' },
        print_hours: { type: 'number', description: 'Estimated print time in hours' }
      },
      required: ['name', 'price_cents']
    }
  },
  {
    name: 'update_product_price',
    description: '[HUMAN GATE] Change the price of a product. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Product ID to update' },
        new_price_cents: { type: 'number', description: 'New price in cents' },
        reason: { type: 'string', description: 'Reason for price change' }
      },
      required: ['product_id', 'new_price_cents']
    }
  },
  {
    name: 'publish_product',
    description: '[HUMAN GATE] Make a product visible in the storefront. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Product ID to publish' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'issue_refund',
    description: '[HUMAN GATE] Issue a refund for an order. Requires operator approval. Touches money.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID to refund' },
        amount_cents: { type: 'number', description: 'Amount to refund in cents (leave blank for full refund)' },
        reason: { type: 'string', description: 'Reason for refund' }
      },
      required: ['order_id', 'reason']
    }
  },
  {
    name: 'send_customer_email',
    description: '[HUMAN GATE] Send an email to a customer. Requires operator approval. Contacts real person.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID (to look up customer email)' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' }
      },
      required: ['order_id', 'subject', 'body']
    }
  },
  {
    name: 'update_order_status',
    description: '[HUMAN GATE] Mark an order as shipped, delivered, or another status. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID to update' },
        new_status: {
          type: 'string',
          enum: ['printing', 'shipped', 'delivered', 'refunded'],
          description: 'New status'
        },
        notes: { type: 'string', description: 'Optional notes' }
      },
      required: ['order_id', 'new_status']
    }
  },
  {
    name: 'add_tracking_number',
    description: '[HUMAN GATE] Add a shipping tracking number to an order. Requires operator approval.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
        tracking_number: { type: 'string', description: 'Carrier tracking number' },
        carrier: { type: 'string', description: 'Shipping carrier (USPS, UPS, FedEx, etc.)' }
      },
      required: ['order_id', 'tracking_number']
    }
  },
  {
    name: 'create_stripe_product',
    description: '[HUMAN GATE] Create a Stripe product and price object. Requires operator approval. Modifies live Stripe account.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Local product ID to sync to Stripe' }
      },
      required: ['product_id']
    }
  }
];

/** Tools that require Human Gate approval before execution */
const HUMAN_GATE_TOOLS = new Set([
  'create_product_from_research',
  'create_product',
  'update_product_price',
  'publish_product',
  'issue_refund',
  'send_customer_email',
  'update_order_status',
  'add_tracking_number',
  'create_stripe_product'
]);

/**
 * Execute a safe (non-gated) tool
 * @param {string} toolName
 * @param {object} input
 * @param {object} state  - current app state
 * @returns {object} result
 */
async function executeSafeTool(toolName, input, state) {
  switch (toolName) {
    case 'list_products': {
      const filter = input.status && input.status !== 'all' ? input.status : null;
      const products = filter
        ? state.products.filter(p => p.status === filter)
        : state.products;
      return { products, count: products.length };
    }

    case 'list_orders': {
      const filter = input.status && input.status !== 'all' ? input.status : null;
      const orders = filter
        ? state.orders.filter(o => o.status === filter)
        : state.orders;
      return { orders, count: orders.length };
    }

    case 'get_order': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      const customer = state.customers.find(c => c.id === order.customer_id);
      const product = state.products.find(p => p.id === order.product_id);
      return { order, customer: customer || null, product: product || null };
    }

    case 'estimate_print_job': {
      let filamentGrams = input.filament_grams;
      let printHours = input.print_hours;

      if (input.product_id) {
        const product = state.products.find(p => p.id === input.product_id);
        if (!product) return { error: `Product ${input.product_id} not found` };
        filamentGrams = filamentGrams || product.filament_grams || 50;
        printHours = printHours || product.print_hours || 2;
      } else {
        filamentGrams = filamentGrams || 50;
        printHours = printHours || 2;
      }

      // Find material cost
      const material = input.material_id
        ? state.materials.find(m => m.id === input.material_id)
        : state.materials[0];
      const costPerGram = material ? material.cost_per_gram_cents : 3;
      const materialCostCents = Math.round(filamentGrams * costPerGram);
      const electricityCostCents = Math.round(printHours * 15); // ~$0.15/hr
      const totalCostCents = materialCostCents + electricityCostCents;
      const suggestedPriceCents = Math.round(totalCostCents * 4); // 4x markup

      return {
        filament_grams: filamentGrams,
        print_hours: printHours,
        material_used: material ? material.name : 'PLA',
        material_cost_cents: materialCostCents,
        electricity_cost_cents: electricityCostCents,
        total_cost_cents: totalCostCents,
        suggested_price_cents: suggestedPriceCents,
        summary: `${filamentGrams}g filament, ${printHours}h print time. Cost: $${(totalCostCents / 100).toFixed(2)}. Suggested price: $${(suggestedPriceCents / 100).toFixed(2)} (4× markup)`
      };
    }

    case 'generate_product_description': {
      // Returns a prompt template; actual generation happens in the agent loop via Claude
      return {
        _agent_generate: true,
        prompt: `Write a compelling 3D print product listing description for:
Product: ${input.product_name}
Type: ${input.product_type || '3D printed item'}
Key features: ${(input.key_features || []).join(', ') || 'high quality, detailed, durable'}
Tone: ${input.tone || 'professional'}

Write 2-3 paragraphs. Include material benefits, use cases, and a call to action. No bullet points.`
      };
    }

    case 'generate_social_post': {
      const product = state.products.find(p => p.id === input.product_id);
      if (!product) return { error: `Product ${input.product_id} not found` };
      return {
        _agent_generate: true,
        prompt: `Write a ${input.platform} caption for this 3D printed product:
Product: ${product.name}
Price: $${(product.price_cents / 100).toFixed(2)}
Description: ${product.description || ''}
Angle: ${input.angle || 'showcase the detail and quality'}
Platform: ${input.platform}

For TikTok/Instagram: include hook, story, CTA, and relevant hashtags. Keep it energetic and authentic.
For Twitter: punchy, under 200 chars + hashtags.`
      };
    }

    case 'draft_customer_email': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      const customer = state.customers.find(c => c.id === order.customer_id);
      const product = state.products.find(p => p.id === order.product_id);
      return {
        _agent_generate: true,
        prompt: `Draft a ${input.email_type} email for a 3D print shop order.
Order ID: ${order.id}
Customer: ${customer ? customer.name : 'Customer'}
Product: ${product ? product.name : 'your order'}
Status: ${order.status}
Total: $${(order.total_cents / 100).toFixed(2)}
${input.custom_message ? 'Additional context: ' + input.custom_message : ''}

Write a friendly, professional email. Include Subject: line. Do NOT include any payment or card info.`
      };
    }

    case 'check_material_stock': {
      if (input.material_id) {
        const mat = state.materials.find(m => m.id === input.material_id);
        return mat ? { material: mat } : { error: `Material ${input.material_id} not found` };
      }
      return { materials: state.materials, count: state.materials.length };
    }

    // ── Research tools ──────────────────────────────────────────────────────
    case 'research_trending_products': {
      const { researchTrendingProducts } = require('../services/research-service');
      const result = await researchTrendingProducts({
        niche: input.niche,
        count: Math.min(input.count || 10, 20)
      });
      return result;
    }

    case 'analyze_product_opportunity': {
      const { analyzeProductOpportunity } = require('../services/research-service');
      const result = await analyzeProductOpportunity({
        productName: input.product_name,
        productDescription: input.product_description || ''
      });
      return result;
    }

    case 'find_design_sources': {
      const { findDesignSources } = require('../services/research-service');
      const result = await findDesignSources({
        productName: input.product_name,
        style: input.style || ''
      });
      return result;
    }

    default:
      return { error: `Unknown safe tool: ${toolName}` };
  }
}

module.exports = { TOOL_DEFINITIONS, HUMAN_GATE_TOOLS, executeSafeTool };
