const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

function normalizeEvent(type, payload = {}, options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  return {
    id: options.id || `${type}:${crypto.randomUUID()}`,
    type,
    correlationId: options.correlationId || payload.correlationId || `stock-correlation-${crypto.randomUUID()}`,
    createdAt,
    payload,
  };
}

function createStockEventBus(options = {}) {
  const emitter = new EventEmitter();
  const persist = typeof options.persist === "function" ? options.persist : () => {};
  const clients = new Set();
  emitter.setMaxListeners(50);

  function publish(type, payload = {}, publishOptions = {}) {
    const event = normalizeEvent(type, payload, publishOptions);
    try {
      persist({
        id: event.id,
        correlationId: event.correlationId,
        type: event.type,
        actorType: publishOptions.actorType || payload.actorType || "SYSTEM",
        actorId: publishOptions.actorId || payload.actorId || "",
        symbol: payload.symbol || "",
        proposalId: payload.proposalId || payload.proposal?.id || "",
        orderId: payload.orderId || payload.draft?.brokerOrderId || "",
        oldState: payload.oldState || "",
        newState: payload.newState || payload.status || "",
        decision: payload.decision || "",
        reason: payload.reason || "",
        error: payload.error || "",
        createdAt: event.createdAt,
        data: payload,
      });
    } catch (error) {
      console.warn("Stock event persistence failed safely:", error.message);
    }
    emitter.emit(type, event);
    emitter.emit("*", event);
    const encoded = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of [...clients]) {
      try {
        client.write(encoded);
      } catch {
        clients.delete(client);
      }
    }
    return event;
  }

  function subscribe(type, listener) {
    emitter.on(type, listener);
    return () => emitter.off(type, listener);
  }

  function attachSse(response) {
    clients.add(response);
    response.write(`event: connected\ndata: ${JSON.stringify({ type: "connected", createdAt: new Date().toISOString() })}\n\n`);
    const heartbeat = setInterval(() => {
      try { response.write(`: heartbeat ${Date.now()}\n\n`); } catch { clients.delete(response); }
    }, 20_000);
    heartbeat.unref?.();
    return () => {
      clearInterval(heartbeat);
      clients.delete(response);
    };
  }

  return {
    attachSse,
    clientCount: () => clients.size,
    publish,
    subscribe,
  };
}

module.exports = {
  createStockEventBus,
  normalizeEvent,
};
