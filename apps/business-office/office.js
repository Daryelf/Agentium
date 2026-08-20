const officeId = window.location.pathname.split("/").filter(Boolean)[1] || "etsy-office";

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Authentication required");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function listMarkup(items = []) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function recordMarkup(items = [], emptyText = "No records yet.") {
  if (!items.length) return `<article><strong>${escapeHtml(emptyText)}</strong><span>Agent 101 will add records here as this office creates local work.</span></article>`;
  return items
    .slice(0, 8)
    .map((item) => `
      <article>
        <strong>${escapeHtml(item.title || item.name || item.id || "Office record")}</strong>
        <span>${escapeHtml(item.status || item.risk || item.workflowId || item.createdAt || "Local")}</span>
      </article>
    `)
    .join("");
}

function setLoading(message) {
  $("#officeTitle").textContent = message;
  $("#officeGoal").textContent = "Loading from Argentum OS local backend.";
}

function renderOffice(payload) {
  const office = payload.office || {};
  $("#officeEyebrow").textContent = office.name || "Business Office";
  $("#officeTitle").textContent = office.title || "Business Office";
  $("#officeRisk").textContent = `${office.risk || "medium"} risk`;
  $("#officeIntent").textContent = office.intent || office.workflowId || "local office";
  $("#officeGoal").textContent = office.allowedWork?.length
    ? `${office.title} can ${office.allowedWork.join(", ")}. Anything risky stays behind Human Gate.`
    : "This office is connected to Argentum OS and reports to Agent 101.";
  $("#allowedWork").innerHTML = listMarkup(office.allowedWork || []);
  $("#blockedWork").innerHTML = listMarkup(office.blockedWork || []);
  $("#taskCount").textContent = String(payload.tasks?.length || 0);
  $("#artifactCount").textContent = String(payload.artifacts?.length || 0);
  $("#approvalCount").textContent = String(payload.approvals?.length || 0);
  $("#taskList").innerHTML = recordMarkup(payload.tasks || [], "No office tasks yet.");
  $("#artifactList").innerHTML = recordMarkup(payload.artifacts || [], "No artifacts yet.");
  $("#approvalList").innerHTML = recordMarkup(payload.approvals || [], "No approvals waiting.");
}

async function loadOffice() {
  setLoading("Loading office...");
  try {
    renderOffice(await api(`/api/offices/${encodeURIComponent(officeId)}`));
  } catch (error) {
    $("#officeTitle").textContent = "Office unavailable";
    $("#officeGoal").textContent = error.message;
  }
}

async function runOfficeAction(action) {
  const messages = {
    create_task_plan: "Create a bounded local task plan for this office. Keep external actions locked behind Human Gate.",
    package_for_approval: "Package the next risky or external step from this office for Human Gate approval.",
  };
  const button = action === "create_task_plan" ? $("#createTaskPlan") : $("#packageApproval");
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";
  try {
    await api("/api/agent101/actions", {
      method: "POST",
      body: JSON.stringify({
        action,
        officeId,
        message: messages[action],
        packageType: action === "package_for_approval" ? "general" : undefined,
      }),
    });
    await loadOffice();
  } catch (error) {
    $("#officeGoal").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

$("#createTaskPlan").addEventListener("click", () => runOfficeAction("create_task_plan"));
$("#packageApproval").addEventListener("click", () => runOfficeAction("package_for_approval"));
$("#refreshOffice").addEventListener("click", loadOffice);

loadOffice();
