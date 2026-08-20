"use strict";

const appState = {
  workspace: null,
  activeView: "discover",
  selectedRunId: null,
  selectedOpportunityId: null,
  selectedCandidateId: null,
  manualDesign: false,
  busy: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleCase(value) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value, includeDate = true) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", includeDate
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatBounds(bounds = {}) {
  return [bounds.x, bounds.y, bounds.z].every((value) => Number.isFinite(Number(value)))
    ? `${bounds.x} × ${bounds.y} × ${bounds.z} mm`
    : "Measurements required";
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function formatProvider(provider) {
  const labels = {
    openai_web_search: "OpenAI web search",
    brave: "Brave Search",
    serpapi: "SerpAPI",
  };
  return labels[provider] || titleCase(provider || "not connected");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = String(message || "");
  node.classList.toggle("error", error);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4800);
}

function setBusy(key, busy) {
  if (busy) appState.busy.add(key);
  else appState.busy.delete(key);
}

function isBusy(key) {
  return appState.busy.has(key);
}

function runs() {
  return appState.workspace?.discoveryRuns || [];
}

function opportunities() {
  return appState.workspace?.opportunities || [];
}

function candidates() {
  return appState.workspace?.candidates || [];
}

function selectedRun() {
  return runs().find((run) => run.id === appState.selectedRunId) || runs()[0] || null;
}

function selectedOpportunity() {
  const active = opportunities().filter((opportunity) => opportunity.stage !== "dismissed");
  return active.find((opportunity) => opportunity.id === appState.selectedOpportunityId) || active[0] || null;
}

function selectedCandidate() {
  return candidates().find((candidate) => candidate.id === appState.selectedCandidateId) || candidates()[0] || null;
}

function sourceById(sourceId) {
  return (appState.workspace?.sourceObservations || []).find((source) => source.id === sourceId) || null;
}

function normalizeSelections() {
  if (!runs().some((run) => run.id === appState.selectedRunId)) appState.selectedRunId = runs()[0]?.id || null;
  const visible = opportunities().filter((opportunity) => opportunity.stage !== "dismissed");
  if (!visible.some((opportunity) => opportunity.id === appState.selectedOpportunityId)) {
    const runOpportunity = visible.find((opportunity) => opportunity.discoveryRunId === appState.selectedRunId);
    appState.selectedOpportunityId = runOpportunity?.id || visible[0]?.id || null;
  }
  if (!candidates().some((candidate) => candidate.id === appState.selectedCandidateId)) {
    appState.selectedCandidateId = candidates()[0]?.id || null;
  }
}

function setView(view) {
  const allowed = new Set(["discover", "evidence", "shortlist", "design", "files", "settings"]);
  appState.activeView = allowed.has(view) ? view : "discover";
  $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== appState.activeView; });
  localStorage.setItem("argentumPrintLabView", appState.activeView);
  renderWorkflowRail();
  renderCommandSummary();
  if (appState.activeView === "evidence") renderEvidence();
  if (appState.activeView === "shortlist") renderShortlist();
  if (appState.activeView === "design") renderDesignLab();
  if (appState.activeView === "files") renderArtifacts();
  if (appState.activeView === "settings") renderSettings();
  $(".lab-main")?.scrollTo({ top: 0, behavior: "smooth" });
}

function renderWorkflowRail() {
  const counts = appState.workspace?.counts || {};
  const stages = [
    { id: "discover", number: "01", label: "Discover", detail: "Source-backed ideas", count: counts.opportunities || 0 },
    { id: "evidence", number: "02", label: "Evidence", detail: "URLs and research scope", count: counts.sourceObservations || 0 },
    { id: "shortlist", number: "03", label: "Shortlist", detail: "Operator-selected leads", count: counts.shortlisted || 0 },
    { id: "design", number: "04", label: "Design Lab", detail: "Measured requirements", count: counts.candidates || 0 },
    { id: "files", number: "05", label: "Files", detail: "Versioned geometry", count: counts.stlArtifacts || 0 },
  ];
  $("#workflowRail").innerHTML = stages.map((stage) => `
    <button class="workflow-step ${stage.id === appState.activeView ? "is-active" : ""}" type="button" data-switch-view="${stage.id}" aria-current="${stage.id === appState.activeView ? "page" : "false"}">
      <span class="workflow-step-number">${stage.number}</span>
      <span class="workflow-step-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.detail)}</small></span>
      <span class="workflow-step-count">${escapeHtml(stage.count)}</span>
    </button>
  `).join("");
}

function renderCommandSummary() {
  const copy = {
    discover: "Choose a problem space. Agent 101 will return only source-linked hypotheses and explicit unknowns.",
    evidence: "Inspect the exact research plan, cited URLs, provider, timestamps, and stored hashes.",
    shortlist: "These are operator-kept research leads. Market demand and production readiness remain unmeasured.",
    design: "Record measurements, material, use, and failure consequences before geometry generation.",
    files: "Review versioned local outputs and the validation gates that have—and have not—passed.",
    settings: "Manufacturer facts, your saved printer setup, external connections, and unresolved production gates.",
  };
  $("#commandSummary").textContent = copy[appState.activeView] || copy.discover;
}

