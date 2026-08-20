// ═══════════════════════════════════════════════════════════
// Argentum OS — Print Shop Office  |  Admin SPA
// ═══════════════════════════════════════════════════════════

const API = '';  // same origin

let currentView = 'dashboard';
let agentSocket = null;
let pendingApprovals = {};

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initTopbar();
  navigateTo('dashboard');
  setInterval(refreshBadges, 8000);
  refreshBadges();
});

function initTopbar() {
  setInterval(() => {
    const el = document.getElementById('topbar-time');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }, 1000);

  fetch(`${API}/api/settings`).then(r => r.json()).then(s => {
    const badge = document.getElementById('topbar-stripe');
    const ind = document.getElementById('stripe-mode-indicator');
    if (s.stripeMode === 'live') {
      badge.textContent = '🔴 LIVE';
      badge.classList.replace('test', 'live');
    }
    if (ind) ind.textContent = s.stripeMode === 'live' ? '🔴 Live' : '🟡 Test';
    document.title = `${s.shopName} — Argentum OS`;
  }).catch(() => {});
}

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.view));
  });
}

async function refreshBadges() {
  try {
    const [orders, approvals] = await Promise.all([
      fetch(`${API}/api/orders?status=paid`).then(r => r.json()),
      fetch(`${API}/api/approvals`).then(r => r.json())
    ]);
    const newOrders = Array.isArray(orders) ? orders.length : 0;
    const pendingApr = Array.isArray(approvals) ? approvals.filter(a => a.status === 'pending').length : 0;

    const ob = document.getElementById('badge-orders');
    const ab = document.getElementById('badge-approvals');
    if (ob) { ob.textContent = newOrders; ob.classList.toggle('hidden', newOrders === 0); }
    if (ab) { ab.textContent = pendingApr; ab.classList.toggle('hidden', pendingApr === 0); }
  } catch {}
}

// ── Router ─────────────────────────────────────────────────
function navigateTo(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  document.getElementById('topbar-title').textContent = {
    dashboard: 'Dashboard', orders: 'Orders', products: 'Products',
    queue: 'Print Queue', agent: 'Agent 202', research: '🔍 Product Research', storefront: 'Storefront Preview'
  }[view] || view;

  const views = { dashboard: renderDashboard, orders: renderOrders, products: renderProducts, queue: renderQueue, agent: renderAgent, research: renderResearch, storefront: renderStorefront };
  if (views[view]) views[view]();
}

// ── Dashboard ──────────────────────────────────────────────
async function renderDashboard() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="text-dim">Loading...</div>';
  try {
    const [products, orders, jobs, materials] = await Promise.all([
      fetch(`${API}/api/products`).then(r => r.json()),
      fetch(`${API}/api/orders`).then(r => r.json()),
      fetch(`${API}/api/print-jobs`).then(r => r.json()),
      fetch(`${API}/api/materials`).then(r => r.json())
    ]);

    const revenue = orders.filter(o => ['paid','printing','shipped','delivered'].includes(o.status))
      .reduce((s, o) => s + o.total_cents, 0);
    const activeJobs = jobs.filter(j => j.status === 'printing').length;
    const liveProducts = products.filter(p => p.status === 'active').length;
    const pendingOrders = orders.filter(o => o.status === 'paid').length;

    content.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Total Orders</div>
          <div class="kpi-value">${orders.length}</div>
          <div class="kpi-sub">${pendingOrders} awaiting print</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Revenue</div>
          <div class="kpi-value">$${(revenue / 100).toFixed(2)}</div>
          <div class="kpi-sub">All time</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Active Print Jobs</div>
          <div class="kpi-value">${activeJobs}</div>
          <div class="kpi-sub">${jobs.filter(j => j.status === 'queued').length} queued</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Live Products</div>
          <div class="kpi-value">${liveProducts}</div>
          <div class="kpi-sub">${products.filter(p => p.status === 'draft').length} drafts</div>
        </div>
      </div>

      <div class="section-header">
        <div>
          <div class="section-title">Recent Orders</div>
          <div class="section-sub">Last 10 orders across all statuses</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('orders')">View All</button>
      </div>

      <div class="card">
        ${renderOrderTable(orders.slice(-10).reverse())}
      </div>

      <div class="mt-4 section-header">
        <div class="section-title">Material Stock</div>
      </div>
      <div class="card">
        ${renderMaterialTable(materials)}
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  }
}

