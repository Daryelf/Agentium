// ─────────────────────────────────────────────────────────────────────────────
// Print Shop Storefront — Customer-facing JS
// Loads products from API and creates Stripe Checkout sessions
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('year').textContent = new Date().getFullYear();

async function loadProducts() {
  const grid = document.getElementById('products-grid');
  try {
    const products = await fetch('/api/shop/products').then(r => r.json());

    // Update shop name
    const settings = await fetch('/api/settings').then(r => r.json()).catch(() => ({}));
    if (settings.shopName) {
      document.querySelectorAll('#shop-name, .shop-name-f').forEach(el => { el.textContent = settings.shopName; });
      document.title = settings.shopName;
    }

    if (!products || products.length === 0) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="empty-icon">🖨️</div>
          <div class="empty-text">New products coming soon — check back shortly!</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = products.map(p => `
      <div class="product-card">
        <div class="product-img">
          ${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="${p.name}" loading="lazy" />` : '🖨️'}
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description || ''}</div>
          <div class="product-price">$${(p.price_cents / 100).toFixed(2)}</div>
        </div>
        <button class="btn-order" onclick="orderProduct('${p.id}', this)">
          Order Now — $${(p.price_cents / 100).toFixed(2)}
        </button>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="loading">Unable to load products. Please try again later.</div>`;
    console.error(err);
  }
}

async function orderProduct(productId, btn) {
  btn.disabled = true;
  btn.textContent = 'Redirecting to checkout…';
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId, quantity: 1 })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Checkout failed');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Order Now`;
    alert(`Sorry, checkout is unavailable right now: ${err.message}`);
  }
}

loadProducts();
