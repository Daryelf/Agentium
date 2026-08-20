"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const printShop = require("../services/print-shop-workspace");

function temporaryWorkspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-shop-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function validConcept(overrides = {}) {
  return {
    concept: "single-color desktop storage tray",
    templateId: "storage_tray",
    dimensionsMm: { x: 120, y: 80, z: 25 },
    material: "PLA",
    colorCount: 1,
    separateColorParts: false,
    useCase: "Indoor desk organizer for light charging cables",
    environment: "Indoor room temperature",
    loadNotes: "Light cable load",
    ...overrides,
  };
}

test("A1 Mini profile separates manufacturer facts from operator configuration", () => {
  assert.deepEqual(printShop.A1_MINI_PROFILE.factorySpec.buildVolumeMm, { x: 180, y: 180, z: 180 });
  assert.equal(printShop.A1_MINI_PROFILE.factorySpec.factoryNozzleMm, 0.4);
  assert.equal(printShop.A1_MINI_PROFILE.factorySpec.source.publisher, "Bambu Lab");
  assert.equal(printShop.A1_MINI_PROFILE.operatingProfile.configurationSource, "operator_provided");
  assert.equal(printShop.A1_MINI_PROFILE.operatingProfile.maxSimultaneousColors, 1);
  assert.deepEqual(printShop.A1_MINI_PROFILE.engineeringPolicy.designEnvelopeMm, { x: 176, y: 176, z: 176 });
});

test("feasibility preserves missing measurements and refuses fake economics", () => {
  const result = printShop.analyzeRequirements(validConcept({ dimensionsMm: {} }));
  assert.equal(result.assessment.printerFit.status, "needs_measurement");
  assert.equal(result.assessment.generationEligible, false);
  assert.equal(result.assessment.economics.filamentGrams, null);
  assert.equal(result.assessment.economics.machineHours, null);
  assert.equal(result.assessment.economics.unitCost, null);
  assert.equal(result.assessment.marketEvidence.demand, null);
  assert.equal(result.assessment.marketEvidence.sellingPrice, null);
});

test("oversized dimensions produce a proposed multipart plan, not a printability claim", () => {
  const result = printShop.analyzeRequirements(validConcept({
    concept: "wide label plate",
    templateId: "label_plate",
    dimensionsMm: { x: 300, y: 100, z: 4 },
  }));
  assert.equal(result.assessment.printerFit.status, "split_required");
  assert.equal(result.assessment.printerFit.splitPlan.status, "proposed_not_validated");
  assert.equal(result.assessment.printerFit.splitPlan.partCount, 2);
  assert.equal(result.assessment.printerFit.splitPlan.assemblyStatus, "connector_geometry_not_generated");
  assert.equal(result.assessment.generationEligible, false);
});

test("multiple colors require sequential parts on the saved one-color process", () => {
  const blocked = printShop.analyzeRequirements(validConcept({ colorCount: 2, separateColorParts: false }));
  assert.equal(blocked.assessment.color.status, "blocked_by_current_process");
  assert.equal(blocked.assessment.generationEligible, false);

  const planned = printShop.analyzeRequirements(validConcept({
    concept: "two-color drawer divider set",
    templateId: "divider_set",
    colorCount: 2,
    separateColorParts: true,
  }));
  assert.equal(planned.assessment.color.status, "sequential_parts_required");
  assert.equal(planned.assessment.color.separatePartsRequired, true);
  assert.equal(planned.assessment.generationEligible, true);
});

test("not-recommended materials and safety-critical uses are hard blockers", () => {
  const result = printShop.analyzeRequirements(validConcept({
    material: "ABS",
    useCase: "A children's toy that holds an overhead load",
  }));
  assert.equal(result.assessment.material.status, "not_recommended");
  assert.equal(result.assessment.safety.status, "review_required");
  assert.ok(result.assessment.safety.reviews.some((review) => review.id === "children"));
  assert.ok(result.assessment.safety.reviews.some((review) => review.id === "overhead"));
  assert.equal(result.assessment.generationEligible, false);
});

test("unsupported custom geometry produces no dummy STL", (t) => {
  const directory = temporaryWorkspace(t);
  const candidate = printShop.analyzeCandidate(directory, validConcept({
    concept: "ergonomic articulated phone stand",
    templateId: "custom",
  }));
  assert.equal(candidate.assessment.template.status, "cad_handoff");
  assert.equal(candidate.assessment.generationEligible, false);
  assert.throws(
    () => printShop.generateCandidateModel(directory, candidate.id),
    (error) => error.status === 422 && /blocked/i.test(error.message),
  );
  const workspace = printShop.loadWorkspace(directory);
  assert.equal(workspace.artifacts.length, 0);
});

