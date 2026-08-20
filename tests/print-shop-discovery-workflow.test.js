"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const printShop = require("../services/print-shop-workspace");

let approvalSequence = 0;

function temporaryWorkspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-print-discovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function discoveryPlan(overrides = {}) {
  return printShop.buildDiscoveryPlan({
    laneId: "workspace",
    geography: "United States",
    ...overrides,
  });
}

function recordRun(dataDir, overrides = {}) {
  const plan = overrides.plan || discoveryPlan();
  const run = printShop.recordDiscoveryRun(dataDir, {
    id: overrides.id,
    plan,
    provider: overrides.provider || "brave",
    approvalId: overrides.approvalId || `approval-discovery-${++approvalSequence}`,
  });
  return { plan, run };
}

function sourceResults(plan, options = {}) {
  const records = [
    {
      title: "Modular under-desk cable organizer listing",
      url: "https://market.example.com/listings/modular-under-desk-cable-organizer",
      snippet: "A current listing observation for a modular cable organizer with separately assembled pieces.",
    },
    {
      title: "Desk owners discuss loose charging cables",
      url: "https://community.example.org/desk-setup/loose-charging-cables",
      snippet: "Desk owners describe charging leads falling behind the work surface and ask for a compact holder.",
    },
    {
      title: "Single-color drawer divider listing",
      url: "https://catalog.example.net/office/single-color-drawer-divider",
      snippet: "A current product-page observation for separately printed drawer dividers used in a home office.",
    },
    {
      title: "Measured label plate use cases",
      url: "https://workshop.example.com/guides/measured-label-plates",
      snippet: "A workshop guide describes measuring a mounting area before making a small label plate.",
    },
    {
      title: "Cable tray installation discussion",
      url: "https://forum.example.edu/makers/cable-tray-installation",
      snippet: "Makers compare non-structural cable tray placement and note that desk dimensions vary.",
    },
    {
      title: "Compact desktop spacer examples",
      url: "https://library.example.io/products/compact-desktop-spacers",
      snippet: "A catalog observation shows measured non-safety-critical spacers offered in several outside sizes.",
    },
  ];
  const queryIds = plan.queries.map((query) => query.id);
  const limit = options.limit ?? records.length;
  return records.slice(0, limit).map((record, index) => ({
    queryId: queryIds[index % queryIds.length],
    ...record,
  }));
}

function completeRun(dataDir, overrides = {}) {
  const recorded = recordRun(dataDir, overrides);
  printShop.completeDiscoveryRun(dataDir, recorded.run.id, {
    provider: overrides.provider || "brave",
    results: overrides.results || sourceResults(recorded.plan),
  });
  const workspace = printShop.loadWorkspace(dataDir);
  return {
    ...recorded,
    workspace,
    persistedRun: workspace.discoveryRuns.find((run) => run.id === recorded.run.id),
  };
}

function assertNoInferredCommercialMetrics(opportunity) {
  assert.equal(opportunity.truth?.marketDemandMeasured, false);
  assert.equal(opportunity.truth?.demand ?? null, null);
  assert.equal(opportunity.truth?.sellingPrice ?? null, null);
  assert.equal(opportunity.truth?.unitEconomics ?? null, null);
  assert.equal(opportunity.truth?.profit ?? null, null);
  assert.doesNotMatch(JSON.stringify(opportunity.rankingFactors || {}).toLowerCase(), /demand|selling.?price|revenue|profit|unit.?economics/);
}