function renderMachineAndProvider() {
  const profile = appState.workspace?.printerProfile;
  if (profile) {
    $("#machineChip").textContent = `${profile.model} · ${profile.operatingProfile?.installedNozzleMm ?? "?"} mm · ${profile.operatingProfile?.maxSimultaneousColors ?? 1} color`;
  }
  const truth = appState.workspace?.truth || {};
  const provider = $("#providerChip");
  provider.classList.toggle("is-ready", Boolean(truth.researchSearchConfigured));
  provider.classList.toggle("is-blocked", !truth.researchSearchConfigured);
  provider.querySelector("span").textContent = truth.researchSearchConfigured
    ? formatProvider(truth.researchSearchProvider)
    : "Research not connected";
}

function renderDiscoveryForm() {
  const lanes = appState.workspace?.discoveryLanes || [];
  const select = $("#laneInput");
  const previous = select.value;
  select.innerHTML = lanes.map((lane) => `<option value="${escapeHtml(lane.id)}">${escapeHtml(lane.name)}</option>`).join("");
  if (lanes.some((lane) => lane.id === previous)) select.value = previous;
  const lane = lanes.find((item) => item.id === select.value) || lanes[0];
  $("#laneObjective").textContent = lane?.objective || "No discovery lanes are registered.";
  const configured = Boolean(appState.workspace?.truth?.researchSearchConfigured);
  const button = $("#discoveryButton");
  button.disabled = !configured || !lanes.length || isBusy("create-discovery");
  button.querySelector("span").textContent = isBusy("create-discovery") ? "Preparing exact scope" : "Build discovery sweep";
  $("#discoveryConnectionNote").textContent = configured
    ? `${formatProvider(appState.workspace.truth.researchSearchProvider)} is available server-side. The sweep still requires Human Gate approval before any external call.`
    : "Connect OpenAI Live, Brave Search, or SerpAPI server-side. No example ideas will be substituted for missing research.";
}

function runStatusLabel(run) {
  const labels = {
    pending: "Waiting for approval",
    pending_approval: "Waiting for approval",
    approved_not_run: "Approved · ready to run",
    running_or_consumed: "Running or consumed",
    running: "Research running",
    complete: "Complete",
    partial: "Partial evidence",
    failed: "Failed",
    interrupted: "Interrupted",
    blocked: "Blocked",
  };
  return labels[run?.status] || titleCase(run?.status);
}

function renderRunStrip() {
  const node = $("#runStrip");
  if (!runs().length) {
    node.innerHTML = `<div class="run-empty">No external discovery has been requested. Your workspace is honestly empty.</div>`;
    return;
  }
  node.innerHTML = runs().map((run, index) => `
    <button class="run-card ${run.id === selectedRun()?.id ? "is-selected" : ""}" type="button" data-run-id="${escapeHtml(run.id)}">
      <span class="run-card-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="run-card-copy">
        <strong>${escapeHtml(run.plan?.brief?.laneName || "Discovery run")}</strong>
        <span>${escapeHtml(formatTime(run.createdAt))} · ${escapeHtml(formatProvider(run.provider))}</span>
        <span class="run-card-state ${escapeHtml(run.status)}">${escapeHtml(runStatusLabel(run))}</span>
      </span>
    </button>
  `).join("");
}

function opportunityCard(opportunity) {
  const sourceCount = opportunity.sourceObservationIds?.length || 0;
  const domains = opportunity.rankingFactors?.independentDomainCount || 0;
  return `
    <button class="opportunity-card ${opportunity.id === selectedOpportunity()?.id ? "is-selected" : ""}" type="button" data-opportunity-id="${escapeHtml(opportunity.id)}">
      <span class="opportunity-card-top"><span class="opportunity-order">Lead ${String(opportunity.discoveryOrder || 1).padStart(2, "0")}</span><span class="status-pill ${escapeHtml(opportunity.stage)}">${escapeHtml(titleCase(opportunity.stage))}</span></span>
      <h3>${escapeHtml(opportunity.title)}</h3>
      <p>${escapeHtml(opportunity.problem)}</p>
      <span class="opportunity-card-footer">
        <div><span>Evidence</span><strong>${sourceCount} source${sourceCount === 1 ? "" : "s"} · ${domains} domain${domains === 1 ? "" : "s"}</strong></div>
        <div><span>A1 path</span><strong>${escapeHtml(opportunity.manufacturing?.printerFit === "needs_measurement" ? "Measure first" : titleCase(opportunity.manufacturing?.printerFit))}</strong></div>
      </span>
    </button>
  `;
}