test("deterministic tray generation records finite closed components, bounds, and hash", (t) => {
  const directory = temporaryWorkspace(t);
  const candidate = printShop.analyzeCandidate(directory, validConcept());
  const result = printShop.generateCandidateModel(directory, candidate.id, { wallThicknessMm: 2.4, bottomThicknessMm: 2.4 });
  assert.equal(result.designJob.status, "mesh_checks_passed");
  assert.equal(result.designJob.gates.slicer, "pending");
  assert.equal(result.artifacts.length, 1);
  const artifact = result.artifacts[0];
  assert.deepEqual(artifact.validation.boundsMm, { x: 120, y: 80, z: 25 });
  assert.equal(artifact.validation.finiteVertices, true);
  assert.equal(artifact.validation.closedPrimitiveComponents, true);
  assert.equal(artifact.validation.aggregateBooleanUnion, "not_checked");
  assert.equal(artifact.validation.slicerStatus, "not_run");
  assert.equal(artifact.validation.prototypeStatus, "not_run");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);

  const downloaded = printShop.artifactForDownload(directory, artifact.id);
  const body = fs.readFileSync(downloaded.absolutePath);
  assert.equal(crypto.createHash("sha256").update(body).digest("hex"), artifact.sha256);
  assert.match(body.toString("utf8"), /^solid storage-tray/);
});

test("artifact modification invalidates the recorded validation hash", (t) => {
  const directory = temporaryWorkspace(t);
  const candidate = printShop.analyzeCandidate(directory, validConcept({
    concept: "measured spacer block",
    templateId: "spacer_block",
  }));
  const artifact = printShop.generateCandidateModel(directory, candidate.id).artifacts[0];
  const downloaded = printShop.artifactForDownload(directory, artifact.id);
  fs.appendFileSync(downloaded.absolutePath, "tampered");
  assert.throws(
    () => printShop.artifactForDownload(directory, artifact.id),
    (error) => error.status === 409 && /changed after validation/i.test(error.message),
  );
});

test("artifact paths reject traversal even when persisted state is corrupted", (t) => {
  const directory = temporaryWorkspace(t);
  const workspace = printShop.loadWorkspace(directory);
  workspace.artifacts.push({
    id: "print-artifact-traversal",
    name: "bad",
    kind: "stl",
    relativePath: "../outside.stl",
    sha256: "0".repeat(64),
  });
  printShop.writeWorkspace(directory, workspace);
  assert.throws(
    () => printShop.artifactForDownload(directory, "print-artifact-traversal"),
    (error) => error.status === 403 && /escaped/i.test(error.message),
  );
});