function assertOpportunityLineage(workspace, opportunity) {
  assert.ok(Array.isArray(opportunity.sourceObservationIds));
  assert.ok(opportunity.sourceObservationIds.length > 0, "a discovery opportunity must cite at least one source observation");
  const observations = new Map(workspace.sourceObservations.map((source) => [source.id, source]));
  for (const sourceId of opportunity.sourceObservationIds) {
    const source = observations.get(sourceId);
    assert.ok(source, `missing persisted source observation ${sourceId}`);
    assert.equal(source.discoveryRunId, opportunity.discoveryRunId);
    assert.match(source.url, /^https?:\/\//);
    assert.match(source.contentHash, /^[a-f0-9]{64}$/);
  }
  assert.ok(Array.isArray(opportunity.evidenceSummary));
  assert.ok(opportunity.evidenceSummary.length > 0);
}

test("discovery plans are deterministic, bounded, and do not need a supplied product idea", () => {
  const first = discoveryPlan();
  const second = discoveryPlan();

  assert.deepEqual(first, second);
  assert.deepEqual(first.brief, {
    laneId: "workspace",
    laneName: first.brief.laneName,
    geography: "United States",
    objective: first.brief.objective,
  });
  assert.ok(first.brief.laneName.length >= 3);
  assert.ok(first.brief.objective.length >= 10);
  assert.match(first.planHash, /^[a-f0-9]{64}$/);
  assert.equal(first.maximumCalls, first.queries.length);
  assert.ok(first.maximumCalls >= 1 && first.maximumCalls <= 6);
  assert.ok(first.maximumResultsPerCall >= 1 && first.maximumResultsPerCall <= 10);
  assert.equal(new Set(first.queries.map((query) => query.id)).size, first.queries.length);
  assert.equal(new Set(first.queries.map((query) => query.queryHash)).size, first.queries.length);
  first.queries.forEach((query) => {
    assert.ok(query.label.length >= 3);
    assert.ok(query.query.length >= 8);
    assert.match(query.queryHash, /^[a-f0-9]{64}$/);
  });
  assert.equal(JSON.stringify(first).includes("productIdea"), false);
});

test("recording a discovery run persists only a gated empty shell", (t) => {
  const directory = temporaryWorkspace(t);
  const { plan, run } = recordRun(directory, {
    id: "print-discovery-fixed-id",
    approvalId: "approval-discovery-fixed-id",
  });
  const workspace = printShop.loadWorkspace(directory);
  const persisted = workspace.discoveryRuns.find((item) => item.id === run.id);

  assert.equal(workspace.schemaVersion, 2);
  assert.equal(persisted.id, "print-discovery-fixed-id");
  assert.equal(persisted.status, "pending_approval");
  assert.equal(persisted.provider, "brave");
  assert.equal(persisted.approvalId, "approval-discovery-fixed-id");
  assert.equal(persisted.plan.planHash, plan.planHash);
  assert.deepEqual(persisted.sourceObservationIds, []);
  assert.deepEqual(persisted.opportunityIds, []);
  assert.deepEqual(workspace.sourceObservations, []);
  assert.deepEqual(workspace.opportunities, []);
  assert.deepEqual(workspace.candidates, []);

  const snapshot = printShop.publicSnapshot(directory);
  assert.equal(snapshot.discoveryRuns.length, 1);
  assert.deepEqual(snapshot.sourceObservations, []);
  assert.deepEqual(snapshot.opportunities, []);
  assert.equal(snapshot.truth.marketDemandMeasured, false);
});

test("completed discovery creates only source-linked research leads with unknown fit and economics", (t) => {
  const directory = temporaryWorkspace(t);
  const result = completeRun(directory);
  const { workspace, persistedRun } = result;

  assert.equal(persistedRun.status, "complete");
  assert.equal(persistedRun.sourceObservationIds.length, sourceResults(result.plan).length);
  assert.ok(persistedRun.opportunityIds.length > 0);
  assert.equal(workspace.sourceObservations.length, sourceResults(result.plan).length);
  assert.ok(workspace.opportunities.length > 0);

  for (const opportunity of workspace.opportunities) {
    assert.equal(opportunity.discoveryRunId, persistedRun.id);
    assert.equal(opportunity.stage, "discovered");
    assertOpportunityLineage(workspace, opportunity);
    assert.match(JSON.stringify(opportunity.manufacturing), /needs_measurement/);
    assert.doesNotMatch(JSON.stringify(opportunity.manufacturing), /coarse_fit|geometry_ready|production_ready/);
    assertNoInferredCommercialMetrics(opportunity);
  }

  const snapshot = printShop.publicSnapshot(directory);
  assert.equal(snapshot.truth.externalMarketEvidenceCollected, true);
  assert.equal(snapshot.truth.marketDemandMeasured, false);
  assert.equal(snapshot.counts.discoveryRuns, 1);
  assert.equal(snapshot.counts.opportunities, workspace.opportunities.length);
});

test("partial evidence is labeled partial and still preserves exact source lineage", (t) => {
  const directory = temporaryWorkspace(t);
  const recorded = recordRun(directory);
  const results = sourceResults(recorded.plan, { limit: 2 }).map((result) => ({
    ...result,
    queryId: recorded.plan.queries[0].id,
  }));

  printShop.completeDiscoveryRun(directory, recorded.run.id, { provider: "brave", results });
  const workspace = printShop.loadWorkspace(directory);
  const run = workspace.discoveryRuns.find((item) => item.id === recorded.run.id);

  assert.equal(run.status, recorded.plan.queries.length > 1 ? "partial" : "complete");
  assert.equal(run.sourceObservationIds.length, 2);
  run.opportunityIds.forEach((opportunityId) => {
    const opportunity = workspace.opportunities.find((item) => item.id === opportunityId);
    assertOpportunityLineage(workspace, opportunity);
    assertNoInferredCommercialMetrics(opportunity);
  });
});

test("out-of-plan and non-HTTP evidence cannot create discovery opportunities", (t) => {
  const directory = temporaryWorkspace(t);
  const unknownQuery = recordRun(directory, { id: "print-discovery-unknown-query" });
  assert.throws(
    () => printShop.completeDiscoveryRun(directory, unknownQuery.run.id, {
      provider: "brave",
      results: [{
        queryId: "query-not-in-approved-plan",
        title: "Unscoped result",
        url: "https://outside.example.com/unscoped",
        snippet: "This result was not returned for a query in the approved discovery plan.",
      }],
    }),
    (error) => [400, 403, 409, 502].includes(error.status) && /query|scope|result|source/i.test(error.message),
  );

  const invalidSource = recordRun(directory, { id: "print-discovery-invalid-source" });
  assert.throws(
    () => printShop.completeDiscoveryRun(directory, invalidSource.run.id, {
      provider: "brave",
      results: [{
        queryId: invalidSource.plan.queries[0].id,
        title: "Unsafe local record",
        url: "file:///tmp/not-external-evidence.html",
        snippet: "A local file must not become external product evidence.",
      }],
    }),
    (error) => [400, 422, 502].includes(error.status) && /HTTP|source|result|usable/i.test(error.message),
  );

  let workspace = printShop.loadWorkspace(directory);
  assert.deepEqual(workspace.sourceObservations, []);
  assert.deepEqual(workspace.opportunities, []);

  const failed = printShop.failDiscoveryRun(
    directory,
    invalidSource.run.id,
    new Error("Approved provider returned no usable source observations."),
    { callsCompleted: 1 },
  );
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /no usable source observations/i);
  workspace = printShop.loadWorkspace(directory);
  assert.equal(workspace.discoveryRuns.find((run) => run.id === invalidSource.run.id).status, "failed");
  assert.deepEqual(workspace.opportunities, []);
});