// ── Orders ─────────────────────────────────────────────────
async function renderOrders() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="text-dim">Loading...</div>';
  try {
    const orders = await fetch(`${API}/api/orders`).then(r => r.json());
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">All Orders (${orders.length})</div>
        <div class="flex gap-2">
          <select id="order-filter" class="form-input" style="width:140px" onchange="filterOrders(this.value)">
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="printing">Printing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>
      <div class="card">
        <div id="orders-table">${renderOrderTable(orders)}</div>
      </div>
    `;
    window._allOrders = orders;
  } catch (err) {
    content.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  }
}

function filterOrders(status) {
  const orders = status === 'all' ? window._allOrders : window._allOrders.filter(o => o.status === status);
  document.getElementById('orders-table').innerHTML = renderOrderTable(orders);
}

function renderOrderTable(orders) {
  if (!orders || orders.length === 0) return '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No orders yet</div></div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Order ID</th><th>Product</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td class="text-mono">${o.id}</td>
              <td>${o.product_id || '—'}</td>
              <td>$${(o.total_cents / 100).toFixed(2)}</td>
              <td><span class="badge badge-${o.status}">${o.status}</span></td>
              <td class="text-dim">${new Date(o.created_at).toLocaleDateString()}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="showOrderDetail('${o.id}')">View</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function showOrderDetail(orderId) {
  const order = await fetch(`${API}/api/orders/${orderId}`).then(r => r.json());
  showModal(`
    <div class="modal-title">Order ${orderId}</div>
    <div class="form-group">
      <div class="form-label">Status</div>
      <span class="badge badge-${order.status}">${order.status}</span>
    </div>
    <div class="form-group">
      <div class="form-label">Total</div>
      $${(order.total_cents / 100).toFixed(2)}
    </div>
    <div class="form-group">
      <div class="form-label">Tracking</div>
      ${order.tracking_number || '—'}
    </div>
    <div class="form-group">
      <div class="form-label">Shipping Address</div>
      <pre style="font-size:12px;color:var(--text-secondary)">${JSON.stringify(order.shipping_address, null, 2)}</pre>
    </div>
    <div class="form-group">
      <div class="form-label">Notes</div>
      ${order.notes || '—'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `);
}

// ── Products ────────────────────────────────────────────────
async function renderProducts() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="text-dim">Loading...</div>';
  try {
    const products = await fetch(`${API}/api/products`).then(r => r.json());
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Products (${products.length})</div>
        <button class="btn btn-primary" onclick="showAddProduct()">+ Add Product</button>
      </div>
      <div class="flex gap-2" style="margin-bottom:16px">
        ${['all','draft','active','archived'].map(s => `
          <button class="btn btn-secondary btn-sm ${s==='all'?'active':''}" onclick="filterProducts('${s}', this)">${s}</button>
        `).join('')}
      </div>
      <div class="products-grid" id="products-grid">
        ${renderProductCards(products)}
      </div>
    `;
    window._allProducts = products;
  } catch (err) {
    content.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  }
}