test("research records begin empty and approval-gated", (t) => {
  const directory = temporaryWorkspace(t);
  const request = printShop.recordResearchRequest(directory, {
    query: "custom desktop cable organizer",
    approvalId: "approval-test-1",
  });
  assert.equal(request.status, "pending_approval");
  assert.deepEqual(request.sources, []);
  assert.deepEqual(request.claims, []);
  const snapshot = printShop.publicSnapshot(directory, {
    approvals: [{ id: "approval-test-1", status: "pending", expiresAt: "2026-07-19T00:00:00.000Z" }],
  });
  assert.equal(snapshot.researchRequests[0].status, "pending");
  assert.equal(snapshot.truth.marketDemandMeasured, false);
});

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const request = new Readable({
      read() {
        this.push(options.body || "");
        this.push(null);
      },
    });
    request.method = options.method || "GET";
    request.url = options.url || "/";
    request.headers = {
      host: "127.0.0.1:5173",
      origin: "http://127.0.0.1:5173",
      ...(options.headers || {}),
    };
    request.socket = { remoteAddress: "127.0.0.1", encrypted: false };
    const chunks = [];
    const response = {
      statusCode: 200,
      headers: {},
      writeHead(status, headers = {}) { this.statusCode = status; this.headers = { ...this.headers, ...headers }; },
      write(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({ status: this.statusCode, headers: this.headers, body: Buffer.concat(chunks).toString("utf8") });
      },
      on() {},
      once() {},
      removeListener() {},
      emit() {},
      destroy(error) { if (error) reject(error); },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function authenticatedServer(t) {
  const originalEnvironment = { ...process.env };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-route-"));
  Object.assign(process.env, {
    APP_MODE: "local",
    HOST: "127.0.0.1",
    PORT: "5173",
    LOCAL_BACKEND_PORT: "5173",
    ARGENTUM_DATA_DIR: dataDir,
    ARGENTUM_PRINT_SHOP_DATA_DIR: dataDir,
    ARGENTUM_SKIP_PROJECT_ENV: "true",
    SESSION_SECRET: "print-shop-route-session-secret-print-shop-route-session-secret-123",
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    BRAVE_API_KEY: "print-shop-test-brave-key",
    SERP_API_KEY: "",
  });
  delete require.cache[require.resolve("../server")];
  const { handleArgentumRequest } = require("../server");
  const setupBody = new URLSearchParams({
    username: "printadmin",
    password: "secure-print-1234",
    confirmPassword: "secure-print-1234",
    savePassword: "on",
  }).toString();
  const setup = await invoke(handleArgentumRequest, {
    method: "POST",
    url: "/",
    body: setupBody,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(setup.status, 302);
  const cookie = String(setup.headers["set-cookie"] || "").split(";")[0];
  t.after(() => {
    Object.keys(process.env).forEach((key) => { if (!(key in originalEnvironment)) delete process.env[key]; });
    Object.assign(process.env, originalEnvironment);
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete require.cache[require.resolve("../server")];
  });
  return { handler: handleArgentumRequest, cookie };
}

test("authenticated Print Shop app and workflow routes are mounted same-origin", async (t) => {
  const { handler, cookie } = await authenticatedServer(t);
  const unauthenticated = await invoke(handler, { url: "/apps/print-shop-office/" });
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.location, "/login");

  for (const [url, content] of [
    ["/apps/print-shop-office/", /Product Research Lab/],
    ["/apps/print-shop-office/print-shop.css", /--amber:/],
    ["/apps/print-shop-office/print-shop.js", /\/api\/print-shop\/workspace/],
  ]) {
    const response = await invoke(handler, { url, headers: { cookie } });
    assert.equal(response.status, 200, url);
    assert.match(response.body, content, url);
  }

  const created = await invoke(handler, {
    method: "POST",
    url: "/api/print-shop/candidates",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(validConcept({ concept: "small desk label plate", templateId: "label_plate" })),
  });
  assert.equal(created.status, 201);
  const candidate = JSON.parse(created.body).candidate;
  assert.equal(candidate.assessment.generationEligible, true);

  const generated = await invoke(handler, {
    method: "POST",
    url: `/api/print-shop/candidates/${encodeURIComponent(candidate.id)}/generate`,
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(generated.status, 201);
  const artifact = JSON.parse(generated.body).artifacts[0];

  const workspace = await invoke(handler, { url: "/api/print-shop/workspace", headers: { cookie } });
  assert.equal(workspace.status, 200);
  const snapshot = JSON.parse(workspace.body);
  assert.equal(snapshot.counts.candidates, 1);
  assert.equal(snapshot.counts.stlArtifacts, 1);
  assert.equal(snapshot.truth.slicerConnected, false);
  assert.equal(snapshot.truth.printerConnected, false);

  const download = await invoke(handler, { url: artifact.downloadUrl, headers: { cookie } });
  assert.equal(download.status, 200);
  assert.match(download.headers["content-type"], /model\/stl/);
  assert.match(download.body, /^solid label-plate/);

  const research = await invoke(handler, {
    method: "POST",
    url: "/api/print-shop/research-requests",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ query: "custom desk cable organizer" }),
  });
  assert.equal(research.status, 202);
  const researchPayload = JSON.parse(research.body);
  assert.equal(researchPayload.requiresApproval, true);
  assert.equal(researchPayload.request.status, "pending_approval");
  assert.deepEqual(researchPayload.request.sources, []);
  assert.deepEqual(researchPayload.request.claims, []);
  assert.match(researchPayload.approval.exactScope, /One external research call/);
  assert.equal(researchPayload.approval.actionType, "agent101_web_search");
  assert.equal(researchPayload.request.provider, "brave");
  assert.match(researchPayload.request.queryHash, /^[a-f0-9]{64}$/);
  assert.equal(researchPayload.approval.useCount, 0);
});
