(() => {
  if (window.self !== window.top || document.querySelector("[data-argentum-human-gate]")) return;

  const POLL_MS = 5_000;
  const SEEN_KEY = "argentum.humanGate.seen.v1";
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const riskLabel = (approval) => String(approval.riskLevel || approval.risk || "medium").toLowerCase();
  const relativeTime = (value) => {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "Now";
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 60) return "Now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86_400)}d`;
  };
  const readSeen = () => {
    try {
      const value = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch {
      return new Set();
    }
  };
  const writeSeen = (ids) => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
    } catch {
      // The bubble still works when browser storage is unavailable.
    }
  };

  const mount = document.createElement("div");
  mount.className = "argentum-gate";
  mount.dataset.argentumHumanGate = "";
  mount.innerHTML = `
    <section class="argentum-gate-panel" id="argentumGatePanel" role="dialog" aria-modal="false" aria-labelledby="argentumGateTitle" hidden>
      <header>
        <div>
          <span><i aria-hidden="true"></i> Human Gate</span>
          <h2 id="argentumGateTitle">Quick approvals</h2>
        </div>
        <button class="argentum-gate-close" type="button" aria-label="Close Human Gate">×</button>
      </header>
      <div class="argentum-gate-summary">
        <strong id="argentumGateSummary">Checking requests</strong>
        <button type="button" data-gate-open-full>Open full center</button>
      </div>
      <div class="argentum-gate-list" id="argentumGateList" aria-live="polite"></div>
      <p class="argentum-gate-feedback" id="argentumGateFeedback" role="status" aria-live="polite"></p>
    </section>
    <button class="argentum-gate-trigger" type="button" aria-haspopup="dialog" aria-controls="argentumGatePanel" aria-expanded="false">
      <span class="argentum-gate-mark" aria-hidden="true"><i></i></span>
      <span><strong>Human Gate</strong><small id="argentumGateTriggerText">Checking</small></span>
      <b id="argentumGateCount" hidden>0</b>
    </button>
  `;
  document.body.append(mount);

  const panel = mount.querySelector(".argentum-gate-panel");
  const trigger = mount.querySelector(".argentum-gate-trigger");
  const closeButton = mount.querySelector(".argentum-gate-close");
  const countNode = mount.querySelector("#argentumGateCount");
  const triggerText = mount.querySelector("#argentumGateTriggerText");
  const summary = mount.querySelector("#argentumGateSummary");
  const list = mount.querySelector("#argentumGateList");
  const feedback = mount.querySelector("#argentumGateFeedback");
  let requests = [];
  let loading = false;
  let initialLoad = true;

  function sourceLabel(approval) {
    const explicit = String(approval.source || "").trim();
    if (explicit) return explicit;
    const office = String(approval.officeId || "").toLowerCase();
    if (office.includes("stock")) return "Stock Office";
    if (office.includes("print")) return "Print Shop";
    if (office.includes("clip")) return "Clipping Office";
    if (office.includes("etsy")) return "Etsy Office";
    if (office.includes("essentrx")) return "Essentrx Office";
    return "Agent 101";
  }

  function setOpen(open, options = {}) {
    const next = Boolean(open);
    panel.hidden = !next;
    trigger.setAttribute("aria-expanded", next ? "true" : "false");
    mount.classList.toggle("is-open", next);
    if (next) {
      const seen = readSeen();
      requests.forEach((approval) => seen.add(String(approval.id)));
      writeSeen(seen);
      mount.classList.remove("has-new");
      if (options.focus !== false) requestAnimationFrame(() => (panel.querySelector("[data-gate-decision]") || closeButton).focus({ preventScroll: true }));
    }
  }

  function render() {
    const count = requests.length;
    countNode.textContent = String(count);
    countNode.hidden = count === 0;
    triggerText.textContent = count ? `${count} need${count === 1 ? "s" : ""} you` : "Gate clear";
    summary.textContent = count ? `${count} request${count === 1 ? "" : "s"} waiting for your decision` : "No requests are waiting";
    trigger.classList.toggle("is-clear", count === 0);
    list.innerHTML = count
      ? requests.slice(0, 8).map((approval) => {
          const risk = riskLabel(approval);
          return `
            <article class="argentum-gate-request ${escapeHtml(risk)}" data-gate-request="${escapeHtml(approval.id)}">
              <div class="argentum-gate-request-top">
                <span>${escapeHtml(sourceLabel(approval))}</span>
                <em>${escapeHtml(risk)} · ${escapeHtml(relativeTime(approval.createdAt))}</em>
              </div>
              <h3>${escapeHtml(approval.title || "Approval required")}</h3>
              <p>${escapeHtml(approval.action || "Review the exact request before anything consequential continues.")}</p>
              <details>
                <summary>Scope and evidence</summary>
                <p><strong>Scope</strong>${escapeHtml(approval.exactScope || "Only this recorded action is included.")}</p>
                <p><strong>Evidence</strong>${escapeHtml(approval.evidence || "No additional evidence was attached.")}</p>
              </details>
              <div class="argentum-gate-actions">
                <button type="button" data-gate-decision="approve" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
                <button type="button" data-gate-decision="revise" data-approval-id="${escapeHtml(approval.id)}">Send back</button>
                <button type="button" data-gate-decision="block" data-approval-id="${escapeHtml(approval.id)}">Block</button>
              </div>
            </article>
          `;
        }).join("")
      : `
        <div class="argentum-gate-empty">
          <span aria-hidden="true">✓</span>
          <strong>Everything is clear</strong>
          <p>New risky actions will appear here automatically.</p>
        </div>
      `;
  }

  async function refresh(options = {}) {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch("/api/human-gate/pending", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to review approvals." : "Human Gate is unavailable.");
      const payload = await response.json();
      requests = Array.isArray(payload.approvals) ? payload.approvals : [];
      const seen = readSeen();
      const newRequests = requests.filter((approval) => !seen.has(String(approval.id)));
      render();
      if (newRequests.length) {
        mount.classList.add("has-new");
        if (initialLoad || options.revealNew !== false) setOpen(true, { focus: false });
      }
      feedback.textContent = "";
      initialLoad = false;
    } catch (error) {
      triggerText.textContent = "Unavailable";
      summary.textContent = "Human Gate could not refresh";
      feedback.textContent = error.message || "Human Gate could not refresh.";
    } finally {
      loading = false;
    }
  }

  async function decide(approvalId, action, button) {
    const card = button.closest(".argentum-gate-request");
    const buttons = [...card.querySelectorAll("button")];
    buttons.forEach((item) => { item.disabled = true; });
    const isStockOrder = /Approve exact Robinhood order:/i.test(card.querySelector("h3")?.textContent || "");
    feedback.textContent = action === "approve" && isStockOrder
      ? "Approved. Robinhood is rechecking and executing this one exact order…"
      : action === "approve" ? "Recording approval…" : action === "revise" ? "Sending back…" : "Blocking request…";
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The decision could not be recorded.");
      requests = requests.filter((approval) => String(approval.id) !== String(approvalId));
      render();
      const changedApproval = Array.isArray(payload.approvals) ? payload.approvals.find((item) => String(item.id) === String(approvalId)) : null;
      feedback.textContent = action === "approve" && isStockOrder
        ? changedApproval?.executionOutcome === "broker_order_reconciled"
          ? "Robinhood independently confirmed the one exact order."
          : changedApproval?.executionError || "Approved, but the order stopped safely during final Robinhood checks."
        : action === "approve" ? "Approved and recorded." : action === "revise" ? "Returned for revision." : "Blocked and recorded.";
      window.dispatchEvent(new CustomEvent("argentum:approval-changed", { detail: { approvalId, action } }));
      window.setTimeout(() => refresh({ revealNew: false }), 500);
    } catch (error) {
      buttons.forEach((item) => { item.disabled = false; });
      feedback.textContent = error.message || "The decision could not be recorded.";
    }
  }

  trigger.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => setOpen(false));
  mount.querySelector("[data-gate-open-full]").addEventListener("click", () => {
    if (typeof window.openArgentumHumanGate === "function") {
      window.openArgentumHumanGate();
      setOpen(false);
      return;
    }
    window.location.assign("/?view=approval");
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gate-decision]");
    if (!button) return;
    decide(button.dataset.approvalId, button.dataset.gateDecision, button);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !mount.contains(event.target)) setOpen(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("argentum:approval-created", () => refresh());

  refresh();
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);
})();