function filterProducts(status, btn) {
  document.querySelectorAll('.products-grid ~ .flex .btn, .flex.gap-2 .btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const products = status === 'all' ? window._allProducts : window._allProducts.filter(p => p.status === status);
  document.getElementById('products-grid').innerHTML = renderProductCards(products);
}

function renderProductCards(products) {
  if (!products.length) return '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📦</div><div class="empty-text">No products yet</div></div>';
  return products.map(p => `
    <div class="product-card" onclick="showProductDetail('${p.id}')">
      <div class="product-img">${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="${p.name}" />` : '🖨️'}</div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-price">$${(p.price_cents / 100).toFixed(2)}</div>
        <div class="product-meta">
          ${p.filament_grams}g filament · ${p.print_hours}h print
        </div>
        <div style="margin-top:8px"><span class="badge badge-${p.status}">${p.status}</span></div>
      </div>
    </div>
  `).join('');
}

function showAddProduct() {
  showModal(`
    <div class="modal-title">Add Product</div>
    <div class="form-group">
      <label class="form-label">Product Name *</label>
      <input class="form-input" id="p-name" placeholder="e.g. Dragon Figurine" />
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-input" id="p-desc" rows="3" placeholder="Product description..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Price (USD) *</label>
      <input class="form-input" id="p-price" type="number" placeholder="25.00" step="0.01" />
    </div>
    <div class="flex gap-2">
      <div class="form-group" style="flex:1">
        <label class="form-label">Filament (grams)</label>
        <input class="form-input" id="p-grams" type="number" placeholder="50" />
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Print Time (hours)</label>
        <input class="form-input" id="p-hours" type="number" placeholder="3" step="0.5" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddProduct()">Create Draft</button>
    </div>
  `);
}

async function submitAddProduct() {
  const name = document.getElementById('p-name').value.trim();
  const price = parseFloat(document.getElementById('p-price').value);
  if (!name || isNaN(price)) { alert('Name and price are required'); return; }
  await fetch(`${API}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: document.getElementById('p-desc').value,
      price_cents: Math.round(price * 100),
      filament_grams: parseFloat(document.getElementById('p-grams').value) || 0,
      print_hours: parseFloat(document.getElementById('p-hours').value) || 0
    })
  });
  closeModal();
  renderProducts();
}

async function showProductDetail(productId) {
  const p = window._allProducts?.find(x => x.id === productId);
  if (!p) return;
  showModal(`
    <div class="modal-title">${p.name}</div>
    <div class="form-group">
      <div class="form-label">ID</div><div class="text-mono">${p.id}</div>
    </div>
    <div class="form-group">
      <div class="form-label">Status</div>
      <span class="badge badge-${p.status}">${p.status}</span>
    </div>
    <div class="form-group">
      <div class="form-label">Price</div>$${(p.price_cents / 100).toFixed(2)}
    </div>
    <div class="form-group">
      <div class="form-label">Stripe Price ID</div>
      <span class="text-mono">${p.stripe_price_id || '—'}</span>
    </div>
    <div class="form-group">
      <div class="form-label">Description</div>
      <div style="font-size:13px;color:var(--text-secondary)">${p.description || '—'}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `);
}

// ── Print Queue ─────────────────────────────────────────────
async function renderQueue() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="text-dim">Loading...</div>';
  try {
    const [jobs, orders, products] = await Promise.all([
      fetch(`${API}/api/print-jobs`).then(r => r.json()),
      fetch(`${API}/api/orders`).then(r => r.json()),
      fetch(`${API}/api/products`).then(r => r.json())
    ]);

    const ordMap = Object.fromEntries(orders.map(o => [o.id, o]));
    const pMap = Object.fromEntries(products.map(p => [p.id, p]));

    const queued = jobs.filter(j => j.status === 'queued');
    const printing = jobs.filter(j => j.status === 'printing');
    const done = jobs.filter(j => j.status === 'done');

    function jobCard(j) {
      const ord = ordMap[j.order_id] || {};
      const prod = pMap[j.product_id || ord.product_id] || {};
      return `
        <div class="kanban-card" onclick="moveJob('${j.id}', '${j.status}')">
          <div style="font-weight:600;font-size:13px">${prod.name || 'Unknown Product'}</div>
          <div class="order-id">${j.order_id || '—'}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${new Date(j.created_at).toLocaleDateString()}</div>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Print Queue</div>
        <div class="text-dim" style="font-size:13px">${jobs.length} total jobs · Click a card to advance status</div>
      </div>
      <div class="kanban-board">
        <div class="kanban-col">
          <div class="kanban-col-title">🟡 To Print (${queued.length})</div>
          ${queued.map(jobCard).join('') || '<div class="text-dim" style="font-size:12px;text-align:center;padding:12px">Empty</div>'}
        </div>
        <div class="kanban-col">
          <div class="kanban-col-title">🔵 Printing (${printing.length})</div>
          ${printing.map(jobCard).join('') || '<div class="text-dim" style="font-size:12px;text-align:center;padding:12px">Empty</div>'}
        </div>
        <div class="kanban-col">
          <div class="kanban-col-title">✅ Done (${done.length})</div>
          ${done.map(jobCard).join('') || '<div class="text-dim" style="font-size:12px;text-align:center;padding:12px">Empty</div>'}
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  }
}

async function moveJob(jobId, currentStatus) {
  const next = { queued: 'printing', printing: 'done' };
  if (!next[currentStatus]) return;
  await fetch(`${API}/api/print-jobs/${jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: next[currentStatus] })
  });
  renderQueue();
}

