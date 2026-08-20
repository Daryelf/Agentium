// ─────────────────────────────────────────────────────────────────────────────
// Email Service (Resend)
// Sends transactional emails. Only called after Human Gate approval.
// ─────────────────────────────────────────────────────────────────────────────

let resendClient;

function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM = process.env.EMAIL_FROM || 'orders@yourdomain.com';
const SHOP_NAME = process.env.SHOP_NAME || 'My 3D Print Shop';

/**
 * Send an order confirmation email
 * @param {object} order
 * @param {object} customer
 * @param {object} product
 */
async function sendOrderConfirmation(order, customer, product) {
  const resend = getResend();

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <h1 style="color:#7c3aed">${SHOP_NAME}</h1>
  <h2>Order Confirmed! 🎉</h2>
  <p>Hi ${customer.name || 'there'},</p>
  <p>Thanks for your order! We're getting your print queued up now.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr style="background:#f3f4f6">
      <td style="padding:10px"><strong>Order ID</strong></td>
      <td style="padding:10px">${order.id}</td>
    </tr>
    <tr>
      <td style="padding:10px"><strong>Product</strong></td>
      <td style="padding:10px">${product ? product.name : 'Your item'}</td>
    </tr>
    <tr style="background:#f3f4f6">
      <td style="padding:10px"><strong>Quantity</strong></td>
      <td style="padding:10px">${order.quantity}</td>
    </tr>
    <tr>
      <td style="padding:10px"><strong>Total</strong></td>
      <td style="padding:10px">$${(order.total_cents / 100).toFixed(2)}</td>
    </tr>
    <tr style="background:#f3f4f6">
      <td style="padding:10px"><strong>Est. Ship Date</strong></td>
      <td style="padding:10px">${getEstShipDate()}</td>
    </tr>
  </table>
  <p>We'll email you again when your order ships with a tracking number.</p>
  <p>Questions? Reply to this email.</p>
  <p>— The ${SHOP_NAME} Team</p>
</body>
</html>`;

  return resend.emails.send({
    from: FROM,
    to: customer.email,
    subject: `Order Confirmed — ${product ? product.name : 'Your 3D Print'} (#${order.id})`,
    html
  });
}

/**
 * Send a custom email (after Human Gate approval)
 * @param {string} toEmail
 * @param {string} subject
 * @param {string} body - plain text or HTML
 */
async function sendCustomEmail(toEmail, subject, body) {
  const resend = getResend();
  const isHtml = body.trim().startsWith('<');
  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject,
    ...(isHtml ? { html: body } : { text: body })
  });
}

function getEstShipDate() {
  const days = parseInt(process.env.DEFAULT_SHIPPING_DAYS || '5', 10);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

module.exports = { sendOrderConfirmation, sendCustomEmail };
