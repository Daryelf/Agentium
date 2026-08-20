// ═════════════════════════════════════════════════════════════════════════════
// Argentum OS — Print Shop Office  |  server.js
// Port 3001 | Agent 202 | Node.js HTTP (no framework)
// ═════════════════════════════════════════════════════════════════════════════

'use strict';
require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.SHOP_PORT || '3001', 10);
const BASE_URL = process.env.SHOP_BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = path.resolve(process.env.PRINT_SHOP_DATA_DIR || 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ── State ─────────────────────────────────────────────────────────────────────
let state = loadState();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      products: [], orders: [], customers: [], printJobs: [],
      materials: [], approvalRequests: [], artifacts: [],
      settings: { shopName: 'My 3D Print Shop', stripeMode: 'test', currency: 'usd', defaultShippingDays: 5 }
    };
  }
}

function saveState() {
  // Atomic write: temp file → rename
  const tmp = STATE_FILE + '.tmp';
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

// ── ID helpers ────────────────────────────────────────────────────────────────
const uid = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

// ── Services (lazy) ───────────────────────────────────────────────────────────
const stripeService = require('./services/stripe-service');
const emailService = require('./services/email-service');
const { estimatePrintJob } = require('./services/print-estimator');
const { TOOL_DEFINITIONS, HUMAN_GATE_TOOLS, executeSafeTool } = require('./agent/agent-tools');
const researchService = require('./services/research-service');

// ── Anthropic SDK ─────────────────────────────────────────────────────────────
let anthropic;
function getAnthropic() {
  if (!anthropic) {
    const { default: Anthropic } = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// ═════════════════════════════════════════════════════════════════════════════
// Agent 202 — Tool Execution (gated actions)
// ═════════════════════════════════════════════════════════════════════════════

async function executeGatedTool(toolName, input) {
  switch (toolName) {
    case 'create_product_from_research': {
      // Run OpenAI research to generate the spec, then create the product
      const spec = await researchService.generateProductSpec({
        productName: input.product_name,
        researchData: input.research_data || {}
      });
      const product = {
        id: uid('prod'),
        name: spec.name || input.product_name,
        description: spec.description || '',
        price_cents: spec.price_cents || Math.round((spec.price_usd || 0) * 100),
        images: [],
        filament_grams: spec.filament_grams || 0,
        print_hours: spec.print_hours || 0,
        material_type: spec.material_type || 'PLA',
        material_color: spec.material_color || '',
        keywords: spec.keywords || [],
        social_caption: spec.social_caption || '',
        status: 'draft',
        stripe_price_id: '',
        source: 'agent_research',
        created_at: new Date().toISOString()
      };
      state.products.push(product);
      saveState();
      return { success: true, product, spec };
    }

    case 'create_product': {
      const product = {
        id: uid('prod'),
        name: input.name,
        description: input.description || '',
        price_cents: input.price_cents,
        images: [],
        filament_grams: input.filament_grams || 0,
        print_hours: input.print_hours || 0,
        status: 'draft',
        stripe_price_id: '',
        created_at: new Date().toISOString()
      };
      state.products.push(product);
      saveState();
      return { success: true, product };
    }

    case 'update_product_price': {
      const product = state.products.find(p => p.id === input.product_id);
      if (!product) return { error: `Product ${input.product_id} not found` };
      product.price_cents = input.new_price_cents;
      product.updated_at = new Date().toISOString();
      saveState();
      return { success: true, product };
    }

    case 'publish_product': {
      const product = state.products.find(p => p.id === input.product_id);
      if (!product) return { error: `Product ${input.product_id} not found` };
      product.status = 'active';
      product.published_at = new Date().toISOString();
      saveState();
      return { success: true, product };
    }

    case 'issue_refund': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      if (!order.stripe_payment_intent) return { error: 'Order has no Stripe payment intent' };

      const refund = await stripeService.issueRefund(
        order.stripe_payment_intent,
        input.amount_cents || null
      );
      order.status = 'refunded';
      order.refund_id = refund.id;
      order.refund_reason = input.reason;
      order.refunded_at = new Date().toISOString();
      saveState();
      return { success: true, refund_id: refund.id, order };
    }

    case 'send_customer_email': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      const customer = state.customers.find(c => c.id === order.customer_id);
      if (!customer || !customer.email) return { error: 'Customer email not found' };

      await emailService.sendCustomEmail(customer.email, input.subject, input.body);
      return { success: true, sent_to: customer.email };
    }

    case 'update_order_status': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      order.status = input.new_status;
      if (input.notes) order.notes = (order.notes || '') + `\n[${new Date().toISOString()}] ${input.notes}`;
      order.updated_at = new Date().toISOString();
      saveState();
      return { success: true, order };
    }

    case 'add_tracking_number': {
      const order = state.orders.find(o => o.id === input.order_id);
      if (!order) return { error: `Order ${input.order_id} not found` };
      order.tracking_number = input.tracking_number;
      order.carrier = input.carrier || '';
      order.updated_at = new Date().toISOString();
      saveState();
      return { success: true, order };
    }

    case 'create_stripe_product': {
      const product = state.products.find(p => p.id === input.product_id);
      if (!product) return { error: `Product ${input.product_id} not found` };
      const { stripeProductId, stripePriceId } = await stripeService.createStripeProduct(product);
      product.stripe_product_id = stripeProductId;
      product.stripe_price_id = stripePriceId;
      saveState();
      return { success: true, stripe_product_id: stripeProductId, stripe_price_id: stripePriceId };
    }

    default:
      return { error: `Unknown gated tool: ${toolName}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Agent 202 — SSE Chat Loop
// ═════════════════════════════════════════════════════════════════════════════

async function runAgent202(userMessage, res) {
  const ai = getAnthropic();

  const messages = [{ role: 'user', content: userMessage }];

  const systemPrompt = `You are Agent 202, the AI operator for a 3D printing business.
You help manage orders, products, customers, and print jobs.
You have access to tools to list orders, estimate costs, draft emails, and more.
For any action marked [HUMAN GATE], you MUST propose the action and explain what it will do before requesting approval — never execute gated actions silently.
Always be concise and helpful. Use dollars (not cents) when discussing prices with humans.
Current shop: ${state.settings.shopName}
Current date: ${new Date().toLocaleDateString()}`;

  let pendingApproval = null;

  const sendEvent = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Agentic loop
    while (true) {
      const response = await ai.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOL_DEFINITIONS,
        messages
      });

      // Stream text blocks
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          sendEvent({ type: 'text', text: block.text });
        }
      }

      // If stop reason is end_turn or no tool use, we're done
      if (response.stop_reason === 'end_turn') break;

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          const { name, id, input } = toolUse;

          if (HUMAN_GATE_TOOLS.has(name)) {
            // Create approval request
            const reqId = uid('apr');
            const approval = {
              id: reqId,
              tool: name,
              input,
              status: 'pending',
              created_at: new Date().toISOString(),
              tool_use_id: id
            };
            state.approvalRequests.push(approval);
            saveState();

            sendEvent({
              type: 'human_gate',
              approval_id: reqId,
              tool: name,
              input,
              message: `⚠️ Human Gate: Agent 202 wants to run \`${name}\`. Approve or deny in the console.`
            });

            // Wait for approval (poll with timeout)
            const result = await waitForApproval(reqId);
            if (result.approved) {
              sendEvent({ type: 'gate_approved', tool: name });
              const toolResult = await executeGatedTool(name, input);
              toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(toolResult) });
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: JSON.stringify({ error: 'Action denied by operator', reason: result.reason || 'No reason given' }),
                is_error: true
              });
              sendEvent({ type: 'gate_denied', tool: name, reason: result.reason });
            }
          } else {
            // Safe tool — execute immediately
            sendEvent({ type: 'tool_call', tool: name, input });
            const result = await executeSafeTool(name, input, state);
            if (result && result._agent_generate) {
              // The tool returned a prompt for Claude to answer inline
              toolResults.push({ type: 'tool_result', tool_use_id: id, content: result.prompt });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) });
            }
          }
        }

        // Add assistant turn + tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        continue; // next loop iteration
      }

      break;
    }
  } catch (err) {
    sendEvent({ type: 'error', message: err.message });
  }

  sendEvent({ type: 'done' });
  res.end();
}