// ── Material Table ─────────────────────────────────────────
function renderMaterialTable(materials) {
  if (!materials || materials.length === 0) return '<div class="empty-state"><div class="empty-text">No materials</div></div>';
  return `
    <table>
      <thead><tr><th>Material</th><th>Type</th><th>Stock (g)</th><th>Cost/g</th></tr></thead>
      <tbody>
        ${materials.map(m => `
          <tr>
            <td>${m.name}</td>
            <td>${m.type}</td>
            <td>${m.grams_available}g</td>
            <td>$${(m.cost_per_gram_cents / 100).toFixed(3)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ── Agent 202 Chat ──────────────────────────────────────────
function renderAgent() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div id="agent-view" style="height:calc(100vh - 52px - 48px);display:flex;flex-direction:column">
      <div style="margin-bottom:12px">
        <div class="section-title">Agent 202 — Print Shop AI</div>
        <div class="text-dim" style="font-size:12px">
          Powered by Claude · Human Gate required for money/customer/publish actions
        </div>
      </div>
      <div id="chat-messages" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;background:var(--bg-card);display:flex;flex-direction:column;gap:12px">
        <div class="msg msg-agent">
          <div class="msg-avatar">🤖</div>
          <div class="msg-bubble">
            Hi! I'm Agent 202. I can help you manage your 3D print shop — listing orders, estimating costs, drafting emails, and more.
            For any action that touches money, customers, or publishing, I'll ask for your approval first.
            What would you like to do?
          </div>
        </div>
      </div>
      <div id="chat-input-row" style="padding-top:12px;display:flex;gap:8px">
        <textarea id="chat-input" rows="2" placeholder="Ask Agent 202 anything… e.g. 'list my paid orders' or 'estimate a 60g 4-hour print'"
          onkeydown="chatKeydown(event)"></textarea>
        <button class="btn btn-primary" onclick="sendChat()" id="chat-send">Send</button>
      </div>
    </div>
  `;
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  appendChatMsg('user', msg);
  const agentBubble = appendChatMsg('agent', '');
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  agentBubble.querySelector('.msg-bubble').appendChild(spinner);

  document.getElementById('chat-send').disabled = true;

  try {
    const resp = await fetch(`${API}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let agentText = '';
    spinner.remove();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'text') {
            agentText += evt.text;
            agentBubble.querySelector('.msg-bubble').textContent = agentText;
            scrollChatToBottom();
          } else if (evt.type === 'human_gate') {
            appendGateRequest(evt);
          } else if (evt.type === 'gate_approved') {
            const gate = document.querySelector(`[data-approval-tool="${evt.tool}"]`);
            if (gate) gate.innerHTML = `<span class="text-green">✅ Approved — executing...</span>`;
          } else if (evt.type === 'gate_denied') {
            const gate = document.querySelector(`[data-approval-tool="${evt.tool}"]`);
            if (gate) gate.innerHTML = `<span class="text-red">❌ Denied</span>`;
          }
        } catch {}
      }
    }
  } catch (err) {
    agentBubble.querySelector('.msg-bubble').textContent = `Error: ${err.message}`;
  } finally {
    document.getElementById('chat-send').disabled = false;
  }
}