function emptyOpportunityBoard() {
  const run = selectedRun();
  if (!run) {
    return `<div class="board-empty"><span aria-hidden="true">⌁</span><h3>No sourced opportunities yet</h3><p>Choose a research lane above. Agent 101 will not seed sample cards or pretend an idea came from research.</p></div>`;
  }
  if (["pending", "pending_approval"].includes(run.status)) {
    return `<div class="board-empty"><span aria-hidden="true">⌁</span><h3>Research plan is waiting at Human Gate</h3><p>The exact queries are saved, but no provider has been contacted and no ideas have been created.</p><button class="secondary-button" type="button" data-show-approval="${escapeHtml(run.id)}">Review exact scope</button></div>`;
  }
  if (run.status === "approved_not_run") {
    return `<div class="board-empty"><span aria-hidden="true">→</span><h3>Approved sweep is ready</h3><p>This will consume the one-use approval and run only the saved provider, plan hash, and call limits.</p><button class="primary-button" type="button" data-run-discovery="${escapeHtml(run.id)}" data-approval-id="${escapeHtml(run.approval?.id || run.approvalId)}"><span>Run approved discovery</span></button></div>`;
  }
  if (["running", "running_or_consumed"].includes(run.status)) {
    return `<div class="board-empty"><span aria-hidden="true">↻</span><h3>Agent 101 is collecting cited evidence</h3><p>The workspace will refresh when the bounded run completes. A consumed approval will not be replayed.</p></div>`;
  }
  if (run.status === "failed") {
    return `<div class="board-empty"><span aria-hidden="true">!</span><h3>The approved run failed honestly</h3><p>${escapeHtml(run.error || run.execution?.error || "No opportunity records were created.")}</p></div>`;
  }
  return `<div class="board-empty"><span aria-hidden="true">⌁</span><h3>Sources were saved, but no qualified lead was produced</h3><p>Open the evidence ledger to inspect what the provider actually returned. The lab will not force weak sources into a product card.</p><button class="secondary-button" type="button" data-switch-view="evidence">Inspect evidence</button></div>`;
}

function renderOpportunityGrid() {
  const active = opportunities().filter((opportunity) => opportunity.stage !== "dismissed");
  $("#opportunityCount").textContent = `${active.length} active`;
  $("#opportunityGrid").innerHTML = active.length ? active.map(opportunityCard).join("") : emptyOpportunityBoard();
}