function waitForApproval(reqId, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const req = state.approvalRequests.find(r => r.id === reqId);
      if (!req) { clearInterval(poll); return resolve({ approved: false, reason: 'Request not found' }); }
      if (req.status === 'approved') { clearInterval(poll); return resolve({ approved: true }); }
      if (req.status === 'denied') { clearInterval(poll); return resolve({ approved: false, reason: req.deny_reason }); }
      if (Date.now() > deadline) { clearInterval(poll); req.status = 'timeout'; saveState(); resolve({ approved: false, reason: 'Timed out' }); }
    }, 1000);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// HTTP Server + Routes
// ═════════════════════════════════════════════════════════════════════════════

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // ── Static files ────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname.startsWith('/storefront')) {
    const rel = pathname === '/storefront' ? '/storefront/index.html' : pathname;
    return serveFile(path.join(__dirname, rel), res);
  }

  if (method === 'GET' && (pathname === '/' || pathname.startsWith('/public') || pathname === '/index.html')) {
    const p = pathname === '/' || pathname === '/index.html' ? '/public/index.html' : pathname;
    return serveFile(path.join(__dirname, p), res);
  }

  if (method === 'GET' && (pathname.endsWith('.js') || pathname.endsWith('.css'))) {
    // Try public/ first, then storefront/
    const candidates = [path.join(__dirname, 'public', path.basename(pathname)), path.join(__dirname, 'storefront', path.basename(pathname))];
    for (const c of candidates) { if (fs.existsSync(c)) return serveFile(c, res); }
  }

  // ── API ─────────────────────────────────────────────────────────────────────

  // State
  if (method === 'GET' && pathname === '/api/state') return json(res, state);
  if (method === 'GET' && pathname === '/api/settings') return json(res, state.settings);

  // Products
  if (method === 'GET' && pathname === '/api/products') {
    const status = url.searchParams.get('status');
    return json(res, status ? state.products.filter(p => p.status === status) : state.products);
  }
  if (method === 'POST' && pathname === '/api/products') {
    const body = await parseBody(req);
    const product = {
      id: uid('prod'), name: body.name || 'Untitled', description: body.description || '',
      price_cents: body.price_cents || 0, images: body.images || [],
      filament_grams: body.filament_grams || 0, print_hours: body.print_hours || 0,
      status: 'draft', stripe_price_id: '', created_at: new Date().toISOString()
    };
    state.products.push(product); saveState();
    return json(res, product, 201);
  }
  if (method === 'PUT' && pathname.startsWith('/api/products/')) {
    const id = pathname.split('/')[3];
    const product = state.products.find(p => p.id === id);
    if (!product) return json(res, { error: 'Not found' }, 404);
    const body = await parseBody(req);
    Object.assign(product, body, { updated_at: new Date().toISOString() });
    saveState(); return json(res, product);
  }

  // Orders
  if (method === 'GET' && pathname === '/api/orders') {
    const status = url.searchParams.get('status');
    return json(res, status ? state.orders.filter(o => o.status === status) : state.orders);
  }
  if (method === 'GET' && pathname.startsWith('/api/orders/')) {
    const id = pathname.split('/')[3];
    const order = state.orders.find(o => o.id === id);
    return order ? json(res, order) : json(res, { error: 'Not found' }, 404);
  }
  if (method === 'PUT' && pathname.startsWith('/api/orders/')) {
    const id = pathname.split('/')[3];
    const order = state.orders.find(o => o.id === id);
    if (!order) return json(res, { error: 'Not found' }, 404);
    const body = await parseBody(req);
    Object.assign(order, body, { updated_at: new Date().toISOString() });
    saveState(); return json(res, order);
  }

  // Print Jobs
  if (method === 'GET' && pathname === '/api/print-jobs') return json(res, state.printJobs);
  if (method === 'POST' && pathname === '/api/print-jobs') {
    const body = await parseBody(req);
    const job = {
      id: uid('job'), order_id: body.order_id, product_id: body.product_id,
      status: 'queued', material_id: body.material_id || '', notes: body.notes || '',
      created_at: new Date().toISOString()
    };
    state.printJobs.push(job); saveState(); return json(res, job, 201);
  }
  if (method === 'PUT' && pathname.startsWith('/api/print-jobs/')) {
    const id = pathname.split('/')[3];
    const job = state.printJobs.find(j => j.id === id);
    if (!job) return json(res, { error: 'Not found' }, 404);
    const body = await parseBody(req);
    Object.assign(job, body, { updated_at: new Date().toISOString() });
    saveState(); return json(res, job);
  }

  // Materials
  if (method === 'GET' && pathname === '/api/materials') return json(res, state.materials);
  if (method === 'PUT' && pathname.startsWith('/api/materials/')) {
    const id = pathname.split('/')[3];
    const mat = state.materials.find(m => m.id === id);
    if (!mat) return json(res, { error: 'Not found' }, 404);
    const body = await parseBody(req);
    Object.assign(mat, body, { updated_at: new Date().toISOString() });
    saveState(); return json(res, mat);
  }

  // Customers
  if (method === 'GET' && pathname === '/api/customers') return json(res, state.customers);

  // Approval Requests (Human Gate)
  if (method === 'GET' && pathname === '/api/approvals') return json(res, state.approvalRequests);
  if (method === 'POST' && pathname.startsWith('/api/approvals/') && pathname.endsWith('/approve')) {
    const id = pathname.split('/')[3];
    const req_ = state.approvalRequests.find(r => r.id === id);
    if (!req_) return json(res, { error: 'Not found' }, 404);
    req_.status = 'approved'; req_.resolved_at = new Date().toISOString();
    saveState(); return json(res, req_);
  }
  if (method === 'POST' && pathname.startsWith('/api/approvals/') && pathname.endsWith('/deny')) {
    const id = pathname.split('/')[3];
    const req_ = state.approvalRequests.find(r => r.id === id);
    if (!req_) return json(res, { error: 'Not found' }, 404);
    const body = await parseBody(req);
    req_.status = 'denied'; req_.deny_reason = body.reason || ''; req_.resolved_at = new Date().toISOString();
    saveState(); return json(res, req_);
  }

  // Estimate
  if (method === 'POST' && pathname === '/api/estimate') {
    const body = await parseBody(req);
    const mat = body.material_id ? state.materials.find(m => m.id === body.material_id) : state.materials[0];
    const result = estimatePrintJob({
      filamentGrams: body.filament_grams || 50,
      printHours: body.print_hours || 2,
      costPerGramCents: mat ? mat.cost_per_gram_cents : 3
    });
    return json(res, result);
  }

  // Agent 202 Chat (SSE)
  if (method === 'POST' && pathname === '/api/agent') {
    const body = await parseBody(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    await runAgent202(body.message || '', res);
    return;
  }

  // ── Stripe ──────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/stripe/checkout') {
    const body = await parseBody(req);
    const product = state.products.find(p => p.id === body.product_id);
    if (!product || product.status !== 'active') return json(res, { error: 'Product not available' }, 400);
    try {
      const { url, sessionId } = await stripeService.createCheckoutSession(product, body.quantity || 1, BASE_URL);
      return json(res, { url, sessionId });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (method === 'POST' && pathname === '/api/stripe/webhook') {
    const rawBody = await parseRawBody(req);
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripeService.verifyWebhook(rawBody, sig);
    } catch (err) {
      res.writeHead(400); return res.end(`Webhook error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const productId = session.metadata.product_id;
      const product = state.products.find(p => p.id === productId);
      const customerDetails = session.customer_details;

      // Upsert customer
      let customer = state.customers.find(c => c.email === customerDetails.email);
      if (!customer) {
        customer = {
          id: uid('cust'), name: customerDetails.name, email: customerDetails.email,
          phone: customerDetails.phone || '', created_at: new Date().toISOString()
        };
        state.customers.push(customer);
      }

      // Create order
      const order = {
        id: uid('ord'), customer_id: customer.id, product_id: productId,
        quantity: parseInt(session.metadata.quantity || '1', 10),
        total_cents: session.amount_total,
        status: 'paid',
        stripe_payment_intent: session.payment_intent || '',
        stripe_session_id: session.id,
        shipping_address: customerDetails.address || {},
        tracking_number: '', created_at: new Date().toISOString(), notes: ''
      };
      state.orders.push(order);

      // Auto-create print job
      const job = {
        id: uid('job'), order_id: order.id, product_id: productId,
        status: 'queued', created_at: new Date().toISOString()
      };
      state.printJobs.push(job);
      saveState();

      // Send confirmation email (non-blocking, no Human Gate for auto-confirm)
      emailService.sendOrderConfirmation(order, customer, product).catch(e => console.error('Email error:', e.message));
    }

    res.writeHead(200); return res.end('ok');
  }

  // ── Storefront product API (public) ─────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/shop/products') {
    return json(res, state.products.filter(p => p.status === 'active'));
  }

  // ── Research API (direct calls, outside agent chat) ──────────────────────
  if (method === 'POST' && pathname === '/api/research/trending') {
    const body = await parseBody(req);
    try {
      const result = await researchService.researchTrendingProducts({
        niche: body.niche,
        count: Math.min(body.count || 10, 20)
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (method === 'POST' && pathname === '/api/research/analyze') {
    const body = await parseBody(req);
    if (!body.product_name) return json(res, { error: 'product_name required' }, 400);
    try {
      const result = await researchService.analyzeProductOpportunity({
        productName: body.product_name,
        productDescription: body.product_description || ''
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (method === 'POST' && pathname === '/api/research/designs') {
    const body = await parseBody(req);
    if (!body.product_name) return json(res, { error: 'product_name required' }, 400);
    try {
      const result = await researchService.findDesignSources({
        productName: body.product_name,
        style: body.style || ''
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`404 — ${pathname} not found`);
});

// ═════════════════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   Argentum OS — Print Shop Office            ║`);
  console.log(`║   Agent 202  |  Port ${PORT}                    ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`\n  Admin:      ${BASE_URL}/`);
  console.log(`  Storefront: ${BASE_URL}/storefront/`);
  console.log(`  Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🔴 LIVE' : '🟡 TEST'}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. Is another server running?\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