function appendChatMsg(role, text) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
    <div class="msg-bubble">${text}</div>
  `;
  msgs.appendChild(div);
  scrollChatToBottom();
  return div;
}

function appendGateRequest(evt) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg-gate';
  div.setAttribute('data-approval-tool', evt.tool);
  div.setAttribute('data-approval-id', evt.approval_id);
  div.innerHTML = `
    <div>
      <strong>⚠️ Human Gate Required</strong><br/>
      Agent 202 wants to run: <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px">${evt.tool}</code>
    </div>
    <pre style="font-size:11px;background:rgba(0,0,0,0.2);padding:8px;border-radius:6px;overflow:auto">${JSON.stringify(evt.input, null, 2)}</pre>
    <div class="msg-gate-actions">
      <button class="btn btn-green btn-sm" onclick="resolveGate('${evt.approval_id}', true, this)">✅ Approve</button>
      <button class="btn btn-danger btn-sm" onclick="resolveGate('${evt.approval_id}', false, this)">❌ Deny</button>
    </div>
  `;
  msgs.appendChild(div);
  scrollChatToBottom();
}

async function resolveGate(approvalId, approve, btn) {
  btn.closest('.msg-gate-actions').innerHTML = '<span class="spinner"></span>';
  const endpoint = approve ? 'approve' : 'deny';
  await fetch(`${API}/api/approvals/${approvalId}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: approve ? '' : 'Operator denied' })
  });
  refreshBadges();
}

function scrollChatToBottom() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ── Storefront Preview ──────────────────────────────────────
function renderStorefront() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="section-header">
      <div class="section-title">Storefront Preview</div>
      <a href="/storefront/index.html" target="_blank" class="btn btn-secondary btn-sm">Open in New Tab ↗</a>
    </div>
    <iframe id="storefront-frame" src="/storefront/index.html" frameborder="0"></iframe>
  `;
}

// ── Research View ───────────────────────────────────────────
function renderResearch() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div style="max-width:860px">
      <div class="section-header" style="margin-bottom:20px">
        <div>
          <div class="section-title">🔍 Product Research</div>
          <div class="text-dim" style="font-size:13px">Powered by OpenAI + live web search · Finds real trending products on Etsy, Amazon, TikTok</div>
        </div>
      </div>

      <!-- Trending scan -->
      <div class="card" style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:14px;font-size:15px">📈 Trending Products Scanner</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:180px">
            <div class="form-label">Niche (optional)</div>
            <input class="form-input" id="r-niche" placeholder="e.g. gaming, desk accessories, pets…" />
          </div>
          <div style="width:100px">
            <div class="form-label">Count</div>
            <input class="form-input" id="r-count" type="number" value="8" min="3" max="20" />
          </div>
          <button class="btn btn-primary" onclick="runTrendingScan()" id="btn-trend">
            Scan Trends
          </button>
        </div>
        <div id="trending-results" style="margin-top:16px"></div>
      </div>

      <!-- Deep analysis -->
      <div class="card" style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:14px;font-size:15px">🔬 Deep Product Analysis</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div class="form-label">Product Name</div>
            <input class="form-input" id="r-product" placeholder="e.g. cable management box" />
          </div>
          <button class="btn btn-primary" onclick="runDeepAnalysis()" id="btn-analyze">
            Analyze
          </button>
        </div>
        <div id="analysis-results" style="margin-top:16px"></div>
      </div>

      <!-- Design finder -->
      <div class="card">
        <div style="font-weight:600;margin-bottom:14px;font-size:15px">📐 Find STL Designs</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div class="form-label">Product Name</div>
            <input class="form-input" id="r-design-product" placeholder="e.g. succulent planter" />
          </div>
          <div style="width:160px">
            <div class="form-label">Style (optional)</div>
            <input class="form-input" id="r-design-style" placeholder="minimalist, detailed…" />
          </div>
          <button class="btn btn-primary" onclick="runDesignSearch()" id="btn-designs">
            Find Designs
          </button>
        </div>
        <div id="design-results" style="margin-top:16px"></div>
      </div>
    </div>
  `;
}