function renderOpportunityDetail() {
  const node = $("#opportunityDetail");
  const opportunity = selectedOpportunity();
  if (!opportunity) {
    node.innerHTML = `<div class="detail-empty"><span class="detail-empty-icon" aria-hidden="true">⌁</span><h3>No research lead selected</h3><p>Only a completed source-backed discovery can populate this panel.</p></div>`;
    return;
  }
  const sources = (opportunity.sourceObservationIds || []).map(sourceById).filter(Boolean);
  const sourceLinks = sources.map((source) => {
    const url = safeHttpUrl(source.url);
    return url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.domain)} · ${escapeHtml(formatTime(source.observedAt))}</small></a>` : "";
  }).join("");
  const isShortlisted = opportunity.stage === "shortlisted";
  const isPromoted = opportunity.stage === "promoted";
  node.innerHTML = `
    <header class="opportunity-detail-head">
      <div class="detail-meta"><span class="section-kicker">Research lead ${String(opportunity.discoveryOrder || 1).padStart(2, "0")}</span><button class="text-button" type="button" data-opportunity-action="dismiss" data-opportunity-target="${escapeHtml(opportunity.id)}">Dismiss lead</button></div>
      <h2>${escapeHtml(opportunity.title)}</h2>
      <p>${escapeHtml(opportunity.problem)}</p>
    </header>
    <section class="detail-section"><h3>Evidence boundary</h3><ul class="evidence-summary">${(opportunity.evidenceSummary || []).map((summary) => `<li>${escapeHtml(summary)}</li>`).join("")}</ul></section>
    <section class="detail-section"><h3>Product direction</h3><div class="truth-list">
      <div class="truth-row"><span>Potential buyer</span><strong>${escapeHtml(opportunity.targetBuyer)}</strong></div>
      <div class="truth-row"><span>Geometry path</span><strong>${escapeHtml(opportunity.manufacturing?.templateName || "Custom review")}</strong></div>
      <div class="truth-row"><span>A1 Mini fit</span><strong class="unknown">Measurements required</strong></div>
      <div class="truth-row"><span>Material</span><strong class="unknown">Not selected</strong></div>
      <div class="truth-row"><span>Demand / price</span><strong class="unknown">Unmeasured</strong></div>
      <div class="truth-row"><span>Commercial rights</span><strong class="unknown">Unverified</strong></div>
    </div></section>
    <section class="detail-section"><h3>Cited sources</h3><div class="source-links">${sourceLinks || "<p>No safe source links were available.</p>"}</div></section>
    <div class="detail-actions">
      <button class="opportunity-action" type="button" data-opportunity-action="${isShortlisted ? "restore" : "shortlist"}" data-opportunity-target="${escapeHtml(opportunity.id)}">${isShortlisted ? "Remove from shortlist" : "Add to shortlist"}</button>
      <button class="opportunity-action primary" type="button" data-promote-opportunity="${escapeHtml(opportunity.id)}" ${isPromoted || isBusy(`promote:${opportunity.id}`) ? "disabled" : ""}>${isPromoted ? "Design project opened" : isBusy(`promote:${opportunity.id}`) ? "Opening project" : "Start measured project"}</button>
    </div>
  `;
}

function renderDiscover() {
  renderDiscoveryForm();
  renderRunStrip();
  renderOpportunityGrid();
  renderOpportunityDetail();
}

function renderEvidence() {
  const select = $("#evidenceRunSelect");
  if (!runs().length) {
    select.innerHTML = `<option>No discovery runs</option>`;
    select.disabled = true;
    $("#evidencePlan").innerHTML = `<div class="detail-empty"><span class="detail-empty-icon">⌁</span><h3>No research scope recorded</h3><p>Create a discovery sweep first.</p></div>`;
    $("#sourceLedger").innerHTML = `<div class="detail-empty"><span class="detail-empty-icon">⌁</span><h3>No external evidence</h3><p>No provider has returned source observations.</p></div>`;
    return;
  }
  select.disabled = false;
  select.innerHTML = runs().map((run) => `<option value="${escapeHtml(run.id)}" ${run.id === selectedRun()?.id ? "selected" : ""}>${escapeHtml(run.plan?.brief?.laneName || "Discovery")} · ${escapeHtml(formatTime(run.createdAt))}</option>`).join("");
  const run = selectedRun();
  const runSources = (run?.sourceObservationIds || []).map(sourceById).filter(Boolean);
  $("#evidencePlan").innerHTML = `
    <header><span class="section-kicker">Approved plan</span><h2>${escapeHtml(run.plan?.brief?.laneName || "Discovery run")}</h2></header>
    <div class="evidence-run-summary">
      <div><span>Status</span><strong>${escapeHtml(runStatusLabel(run))}</strong></div>
      <div><span>Provider</span><strong>${escapeHtml(formatProvider(run.provider))}</strong></div>
      <div><span>Sources</span><strong>${runSources.length}</strong></div>
      <div><span>Ideas</span><strong>${run.opportunityIds?.length || 0}</strong></div>
    </div>
    <div class="query-plan">${(run.plan?.queries || []).map((query, index) => `<div class="query-row"><span>${index + 1}</span><div><strong>${escapeHtml(query.label)}</strong><small>${escapeHtml(query.query)}</small></div></div>`).join("")}</div>
  `;
  $("#sourceLedger").innerHTML = `
    <header><span class="section-kicker">Persisted observations</span><h2>${runSources.length} cited source${runSources.length === 1 ? "" : "s"}</h2></header>
    <div class="source-list">${runSources.length ? runSources.map((source) => {
      const url = safeHttpUrl(source.url);
      return `<article class="source-row"><div class="source-copy">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>` : `<strong>${escapeHtml(source.title)}</strong>`}<p>${escapeHtml(source.snippet || "No provider summary was stored.")}</p></div><div class="source-meta"><span>${escapeHtml(source.domain)}</span><span>${escapeHtml(formatTime(source.observedAt))}</span><code>${escapeHtml(source.contentHash)}</code></div></article>`;
    }).join("") : `<div class="detail-empty"><span class="detail-empty-icon">⌁</span><h3>No provider results</h3><p>This run has not stored any external observations.</p></div>`}</div>
  `;
}

function renderShortlist() {
  const shortlisted = opportunities().filter((opportunity) => opportunity.stage === "shortlisted");
  $("#shortlistGrid").innerHTML = shortlisted.length ? shortlisted.map((opportunity) => `
    <article class="shortlist-card">
      <span class="status-pill shortlisted">Shortlisted</span>
      <h2>${escapeHtml(opportunity.title)}</h2>
      <p>${escapeHtml(opportunity.problem)}</p>
      <div class="truth-list"><div class="truth-row"><span>Cited sources</span><strong>${opportunity.sourceObservationIds?.length || 0}</strong></div><div class="truth-row"><span>A1 Mini fit</span><strong class="unknown">Needs measurement</strong></div></div>
      <div class="detail-actions"><button class="opportunity-action" type="button" data-open-opportunity="${escapeHtml(opportunity.id)}">Open evidence</button><button class="opportunity-action primary" type="button" data-promote-opportunity="${escapeHtml(opportunity.id)}">Start measured project</button></div>
    </article>
  `).join("") : `<div class="shortlist-empty"><span aria-hidden="true">⌁</span><h2>Your shortlist is empty</h2><p>Keep only the source-backed ideas you want Agent 101 to investigate further.</p></div>`;
}

function candidateStatusTone(candidate) {
  if (candidate?.assessment?.generationEligible || candidate?.status === "mesh_checks_passed") return "";
  if (candidate?.assessment?.safety?.status === "review_required") return "blocked";
  return "attention";
}

function assessmentTone(status) {
  if (["preferred", "coarse_fit", "fits_current_process", "supported"].includes(status)) return "";
  if (["not_recommended", "blocked_by_current_process", "review_required"].includes(status)) return "blocked";
  return "attention";
}

function assessmentCard(label, status, summary) {
  return `<article class="assessment-card ${assessmentTone(status)}"><header><span>${escapeHtml(label)}</span><strong>${escapeHtml(titleCase(status))}</strong></header><p>${escapeHtml(summary)}</p></article>`;
}

function fillProductForm(candidate = null) {
  const form = $("#productForm");
  const requirements = candidate?.requirements || {};
  form.elements.candidateId.value = candidate?.id || "";
  form.elements.concept.value = requirements.concept || "";
  form.elements.templateId.value = requirements.templateId || "auto";
  form.elements.material.value = requirements.material || "";
  form.elements.widthMm.value = requirements.dimensionsMm?.x ?? "";
  form.elements.depthMm.value = requirements.dimensionsMm?.y ?? "";
  form.elements.heightMm.value = requirements.dimensionsMm?.z ?? "";
  form.elements.colorCount.value = String(requirements.requiredColors || 1);
  form.elements.quantity.value = String(requirements.quantity || 1);
  form.elements.separateColorParts.checked = Boolean(requirements.separateColorParts);
  form.elements.useCase.value = requirements.useCase || "";
  form.elements.environment.value = requirements.environment || "";
  form.elements.loadNotes.value = requirements.loadNotes || "";
  $("#formOrigin").textContent = candidate?.evidence?.origin === "discovery_run" ? "Source-backed lead · measurements required" : "Operator product direction";
  $("#formTitle").textContent = candidate?.title || "New product record";
  $("#formStatus").textContent = candidate ? titleCase(candidate.status) : "New";
}

function renderCandidateTabs() {
  const node = $("#candidateTabs");
  node.innerHTML = candidates().length ? candidates().map((candidate) => `
    <button class="project-tab ${candidate.id === selectedCandidate()?.id && !appState.manualDesign ? "is-active" : ""}" type="button" data-candidate-id="${escapeHtml(candidate.id)}"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(titleCase(candidate.status))}</small></button>
  `).join("") : `<div class="run-empty">No design projects have been created.</div>`;
}

function renderCandidateDetail() {
  const node = $("#candidateDetail");
  const candidate = appState.manualDesign ? null : selectedCandidate();
  if (!candidate) {
    node.innerHTML = `<div class="detail-empty"><span class="detail-empty-icon" aria-hidden="true">⌁</span><h3>${appState.manualDesign ? "Record the real product constraints" : "No project selected"}</h3><p>${appState.manualDesign ? "The analysis will start only after you save this operator-origin concept. Measurements and material remain mandatory for geometry." : "Choose or create a design project to see its feasibility gates."}</p></div>`;
    return;
  }
  const assessment = candidate.assessment || {};
  const fit = assessment.printerFit || {};
  const coverage = assessment.requirementsCoverage || { percent: 0, label: "No requirements" };
  const generated = candidate.status === "mesh_checks_passed";
  const canGenerate = Boolean(assessment.generationEligible) && !generated;
  node.innerHTML = `
    <section class="candidate-hero ${candidateStatusTone(candidate)}"><span class="section-kicker">${escapeHtml(candidate.evidence?.origin === "discovery_run" ? "Discovered project" : "Operator project")}</span><h2>${escapeHtml(candidate.title)}</h2><p>${escapeHtml(assessment.headline || "Requirements are not complete.")}</p><div class="coverage-meter"><div><span>Requirements coverage</span><strong>${escapeHtml(coverage.label)}</strong></div><i><b style="--coverage:${Number(coverage.percent || 0)}%"></b></i></div></section>
    <div class="assessment-stack">
      ${assessmentCard("Printer fit", fit.status, fit.summary || "Measurements are required.")}
      ${assessmentCard("Material", assessment.material?.status, assessment.material?.summary || "Choose a material.")}
      ${assessmentCard("Color process", assessment.color?.status, assessment.color?.summary || "One-color setup applies.")}
      ${assessmentCard("Safety / rights", assessment.safety?.status, assessment.safety?.reviews?.length ? assessment.safety.reviews.map((review) => review.label).join(" · ") : assessment.safety?.intellectualProperty?.summary || "Review required.")}
    </div>
    <section class="next-action-panel"><h3>Next verified actions</h3><ol>${(assessment.nextActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("") || "<li>Record the missing design evidence.</li>"}</ol></section>
    <button class="generate-button" type="button" data-generate-candidate="${escapeHtml(candidate.id)}" ${canGenerate ? "" : "disabled"}>${generated ? "Version generated · slice pending" : canGenerate ? "Generate versioned STL" : "Geometry locked"}</button>
  `;
}

function renderDesignLab() {
  renderCandidateTabs();
  const candidate = appState.manualDesign ? null : selectedCandidate();
  const form = $("#productForm");
  const empty = $("#designEmpty");
  const showForm = Boolean(candidate) || appState.manualDesign;
  form.hidden = !showForm;
  empty.hidden = showForm;
  if (showForm) fillProductForm(candidate);
  renderCandidateDetail();
}

function renderArtifacts() {
  const artifacts = appState.workspace?.artifacts || [];
  $("#artifactList").innerHTML = artifacts.length ? artifacts.map((artifact) => `
    <article class="artifact-card"><header><h2>${escapeHtml(artifact.name)}</h2><em>${escapeHtml(titleCase(artifact.validation?.geometryStatus || "recorded"))}</em></header><p>${escapeHtml(artifact.notes || "No production note recorded.")}</p><div class="artifact-data"><div><span>Bounds</span><strong>${escapeHtml(formatBounds(artifact.validation?.boundsMm))}</strong></div><div><span>Triangles</span><strong>${escapeHtml(artifact.validation?.triangleCount || 0)}</strong></div><div><span>File</span><strong>${escapeHtml(formatBytes(artifact.byteSize))}</strong></div></div><div class="artifact-data"><div><span>Slicer</span><strong>${escapeHtml(titleCase(artifact.validation?.slicerStatus))}</strong></div><div><span>Prototype</span><strong>${escapeHtml(titleCase(artifact.validation?.prototypeStatus))}</strong></div><div><span>Hash</span><strong>${escapeHtml(String(artifact.sha256 || "").slice(0, 12))}</strong></div></div><a class="artifact-download" href="${escapeHtml(artifact.downloadUrl)}">Download verified STL</a></article>
  `).join("") : `<div class="files-empty"><span aria-hidden="true">⌁</span><h2>No design files have been generated</h2><p>Complete a measured product record first. The lab will not place demo STLs in a production workspace.</p></div>`;
}

function renderSettings() {
  const profile = appState.workspace?.printerProfile;
  const truth = appState.workspace?.truth || {};
  if (!profile) return;
  $("#printerSettings").innerHTML = `<header class="settings-card-head"><span class="section-kicker">Saved production profile</span><h2>${escapeHtml(profile.manufacturer)} ${escapeHtml(profile.model)}</h2><p>Factory facts remain separate from your operator-provided configuration and Argentum's conservative planning policy.</p></header><div class="fact-list">
    <div class="fact-row"><span>Factory build volume</span><strong>${escapeHtml(formatBounds(profile.factorySpec?.buildVolumeMm))}</strong></div>
    <div class="fact-row"><span>Planning envelope</span><strong>${escapeHtml(formatBounds(profile.engineeringPolicy?.designEnvelopeMm))}</strong></div>
    <div class="fact-row"><span>Installed nozzle</span><strong>${escapeHtml(profile.operatingProfile?.installedNozzleMm)} mm · operator provided</strong></div>
    <div class="fact-row"><span>Current color process</span><strong>${escapeHtml(profile.operatingProfile?.maxSimultaneousColors)} at a time</strong></div>
    <div class="fact-row"><span>Preferred materials</span><strong>${escapeHtml((profile.factorySpec?.preferredMaterials || []).join(" · "))}</strong></div>
    <div class="fact-row"><span>Source</span><strong><a href="${escapeHtml(safeHttpUrl(profile.factorySpec?.source?.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.factorySpec?.source?.publisher || "Official specification")}</a></strong></div>
  </div>`;
  $("#connectionTruth").innerHTML = `<header class="settings-card-head"><span class="section-kicker">Connected systems</span><h2>What the lab can prove now</h2><p>Disconnected production tools remain visible as blockers instead of being simulated.</p></header><div class="connection-list">
    <div class="connection-row"><span>Product research</span><strong class="${truth.researchSearchConfigured ? "" : "no"}">${escapeHtml(truth.researchSearchConfigured ? formatProvider(truth.researchSearchProvider) : "Not connected")}</strong></div>
    <div class="connection-row"><span>Bambu slicer</span><strong class="${truth.slicerConnected ? "" : "no"}">${truth.slicerConnected ? "Connected" : "Not connected"}</strong></div>
    <div class="connection-row"><span>Physical printer</span><strong class="${truth.printerConnected ? "" : "no"}">${truth.printerConnected ? "Connected" : "Not connected"}</strong></div>
    <div class="connection-row"><span>Cost model</span><strong class="${truth.costModelReady ? "" : "no"}">${truth.costModelReady ? "Measured" : "Waiting for slice"}</strong></div>
    <div class="connection-row"><span>Market demand</span><strong class="no">Unmeasured</strong></div>
  </div>`;
  const activity = appState.workspace?.activity || [];
  $("#activityList").innerHTML = activity.length ? activity.map((item) => `<article class="activity-row"><i></i><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div><time>${escapeHtml(formatTime(item.createdAt))}</time></article>`).join("") : `<div class="run-empty">No local changes recorded.</div>`;
}

function renderAll() {
  normalizeSelections();
  renderMachineAndProvider();
  renderWorkflowRail();
  renderCommandSummary();
  renderDiscover();
  if (appState.activeView === "evidence") renderEvidence();
  if (appState.activeView === "shortlist") renderShortlist();
  if (appState.activeView === "design") renderDesignLab();
  if (appState.activeView === "files") renderArtifacts();
  if (appState.activeView === "settings") renderSettings();
}

async function loadWorkspace(options = {}) {
  try {
    const workspace = await api("/api/print-shop/workspace");
    appState.workspace = workspace;
    renderAll();
    if (!options.quiet) toast("Product Research Lab refreshed from persisted workspace data.");
  } catch (error) {
    toast(error.message, true);
  }
}

function showApprovalDialog(run, approval = null) {
  if (!run) return;
  const details = approval?.details || run.scope || {};
  $("#approvalDialogBody").innerHTML = `
    <p>No external provider has run from creating this plan. Human Gate must approve the exact saved scope before Agent 101 can contact ${escapeHtml(formatProvider(run.provider))}.</p>
    <div class="approval-scope"><div><span>Research lane</span><strong>${escapeHtml(run.plan?.brief?.laneName)}</strong></div><div><span>Provider</span><strong>${escapeHtml(formatProvider(run.provider))}</strong></div><div><span>Provider requests</span><strong>${escapeHtml(details.maximumProviderRequests ?? run.plan?.maximumCalls)}</strong></div><div><span>Maximum search calls</span><strong>${escapeHtml(details.maximumToolCalls ?? run.plan?.maximumCalls)}</strong></div><div><span>Maximum ideas</span><strong>${escapeHtml(details.maximumOpportunities ?? 8)}</strong></div></div>
    <div><span class="section-kicker">Exact research angles</span><ol class="approval-query-list">${(run.plan?.queries || []).map((query) => `<li><strong>${escapeHtml(query.label)}</strong> · ${escapeHtml(query.query)}</li>`).join("")}</ol></div>
    <p>Approval does not authorize printing, buying supplies, setting a price, publishing, contacting customers, or using a third-party design.</p>
  `;
  const dialog = $("#approvalDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeApprovalDialog() {
  const dialog = $("#approvalDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

async function createDiscovery(event) {
  event.preventDefault();
  if (isBusy("create-discovery")) return;
  setBusy("create-discovery", true);
  renderDiscoveryForm();
  try {
    const payload = await api("/api/print-shop/discovery-runs", {
      method: "POST",
      body: JSON.stringify({ laneId: event.currentTarget.elements.laneId.value, geography: "United States" }),
    });
    await loadWorkspace({ quiet: true });
    appState.selectedRunId = payload.run.id;
    renderAll();
    showApprovalDialog(payload.run, payload.approval);
    toast("Exact discovery scope saved. No external research has run; Human Gate approval is required.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy("create-discovery", false);
    renderDiscoveryForm();
  }
}

async function runDiscovery(runId, approvalId, button) {
  const key = `run:${runId}`;
  if (isBusy(key)) return;
  setBusy(key, true);
  if (button) {
    button.disabled = true;
    button.textContent = "Agent 101 is researching cited sources";
  }
  try {
    const payload = await api(`/api/print-shop/discovery-runs/${encodeURIComponent(runId)}/run`, {
      method: "POST",
      body: JSON.stringify({ approvalId }),
    });
    await loadWorkspace({ quiet: true });
    appState.selectedRunId = runId;
    const firstOpportunity = opportunities().find((opportunity) => opportunity.discoveryRunId === runId);
    appState.selectedOpportunityId = firstOpportunity?.id || null;
    renderAll();
    toast(`${payload.sourceCount} cited observations saved and ${payload.opportunityCount} evidence-linked lead${payload.opportunityCount === 1 ? "" : "s"} prepared.`);
  } catch (error) {
    await loadWorkspace({ quiet: true });
    toast(error.message, true);
  } finally {
    setBusy(key, false);
  }
}

async function updateOpportunityAction(opportunityId, action) {
  const key = `opportunity:${opportunityId}`;
  if (isBusy(key)) return;
  setBusy(key, true);
  try {
    await api(`/api/print-shop/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    await loadWorkspace({ quiet: true });
    toast(action === "shortlist" ? "Opportunity added to your shortlist." : action === "dismiss" ? "Opportunity dismissed from the active board." : "Opportunity returned to the discovery board.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(key, false);
  }
}

async function promoteOpportunity(opportunityId) {
  const key = `promote:${opportunityId}`;
  if (isBusy(key)) return;
  setBusy(key, true);
  renderOpportunityDetail();
  try {
    const payload = await api(`/api/print-shop/opportunities/${encodeURIComponent(opportunityId)}/promote`, { method: "POST", body: "{}" });
    await loadWorkspace({ quiet: true });
    appState.selectedCandidateId = payload.candidate.id;
    appState.manualDesign = false;
    setView("design");
    renderDesignLab();
    toast("Research lead opened as a measured design project. Dimensions and material are still blank.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(key, false);
    renderOpportunityDetail();
  }
}

function productPayload(form) {
  const data = new FormData(form);
  return {
    concept: data.get("concept"),
    templateId: data.get("templateId"),
    material: data.get("material"),
    dimensionsMm: { x: data.get("widthMm"), y: data.get("depthMm"), z: data.get("heightMm") },
    colorCount: Number(data.get("colorCount") || 1),
    separateColorParts: data.get("separateColorParts") === "on",
    quantity: Number(data.get("quantity") || 1),
    useCase: data.get("useCase"),
    environment: data.get("environment"),
    loadNotes: data.get("loadNotes"),
  };
}

async function saveProduct(event) {
  event.preventDefault();
  if (isBusy("save-product")) return;
  setBusy("save-product", true);
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Analyzing recorded evidence";
  try {
    const candidateId = form.elements.candidateId.value;
    const payload = await api(candidateId ? `/api/print-shop/candidates/${encodeURIComponent(candidateId)}` : "/api/print-shop/candidates", {
      method: candidateId ? "PATCH" : "POST",
      body: JSON.stringify(productPayload(form)),
    });
    appState.selectedCandidateId = payload.candidate.id;
    appState.manualDesign = false;
    await loadWorkspace({ quiet: true });
    renderDesignLab();
    toast("Design requirements saved. Unknown fit, cost, and production gates remain explicit.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy("save-product", false);
    submit.disabled = false;
    submit.textContent = "Save and analyze";
  }
}

async function generateCandidate(candidateId, button) {
  const key = `generate:${candidateId}`;
  if (isBusy(key)) return;
  setBusy(key, true);
  button.disabled = true;
  button.textContent = "Generating and validating geometry";
  try {
    const result = await api(`/api/print-shop/candidates/${encodeURIComponent(candidateId)}/generate`, { method: "POST", body: "{}" });
    await loadWorkspace({ quiet: true });
    setView("files");
    toast(`${result.artifacts.length} versioned STL file${result.artifacts.length === 1 ? "" : "s"} generated. Slicer and prototype gates remain pending.`);
  } catch (error) {
    toast(error.message, true);
    renderCandidateDetail();
  } finally {
    setBusy(key, false);
  }
}

document.addEventListener("click", (event) => {
  const switcher = event.target.closest("[data-switch-view]");
  if (switcher) { setView(switcher.dataset.switchView); return; }

  const runCard = event.target.closest("[data-run-id]");
  if (runCard) {
    appState.selectedRunId = runCard.dataset.runId;
    const opportunity = opportunities().find((item) => item.discoveryRunId === appState.selectedRunId && item.stage !== "dismissed");
    if (opportunity) appState.selectedOpportunityId = opportunity.id;
    renderDiscover();
    if (appState.activeView === "evidence") renderEvidence();
    return;
  }

  const opportunityCardNode = event.target.closest("[data-opportunity-id]");
  if (opportunityCardNode) {
    appState.selectedOpportunityId = opportunityCardNode.dataset.opportunityId;
    renderOpportunityGrid();
    renderOpportunityDetail();
    return;
  }

  const showApproval = event.target.closest("[data-show-approval]");
  if (showApproval) { showApprovalDialog(runs().find((run) => run.id === showApproval.dataset.showApproval)); return; }

  const runButton = event.target.closest("[data-run-discovery]");
  if (runButton) { runDiscovery(runButton.dataset.runDiscovery, runButton.dataset.approvalId, runButton); return; }

  const opportunityAction = event.target.closest("[data-opportunity-action]");
  if (opportunityAction) { updateOpportunityAction(opportunityAction.dataset.opportunityTarget, opportunityAction.dataset.opportunityAction); return; }

  const promote = event.target.closest("[data-promote-opportunity]");
  if (promote) { promoteOpportunity(promote.dataset.promoteOpportunity); return; }

  const openOpportunity = event.target.closest("[data-open-opportunity]");
  if (openOpportunity) {
    appState.selectedOpportunityId = openOpportunity.dataset.openOpportunity;
    setView("discover");
    renderDiscover();
    return;
  }

  const candidateTab = event.target.closest("[data-candidate-id]");
  if (candidateTab) {
    appState.selectedCandidateId = candidateTab.dataset.candidateId;
    appState.manualDesign = false;
    renderDesignLab();
    return;
  }

  const generate = event.target.closest("[data-generate-candidate]");
  if (generate) { generateCandidate(generate.dataset.generateCandidate, generate); return; }

  if (event.target.closest("[data-close-dialog]")) closeApprovalDialog();
});

$("#discoveryForm").addEventListener("submit", createDiscovery);
$("#laneInput").addEventListener("change", renderDiscoveryForm);
$("#productForm").addEventListener("submit", saveProduct);
$("#refreshButton").addEventListener("click", () => loadWorkspace());
$("#evidenceRunSelect").addEventListener("change", (event) => { appState.selectedRunId = event.target.value; renderEvidence(); });
$("#newIdeaButton").addEventListener("click", () => { appState.manualDesign = true; appState.selectedCandidateId = null; renderDesignLab(); $("#productForm input[name=concept]").focus(); });

const savedView = localStorage.getItem("argentumPrintLabView");
if (["discover", "evidence", "shortlist", "design", "files", "settings"].includes(savedView)) appState.activeView = savedView;
setView(appState.activeView);
loadWorkspace({ quiet: true });

setInterval(() => {
  if (runs().some((run) => ["pending", "pending_approval", "approved_not_run", "running", "running_or_consumed"].includes(run.status))) {
    loadWorkspace({ quiet: true });
  }
}, 12_000);