test("opportunity lifecycle actions are persisted and reject unknown actions", (t) => {
  const directory = temporaryWorkspace(t);
  let workspace = completeRun(directory).workspace;
  const opportunityId = workspace.opportunities[0].id;

  let updated = printShop.updateOpportunity(directory, opportunityId, { action: "shortlist" });
  assert.equal(updated.stage, "shortlisted");
  assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  updated = printShop.updateOpportunity(directory, opportunityId, { action: "dismiss" });
  assert.equal(updated.stage, "dismissed");

  updated = printShop.updateOpportunity(directory, opportunityId, { action: "restore" });
  assert.equal(updated.stage, "discovered");

  assert.throws(
    () => printShop.updateOpportunity(directory, opportunityId, { action: "publish" }),
    (error) => error.status === 400 && /action/i.test(error.message),
  );
  assert.throws(
    () => printShop.updateOpportunity(directory, "missing-opportunity", { action: "shortlist" }),
    (error) => error.status === 404,
  );

  workspace = printShop.loadWorkspace(directory);
  assert.equal(workspace.opportunities.find((item) => item.id === opportunityId).stage, "discovered");
});

test("promotion requires a terminal evidence run and is source-linked and idempotent", (t) => {
  const directory = temporaryWorkspace(t);
  let completed = completeRun(directory);
  const opportunity = completed.workspace.opportunities[0];

  const invalidWorkspace = printShop.loadWorkspace(directory);
  invalidWorkspace.discoveryRuns.find((run) => run.id === opportunity.discoveryRunId).status = "pending_approval";
  printShop.writeWorkspace(directory, invalidWorkspace);
  assert.throws(
    () => printShop.promoteOpportunity(directory, opportunity.id),
    (error) => [409, 422].includes(error.status) && /complete|partial|research|run/i.test(error.message),
  );
  assert.equal(printShop.loadWorkspace(directory).candidates.length, 0);

  const restoredWorkspace = printShop.loadWorkspace(directory);
  restoredWorkspace.discoveryRuns.find((run) => run.id === opportunity.discoveryRunId).status = "complete";
  printShop.writeWorkspace(directory, restoredWorkspace);

  const first = printShop.promoteOpportunity(directory, opportunity.id);
  let workspace = printShop.loadWorkspace(directory);
  const candidate = workspace.candidates.find((item) => item.id === first.candidate.id);
  const promotedOpportunity = workspace.opportunities.find((item) => item.id === opportunity.id);

  assert.equal(promotedOpportunity.stage, "promoted");
  assert.equal(promotedOpportunity.promotedCandidateId, candidate.id);
  assert.equal(candidate.evidence.operatorInput, false);
  assert.equal(candidate.evidence.discoveryRunId, opportunity.discoveryRunId);
  assert.equal(candidate.evidence.opportunityId, opportunity.id);
  assert.deepEqual(
    [...candidate.evidence.externalSources].sort(),
    [...opportunity.sourceObservationIds].sort(),
  );
  assert.deepEqual(candidate.requirements.dimensionsMm, { x: null, y: null, z: null });
  assert.equal(candidate.requirements.material, null);
  assert.equal(candidate.assessment.printerFit.status, "needs_measurement");
  assert.equal(candidate.assessment.generationEligible, false);
  assert.ok(candidate.assessment.generationBlockers.includes("measurements"));
  assert.ok(candidate.assessment.generationBlockers.includes("material"));
  assert.equal(candidate.assessment.marketEvidence.demand, null);
  assert.equal(candidate.assessment.marketEvidence.sellingPrice, null);
  assert.equal(candidate.assessment.economics.filamentGrams, null);
  assert.equal(candidate.assessment.economics.machineHours, null);
  assert.equal(candidate.assessment.economics.unitCost, null);

  const firstCandidateCount = workspace.candidates.length;
  const second = printShop.promoteOpportunity(directory, opportunity.id);
  workspace = printShop.loadWorkspace(directory);
  assert.equal(second.candidate.id, first.candidate.id);
  assert.equal(workspace.candidates.length, firstCandidateCount);
});