async function runTrendingScan() {
  const niche = document.getElementById('r-niche').value.trim();
  const count = parseInt(document.getElementById('r-count').value) || 8;
  const btn = document.getElementById('btn-trend');
  const out = document.getElementById('trending-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Searching web…';
  out.innerHTML = '<div class="text-dim" style="font-size:13px;padding:12px 0">Scanning Etsy, Amazon, TikTok for trending products… this takes 15–30s</div>';

  try {
    const res = await fetch(`${API}/api/research/trending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, count })
    });
    const data = await res.json();

    if (data.error) { out.innerHTML = `<div class="text-red">${data.error}</div>`; return; }

    const ideas = data.ideas || [];
    if (!ideas.length) {
      out.innerHTML = `<div class="text-dim" style="font-size:13px">${data.raw || 'No results returned.'}</div>`;
      return;
    }

    out.innerHTML = `
      <div style="display:grid;gap:12px">
        ${ideas.map((idea, i) => `
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <span style="font-size:11px;font-weight:700;background:var(--accent);color:white;padding:2px 7px;border-radius:4px">#${idea.rank || i+1}</span>
              <span style="font-weight:700;font-size:14px">${idea.name}</span>
              <span class="badge badge-${idea.competition === 'low' ? 'active' : idea.competition === 'medium' ? 'pending' : 'refunded'}" style="margin-left:auto">${idea.competition || '?'} competition</span>
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">${idea.description || ''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--text-dim)">
              <span>💰 <strong style="color:var(--green)">${idea.price_range || '—'}</strong></span>
              <span>🧵 ${idea.filament_grams || '?'}g · ${idea.print_hours || '?'}h</span>
              <span>📱 ${idea.platform || '—'}</span>
              <span>📐 ${idea.design_source || '—'}</span>
            </div>
            ${idea.why_it_sells ? `<div style="font-size:12px;color:var(--accent-light);margin-top:8px;font-style:italic">💡 ${idea.why_it_sells}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="btn btn-secondary btn-sm" onclick="prefillAnalysis('${idea.name.replace(/'/g,"\\'")}')">Analyze →</button>
              <button class="btn btn-secondary btn-sm" onclick="prefillDesign('${idea.name.replace(/'/g,"\\'")}')">Find STL →</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px">Generated ${new Date(data.generated_at).toLocaleString()}</div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Trends';
  }
}

async function runDeepAnalysis() {
  const name = document.getElementById('r-product').value.trim();
  if (!name) { alert('Enter a product name'); return; }
  const btn = document.getElementById('btn-analyze');
  const out = document.getElementById('analysis-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Researching…';
  out.innerHTML = '<div class="text-dim" style="font-size:13px;padding:12px 0">Searching Etsy, Amazon, and 3D print communities for real data… 20–40s</div>';

  try {
    const res = await fetch(`${API}/api/research/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: name })
    });
    const d = await res.json();

    if (d.error) { out.innerHTML = `<div class="text-red">${d.error}</div>`; return; }
    if (d.raw) { out.innerHTML = `<pre style="font-size:12px;white-space:pre-wrap;color:var(--text-secondary)">${d.raw}</pre>`; return; }

    const verdictColor = { go: 'var(--green)', caution: 'var(--yellow)', skip: 'var(--red)' }[d.verdict] || 'var(--text-secondary)';

    out.innerHTML = `
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <span style="font-size:24px;font-weight:800;color:${verdictColor}">${{go:'✅ GO',caution:'⚠️ CAUTION',skip:'❌ SKIP'}[d.verdict] || d.verdict}</span>
          <span style="font-size:13px;color:var(--text-secondary)">${d.verdict_reason || ''}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:4px">Market Demand</div>
            <div style="font-weight:600">${d.demand?.signal?.toUpperCase() || '—'}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${d.demand?.details || ''}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:4px">Price Benchmarks</div>
            <div style="font-size:13px">Low: <strong>${d.price_benchmarks?.low || '—'}</strong> · Avg: <strong style="color:var(--green)">${d.price_benchmarks?.average || '—'}</strong> · Premium: <strong>${d.price_benchmarks?.premium || '—'}</strong></div>
          </div>
        </div>

        ${d.competitors?.length ? `
          <div style="margin-bottom:12px">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:6px">Top Competitors</div>
            ${d.competitors.map(c => `
              <div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
                <strong>${c.name}</strong>${c.url ? ` · <a href="${c.url}" target="_blank" style="color:var(--accent-light);font-size:11px">${c.url}</a>` : ''} — ${c.why_they_win || ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${d.marketing_angle ? `
          <div style="margin-bottom:12px">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:4px">Marketing Angle</div>
            <div style="font-size:13px"><strong>${d.marketing_angle.platform}</strong> · ${d.marketing_angle.hook}</div>
          </div>
        ` : ''}

        ${d.design_sources?.length ? `
          <div style="margin-bottom:12px">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;font-weight:600;margin-bottom:6px">Design Sources</div>
            ${d.design_sources.map(s => `
              <div style="font-size:12px;padding:3px 0">
                ${s.url ? `<a href="${s.url}" target="_blank" style="color:var(--accent-light)">${s.name}</a>` : `<strong>${s.name}</strong>`}
                · ${s.license || ''} · ${s.notes || ''}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${d.risks?.length ? `
          <div style="font-size:12px;color:var(--red);margin-bottom:12px">⚠️ Risks: ${d.risks.join(' · ')}</div>
        ` : ''}

        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="sendToAgent('Analyze the product opportunity for \\'${name}\\' and create a product listing from the research')">
            → Send to Agent 202
          </button>
          <button class="btn btn-secondary btn-sm" onclick="prefillDesign('${name}')">Find STL →</button>
        </div>
      </div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze';
  }
}

async function runDesignSearch() {
  const name = document.getElementById('r-design-product').value.trim();
  const style = document.getElementById('r-design-style').value.trim();
  if (!name) { alert('Enter a product name'); return; }
  const btn = document.getElementById('btn-designs');
  const out = document.getElementById('design-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Searching…';
  out.innerHTML = '<div class="text-dim" style="font-size:13px;padding:12px 0">Searching Printables, Thingiverse, MakerWorld, Cults3D… 15–25s</div>';

  try {
    const res = await fetch(`${API}/api/research/designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: name, style })
    });
    const d = await res.json();

    if (d.error) { out.innerHTML = `<div class="text-red">${d.error}</div>`; return; }
    if (d.raw) { out.innerHTML = `<pre style="font-size:12px;white-space:pre-wrap;color:var(--text-secondary)">${d.raw}</pre>`; return; }

    const designs = d.designs || [];
    out.innerHTML = `
      ${d.recommendation ? `<div style="font-size:13px;color:var(--accent-light);margin-bottom:12px;padding:10px;background:var(--accent-glow);border-radius:8px">💡 ${d.recommendation}</div>` : ''}
      ${d.custom_design_needed ? `<div style="font-size:13px;color:var(--yellow);margin-bottom:10px">⚠️ Custom design may be needed for best results</div>` : ''}
      <div style="display:grid;gap:8px">
        ${designs.map(des => `
          <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;align-items:flex-start;gap:12px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px">
                ${des.url ? `<a href="${des.url}" target="_blank" style="color:var(--accent-light)">${des.name}</a>` : des.name}
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${des.description || ''}</div>
              <div style="display:flex;gap:10px;margin-top:6px;font-size:11px;color:var(--text-dim)">
                <span>📦 ${des.platform}</span>
                <span>📄 ${des.license}</span>
                <span>${des.commercial_ok ? '✅ Commercial OK' : '⚠️ Non-commercial'}</span>
                ${des.quality ? `<span>⭐ ${des.quality}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
        ${designs.length === 0 ? '<div class="text-dim" style="font-size:13px">No designs found — may need custom design.</div>' : ''}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px">Searched ${new Date(d.searched_at).toLocaleString()}</div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="text-red">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Designs';
  }
}

function prefillAnalysis(name) {
  navigateTo('research');
  setTimeout(() => {
    const el = document.getElementById('r-product');
    if (el) { el.value = name; el.scrollIntoView({ behavior: 'smooth' }); }
  }, 100);
}

function prefillDesign(name) {
  navigateTo('research');
  setTimeout(() => {
    const el = document.getElementById('r-design-product');
    if (el) { el.value = name; el.scrollIntoView({ behavior: 'smooth' }); }
  }, 100);
}

function sendToAgent(message) {
  navigateTo('agent');
  setTimeout(() => {
    const el = document.getElementById('chat-input');
    if (el) { el.value = message; el.focus(); }
  }, 150);
}

// ── Modal ───────────────────────────────────────────────────
function showModal(html) {
  document.getElementById('modal-container').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        ${html}
      </div>
    </div>
  `;
}

function closeModal(e) {
  if (!e || e.target.classList.contains('modal-overlay')) {
    document.getElementById('modal-container').innerHTML = '';
  }
}