test("completed discovery, shortlist, and promotion survive a clean reload with stable evidence hashes", (t) => {
  const directory = temporaryWorkspace(t);
  const completed = completeRun(directory);
  const opportunityId = completed.workspace.opportunities[0].id;
  printShop.updateOpportunity(directory, opportunityId, { action: "shortlist" });
  const promoted = printShop.promoteOpportunity(directory, opportunityId);

  const before = printShop.loadWorkspace(directory);
  const sourceHashes = before.sourceObservations.map((source) => [source.id, source.contentHash]);
  const after = printShop.loadWorkspace(directory);
  const snapshot = printShop.publicSnapshot(directory);

  assert.deepEqual(after.sourceObservations.map((source) => [source.id, source.contentHash]), sourceHashes);
  assert.ok(after.discoveryRuns.some((run) => run.id === completed.run.id));
  assert.ok(after.opportunities.some((opportunity) => opportunity.id === opportunityId));
  assert.ok(after.candidates.some((candidate) => candidate.id === promoted.candidate.id));
  assert.ok(snapshot.opportunities.some((opportunity) => opportunity.id === opportunityId));
  assert.ok(snapshot.candidates.some((candidate) => candidate.id === promoted.candidate.id));
  assert.equal(snapshot.truth.marketDemandMeasured, false);
});
