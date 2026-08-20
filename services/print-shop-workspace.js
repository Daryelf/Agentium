"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 2;
const WORKSPACE_FOLDER = "print-shop";
const STATE_FILE = "workspace.json";
const ARTIFACT_FOLDER = "artifacts";
const MAX_DISCOVERY_RUNS = 24;
const MAX_SOURCE_OBSERVATIONS = 480;
const MAX_OPPORTUNITIES = 120;

const A1_MINI_PROFILE = Object.freeze({
  id: "printer-owner-a1-mini",
  manufacturer: "Bambu Lab",
  model: "A1 mini",
  factorySpec: {
    buildVolumeMm: { x: 180, y: 180, z: 180 },
    factoryNozzleMm: 0.4,
    hotendMaxC: 300,
    bedMaxC: 80,
    filamentDiameterMm: 1.75,
    preferredMaterials: ["PLA", "PETG", "TPU"],
    specialPurposeMaterials: ["PVA"],
    notRecommendedMaterials: ["ABS", "ASA", "PC", "PA", "PET", "CF", "GF"],
    source: {
      publisher: "Bambu Lab",
      title: "A1 mini technical specifications",
      url: "https://us.store.bambulab.com/products/a1-mini",
      observedAt: "2026-07-18T00:00:00.000Z",
    },
  },
  operatingProfile: {
    installedNozzleMm: 0.4,
    amsLite: false,
    maxSimultaneousColors: 1,
    configurationSource: "operator_provided",
  },
  engineeringPolicy: {
    edgeAllowanceMm: 4,
    designEnvelopeMm: { x: 176, y: 176, z: 176 },
    note: "The 176 mm design envelope is an Argentum planning allowance, not a Bambu Lab specification. Exact fit still requires a successful Bambu Studio slice.",
  },
});

const TEMPLATE_CATALOG = Object.freeze([
  {
    id: "storage_tray",
    name: "Storage tray",
    description: "An open rectangular tray generated from measured outside dimensions.",
    generatedGeometry: true,
    minimumDimensionsMm: { x: 20, y: 20, z: 8 },
  },
  {
    id: "label_plate",
    name: "Label plate",
    description: "A solid plate for a label, placard, or later text/CAD operation.",
    generatedGeometry: true,
    minimumDimensionsMm: { x: 10, y: 10, z: 1.2 },
  },
  {
    id: "spacer_block",
    name: "Spacer or riser",
    description: "A measured solid block for fit checks, shims, and non-safety-critical spacing.",
    generatedGeometry: true,
    minimumDimensionsMm: { x: 3, y: 3, z: 1 },
  },
  {
    id: "divider_set",
    name: "Divider set",
    description: "One or more measured divider plates printed as separate single-color parts.",
    generatedGeometry: true,
    minimumDimensionsMm: { x: 10, y: 1.2, z: 10 },
  },
  {
    id: "custom",
    name: "Custom product",
    description: "A custom CAD handoff. Argentum will not fabricate a dummy STL for unsupported geometry.",
    generatedGeometry: false,
    minimumDimensionsMm: null,
  },
]);

const DISCOVERY_LANES = Object.freeze([
  {
    id: "workspace",
    name: "Workspace essentials",
    objective: "Find recurring desk, charging, cable, and small-space organization problems that may support a compact physical product.",
    queries: [
      { id: "workspace-friction", label: "Recurring friction", query: "desk setup cable charging organization recurring problems complaints" },
      { id: "workspace-fit", label: "Fit gaps", query: "small desk organizer accessory does not fit custom size problem" },
      { id: "workspace-routines", label: "Daily routines", query: "home office daily routine clutter holder stand storage problem" },
    ],
  },
  {
    id: "home",
    name: "Home organization",
    objective: "Find small household organization and fit problems where measurements and customization may matter.",
    queries: [
      { id: "home-drawers", label: "Drawer fit", query: "drawer cabinet organizer custom fit common problem small spaces" },
      { id: "home-storage", label: "Storage friction", query: "household small item storage holder recurring complaint" },
      { id: "home-fixtures", label: "Missing fixtures", query: "small household plastic holder clip cap replacement hard to find" },
    ],
  },
  {
    id: "maker",
    name: "Maker workbench",
    objective: "Find organization and handling problems around tools, craft supplies, electronics benches, and small parts.",
    queries: [
      { id: "maker-tools", label: "Tool access", query: "workbench tool holder organization recurring problem" },
      { id: "maker-parts", label: "Small parts", query: "maker electronics craft small parts sorting storage complaint" },
      { id: "maker-fixtures", label: "Bench fixtures", query: "custom jig guide holder bench accessory hard to find" },
    ],
  },
  {
    id: "small_business",
    name: "Small-business operations",
    objective: "Find compact counter, packaging, labeling, and display problems for independent sellers and service desks.",
    queries: [
      { id: "business-counter", label: "Counter workflow", query: "small retail counter organization holder display problem" },
      { id: "business-pack", label: "Packing station", query: "small business packaging station organization recurring problem" },
      { id: "business-display", label: "Portable display", query: "craft market vendor display label sign holder problem" },
    ],
  },
  {
    id: "replacement",
    name: "Replacement and repair",
    objective: "Find unavailable or poor-fit small plastic hardware that could become a measured, non-safety-critical replacement project.",
    queries: [
      { id: "replacement-clips", label: "Clips and latches", query: "small plastic replacement clip latch unavailable broken" },
      { id: "replacement-knobs", label: "Knobs and caps", query: "replacement plastic knob cap bracket hard to find" },
      { id: "replacement-fit", label: "Model-specific fit", query: "discontinued small plastic part exact fit replacement problem" },
    ],
  },
]);

const OPPORTUNITY_ARCHETYPES = Object.freeze([
  {
    id: "cable_routing",
    title: "Modular cable routing kit",
    problem: "Keep frequently used charging and data cables separated, reachable, and matched to a specific desk edge or surface.",
    targetBuyer: "Desk owners with a measured cable and furniture setup",
    templateId: "custom",
    terms: ["cable", "cord", "charger", "charging", "wire"],
  },
  {
    id: "drawer_dividers",
    title: "Custom-fit drawer divider system",
    problem: "Use measured dividers to remove wasted drawer space and keep categories from mixing.",
    targetBuyer: "People with drawers that do not fit standard organizer sizes",
    templateId: "divider_set",
    terms: ["drawer", "divider", "partition"],
  },
  {
    id: "small_parts",
    title: "Small-parts sorting tray set",
    problem: "Separate and retrieve small hardware, craft supplies, or electronics parts during repeated work.",
    targetBuyer: "Makers, repairers, and crafters handling small components",
    templateId: "storage_tray",
    terms: ["small parts", "screws", "hardware", "beads", "components", "sorting", "craft supplies"],
  },
  {
    id: "label_holders",
    title: "Measured bin and shelf label holders",
    problem: "Keep labels visible and replaceable on a specific shelf, bin, drawer, or retail fixture.",
    targetBuyer: "Homes and small businesses with nonstandard bins or shelving",
    templateId: "label_plate",
    terms: ["label", "price tag", "shelf tag", "sign holder", "bin label"],
  },
  {
    id: "tool_holders",
    title: "Tool-specific bench holder",
    problem: "Give one repeatedly used tool a measured, stable storage location at the point of work.",
    targetBuyer: "Workbench owners whose tools do not fit generic racks",
    templateId: "custom",
    terms: ["tool holder", "workbench", "pegboard", "wrench", "screwdriver", "drill bit"],
  },
  {
    id: "replacement_hardware",
    title: "Measured replacement hardware",
    problem: "Recreate a small, unavailable plastic clip, cap, knob, latch, or bracket from exact measurements and use constraints.",
    targetBuyer: "Owners repairing non-safety-critical household or workshop items",
    templateId: "custom",
    terms: ["replacement", "broken", "discontinued", "clip", "cap", "knob", "latch", "bracket"],
  },
  {
    id: "device_stands",
    title: "Device-specific stand or dock",
    problem: "Hold a specific device and cable at a measured viewing or storage angle without relying on a one-size-fits-all stand.",
    targetBuyer: "Owners of phones, tablets, controllers, readers, or small electronics",
    templateId: "custom",
    terms: ["phone stand", "tablet stand", "controller stand", "headphone stand", "dock", "device holder"],
  },
  {
    id: "counter_display",
    title: "Modular counter display kit",
    problem: "Organize a small counter or market display around exact products, signs, cards, or payment hardware.",
    targetBuyer: "Independent retailers, market vendors, and service counters",
    templateId: "custom",
    terms: ["retail counter", "craft market", "vendor display", "business card", "qr sign", "counter display"],
  },
]);

const SAFETY_RULES = Object.freeze([
  { id: "children", pattern: /\b(child|children|kid|kids|baby|toddler|toy)\b/i, label: "Children's-product review" },
  { id: "food", pattern: /\b(food|drink|cup|bottle|utensil|bowl|mouthpiece)\b/i, label: "Food-contact review" },
  { id: "medical", pattern: /\b(medical|health|prosthetic|orthotic|dental|implant)\b/i, label: "Medical-use review" },
  { id: "electrical", pattern: /\b(mains|outlet|electrical|high voltage|battery enclosure)\b/i, label: "Electrical-safety review" },
  { id: "pressure", pattern: /\b(pressure|pressurized|compressed gas|air tank)\b/i, label: "Pressure-containing review" },
  { id: "vehicle", pattern: /\b(brake|steering|seat belt|vehicle structural|motorcycle structural)\b/i, label: "Vehicle-safety review" },
  { id: "heat", pattern: /\b(flame|stove|oven|exhaust|engine bay|high heat)\b/i, label: "Heat/flame review" },
  { id: "overhead", pattern: /\b(overhead load|ceiling mount|suspended load|climbing|life safety)\b/i, label: "Load-bearing safety review" },
]);

const IP_PATTERN = /\b(disney|marvel|pokemon|pok[eé]mon|nintendo|nike|adidas|star wars|licensed character|brand logo|trademark)\b/i;

function workspaceRoot(dataDir) {
  return path.join(path.resolve(dataDir), WORKSPACE_FOLDER);
}

function statePath(dataDir) {
  return path.join(workspaceRoot(dataDir), STATE_FILE);
}

function artifactRoot(dataDir) {
  return path.join(workspaceRoot(dataDir), ARTIFACT_FOLDER);
}

function now() {
  return new Date().toISOString();
}

function serviceError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, max = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultWorkspace() {
  const createdAt = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    printerProfile: clone(A1_MINI_PROFILE),
    settings: {
      currency: "USD",
      jointCalibration: null,
      hourlyMachineRate: null,
      failureAllowancePercent: null,
      packagingCost: null,
    },
    candidates: [],
    designJobs: [],
    artifacts: [],
    researchRequests: [],
    discoveryRuns: [],
    sourceObservations: [],
    opportunities: [],
    prototypeEvidence: [],
    activity: [
      {
        id: `print-activity-${crypto.randomUUID()}`,
        type: "workspace_created",
        title: "Product Research Lab initialized",
        detail: "Printer constraints are loaded. No market demand, slicing, cost, or prototype claims have been measured yet.",
        createdAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

function ensureWorkspaceDirectories(dataDir) {
  fs.mkdirSync(artifactRoot(dataDir), { recursive: true });
}

function normalizeWorkspace(raw = {}) {
  const fresh = defaultWorkspace();
  return {
    ...fresh,
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    printerProfile: {
      ...clone(A1_MINI_PROFILE),
      ...(raw.printerProfile || {}),
      factorySpec: {
        ...clone(A1_MINI_PROFILE.factorySpec),
        ...(raw.printerProfile?.factorySpec || {}),
        buildVolumeMm: clone(A1_MINI_PROFILE.factorySpec.buildVolumeMm),
        source: clone(A1_MINI_PROFILE.factorySpec.source),
      },
      operatingProfile: {
        ...clone(A1_MINI_PROFILE.operatingProfile),
        ...(raw.printerProfile?.operatingProfile || {}),
      },
      engineeringPolicy: clone(A1_MINI_PROFILE.engineeringPolicy),
    },
    settings: { ...fresh.settings, ...(raw.settings || {}) },
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    designJobs: Array.isArray(raw.designJobs) ? raw.designJobs : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    researchRequests: Array.isArray(raw.researchRequests) ? raw.researchRequests : [],
    discoveryRuns: Array.isArray(raw.discoveryRuns) ? raw.discoveryRuns : [],
    sourceObservations: Array.isArray(raw.sourceObservations) ? raw.sourceObservations : [],
    opportunities: Array.isArray(raw.opportunities) ? raw.opportunities : [],
    prototypeEvidence: Array.isArray(raw.prototypeEvidence) ? raw.prototypeEvidence : [],
    activity: Array.isArray(raw.activity) ? raw.activity : fresh.activity,
    createdAt: raw.createdAt || fresh.createdAt,
    updatedAt: raw.updatedAt || fresh.updatedAt,
  };
}

function writeWorkspace(dataDir, workspace) {
  ensureWorkspaceDirectories(dataDir);
  const target = statePath(dataDir);
  const next = normalizeWorkspace({ ...workspace, updatedAt: now() });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  return next;
}

function loadWorkspace(dataDir) {
  ensureWorkspaceDirectories(dataDir);
  const target = statePath(dataDir);
  if (!fs.existsSync(target)) return writeWorkspace(dataDir, defaultWorkspace());
  try {
    return normalizeWorkspace(JSON.parse(fs.readFileSync(target, "utf8")));
  } catch (error) {
    throw serviceError(`Print Shop workspace could not be read: ${error.message}`, 500);
  }
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function normalizeDimensions(input = {}) {
  const dimensions = {
    x: numberOrNull(input.x ?? input.width),
    y: numberOrNull(input.y ?? input.depth),
    z: numberOrNull(input.z ?? input.height),
  };
  const supplied = Object.values(input).some((value) => value !== "" && value !== null && value !== undefined);
  if (supplied && Object.values(dimensions).some((value) => value === null)) {
    throw serviceError("Enter positive width, depth, and height measurements in millimeters.");
  }
  if (Object.values(dimensions).some((value) => value !== null && value > 2000)) {
    throw serviceError("A single entered dimension cannot exceed 2000 mm.");
  }
  return dimensions;
}

function hasDimensions(dimensions) {
  return [dimensions?.x, dimensions?.y, dimensions?.z].every((value) => Number.isFinite(value) && value > 0);
}

function templateById(templateId) {
  return TEMPLATE_CATALOG.find((template) => template.id === templateId) || TEMPLATE_CATALOG.find((template) => template.id === "custom");
}

function inferTemplate(concept, requested = "auto") {
  if (requested && requested !== "auto" && TEMPLATE_CATALOG.some((template) => template.id === requested)) return requested;
  const text = String(concept || "").toLowerCase();
  if (/\b(tray|organizer|catchall|catch-all|small bin)\b/.test(text)) return "storage_tray";
  if (/\b(label|placard|nameplate|sign plate)\b/.test(text)) return "label_plate";
  if (/\b(spacer|shim|riser|solid block)\b/.test(text)) return "spacer_block";
  if (/\b(divider|partition)\b/.test(text)) return "divider_set";
  return "custom";
}

function materialAssessment(materialInput) {
  const material = cleanText(materialInput, 32).toUpperCase();
  if (!material) {
    return { material: null, status: "needs_selection", summary: "Choose a material before generating geometry." };
  }
  if (A1_MINI_PROFILE.factorySpec.preferredMaterials.includes(material)) {
    return { material, status: "preferred", summary: `${material} is in Bambu Lab's preferred A1 Mini material group.` };
  }
  if (A1_MINI_PROFILE.factorySpec.specialPurposeMaterials.includes(material)) {
    return { material, status: "special_purpose", summary: `${material} is a special-purpose support material, not a default product body material.` };
  }
  if (A1_MINI_PROFILE.factorySpec.notRecommendedMaterials.includes(material) || /CARBON|GLASS|CF|GF/.test(material)) {
    return { material, status: "not_recommended", summary: `${material} is not recommended for the A1 Mini by Bambu Lab.` };
  }
  return { material, status: "unverified", summary: `${material} has not been verified against this saved printer profile.` };
}

function colorAssessment(colorCountInput, separateColorParts) {
  const colorCount = Math.max(1, Math.min(8, Math.round(Number(colorCountInput || 1))));
  if (colorCount <= A1_MINI_PROFILE.operatingProfile.maxSimultaneousColors) {
    return {
      requiredColors: colorCount,
      status: "fits_current_process",
      summary: "The current single-color process can make this without a multicolor system.",
      separatePartsRequired: false,
    };
  }
  if (separateColorParts) {
    return {
      requiredColors: colorCount,
      status: "sequential_parts_required",
      summary: `${colorCount} colors require separately printed single-color parts and an assembly plan on this setup.`,
      separatePartsRequired: true,
    };
  }
  return {
    requiredColors: colorCount,
    status: "blocked_by_current_process",
    summary: `${colorCount} simultaneous colors exceed the current one-color setup. Confirm separable color parts or change the hardware profile.`,
    separatePartsRequired: false,
  };
}

function permutations(dimensions) {
  const axes = [
    ["x", dimensions.x],
    ["y", dimensions.y],
    ["z", dimensions.z],
  ];
  return [
    [axes[0], axes[1], axes[2]],
    [axes[0], axes[2], axes[1]],
    [axes[1], axes[0], axes[2]],
    [axes[1], axes[2], axes[0]],
    [axes[2], axes[0], axes[1]],
    [axes[2], axes[1], axes[0]],
  ].map((order) => ({
    orientation: `${order[0][0].toUpperCase()}→X · ${order[1][0].toUpperCase()}→Y · ${order[2][0].toUpperCase()}→Z`,
    boundsMm: { x: order[0][1], y: order[1][1], z: order[2][1] },
  }));
}

function fitAssessment(dimensions) {
  if (!hasDimensions(dimensions)) {
    return {
      status: "needs_measurement",
      summary: "Width, depth, and height are required before printer fit can be checked.",
      orientation: null,
      splitPlan: null,
    };
  }
  const envelope = A1_MINI_PROFILE.engineeringPolicy.designEnvelopeMm;
  const fitting = permutations(dimensions).find(({ boundsMm }) => (
    boundsMm.x <= envelope.x && boundsMm.y <= envelope.y && boundsMm.z <= envelope.z
  ));
  if (fitting) {
    return {
      status: "coarse_fit",
      summary: "The measured box fits the 176 mm planning envelope in at least one orientation. Bambu Studio slicing is still required.",
      orientation: fitting,
      splitPlan: null,
    };
  }

  const grid = {
    x: Math.ceil(dimensions.x / envelope.x),
    y: Math.ceil(dimensions.y / envelope.y),
    z: Math.ceil(dimensions.z / envelope.z),
  };
  const partCount = grid.x * grid.y * grid.z;
  return {
    status: partCount <= 12 ? "split_required" : "split_complex",
    summary: partCount <= 12
      ? `The measured box needs a proposed ${partCount}-part split before it can fit the planning envelope.`
      : `A simple envelope split would create ${partCount} parts, so the product needs a deliberate CAD redesign.`,
    orientation: null,
    splitPlan: {
      status: "proposed_not_validated",
      partCount,
      grid,
      maximumPartBoundsMm: {
        x: Math.ceil((dimensions.x / grid.x) * 100) / 100,
        y: Math.ceil((dimensions.y / grid.y) * 100) / 100,
        z: Math.ceil((dimensions.z / grid.z) * 100) / 100,
      },
      jointPolicy: "Place seams outside the primary load path and add anti-rotation registration only after a same-profile clearance coupon is measured.",
      assemblyStatus: "connector_geometry_not_generated",
      slicerStatus: "not_run",
    },
  };
}

function safetyAssessment(concept, useCase) {
  const text = `${concept || ""} ${useCase || ""}`;
  const reviews = SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => ({ id: rule.id, label: rule.label }));
  const intellectualProperty = IP_PATTERN.test(text)
    ? { status: "review_required", summary: "A brand, character, or trademark signal was detected. Commercial rights must be verified." }
    : { status: "unknown", summary: "No IP claim was made. Commercial rights still remain unverified until source/design ownership is recorded." };
  return {
    status: reviews.length ? "review_required" : "standard_review",
    reviews,
    intellectualProperty,
  };
}

function requirementCoverage(requirements, safety) {
  const checks = [
    Boolean(requirements.concept),
    hasDimensions(requirements.dimensionsMm),
    Boolean(requirements.material),
    Boolean(requirements.useCase),
    Boolean(requirements.environment),
    Number.isFinite(requirements.requiredColors),
    safety.intellectualProperty.status !== "review_required",
  ];
  const complete = checks.filter(Boolean).length;
  return {
    known: complete,
    total: checks.length,
    percent: Math.round((complete / checks.length) * 100),
    label: `${complete}/${checks.length} requirement groups recorded`,
  };
}

function templateAssessment(template, dimensions) {
  if (!template.generatedGeometry) {
    return { status: "cad_handoff", summary: "This shape is not in the deterministic template library. No placeholder STL will be created." };
  }
  if (!hasDimensions(dimensions)) {
    return { status: "needs_measurement", summary: "The template needs all three outside dimensions." };
  }
  const minimum = template.minimumDimensionsMm;
  const tooSmall = Object.keys(minimum).find((axis) => dimensions[axis] < minimum[axis]);
  if (tooSmall) {
    return { status: "below_template_minimum", summary: `${tooSmall.toUpperCase()} must be at least ${minimum[tooSmall]} mm for this template.` };
  }
  return { status: "supported", summary: `${template.name} is supported by the deterministic local geometry generator.` };
}

function analyzeRequirements(payload = {}) {
  const concept = cleanText(payload.concept || payload.query || payload.title, 240);
  if (concept.length < 3) throw serviceError("Describe the product you want to evaluate.");
  const dimensionsMm = normalizeDimensions(payload.dimensionsMm || {
    x: payload.widthMm,
    y: payload.depthMm,
    z: payload.heightMm,
  });
  const template = templateById(inferTemplate(concept, payload.templateId));
  const material = materialAssessment(payload.material);
  const color = colorAssessment(payload.colorCount, Boolean(payload.separateColorParts));
  const fit = fitAssessment(dimensionsMm);
  const safety = safetyAssessment(concept, payload.useCase);
  const templateCheck = templateAssessment(template, dimensionsMm);
  const requirements = {
    concept,
    templateId: template.id,
    templateName: template.name,
    dimensionsMm,
    material: material.material,
    requiredColors: color.requiredColors,
    separateColorParts: Boolean(payload.separateColorParts),
    useCase: cleanText(payload.useCase, 400),
    environment: cleanText(payload.environment, 240),
    loadNotes: cleanText(payload.loadNotes, 240),
    quantity: Math.max(1, Math.min(24, Math.round(Number(payload.quantity || 1)))),
  };
  const blockers = [];
  if (!hasDimensions(dimensionsMm)) blockers.push("measurements");
  if (["not_recommended", "unverified", "special_purpose", "needs_selection"].includes(material.status)) blockers.push("material");
  if (color.status === "blocked_by_current_process") blockers.push("color_process");
  if (["split_required", "split_complex"].includes(fit.status)) blockers.push("split_design");
  if (safety.status === "review_required") blockers.push("safety_review");
  if (safety.intellectualProperty.status === "review_required") blockers.push("rights_review");
  if (templateCheck.status !== "supported") blockers.push("template_support");
  if (color.status === "sequential_parts_required" && template.id !== "divider_set") blockers.push("color_part_design");
  const generationEligible = blockers.length === 0;
  const status = safety.status === "review_required"
    ? "review_required"
    : fit.status === "needs_measurement"
      ? "needs_measurement"
      : ["split_required", "split_complex"].includes(fit.status)
        ? "split_plan_proposed"
        : templateCheck.status === "cad_handoff"
          ? "cad_handoff"
          : generationEligible
            ? "geometry_ready"
            : "requirements_incomplete";
  const coverage = requirementCoverage(requirements, safety);
  return {
    requirements,
    assessment: {
      status,
      headline: generationEligible
        ? "Measured concept can enter deterministic geometry generation."
        : fit.status === "split_required"
          ? "This concept can fit only after a deliberate multipart design."
          : "More evidence or design work is required before geometry generation.",
      printerFit: fit,
      material,
      color,
      safety,
      template: templateCheck,
      requirementsCoverage: coverage,
      generationEligible,
      generationBlockers: [...new Set(blockers)],
      marketEvidence: {
        status: "not_researched",
        demand: null,
        sellingPrice: null,
        competitorCount: null,
        commercialRights: null,
        note: "No external market evidence has been collected for this concept.",
      },
      economics: {
        status: "waiting_for_slice",
        filamentGrams: null,
        machineHours: null,
        unitCost: null,
        note: "Material use, print time, and cost must come from an exact slicer result and configured rates.",
      },
      nextActions: [
        !hasDimensions(dimensionsMm) ? "Measure the product's outside width, depth, and height." : null,
        color.status === "sequential_parts_required" ? "Define each color as a separate part and choose an assembly seam." : null,
        fit.splitPlan ? "Choose low-stress split planes, then print and measure a connector-clearance coupon." : null,
        material.status !== "preferred" ? "Choose a verified body material for the saved A1 Mini profile." : null,
        safety.status === "review_required" ? "Complete the identified safety/compliance review before prototype use." : null,
        safety.intellectualProperty.status === "review_required" ? "Record design ownership or a commercial license before selling." : null,
        templateCheck.status === "cad_handoff" ? "Create a measured CAD specification; automatic STL generation is intentionally blocked." : null,
        generationEligible ? "Generate the versioned STL, then run the exact A1 Mini slicer profile." : null,
      ].filter(Boolean),
    },
  };
}

function addActivity(workspace, type, title, detail) {
  workspace.activity.unshift({
    id: `print-activity-${crypto.randomUUID()}`,
    type,
    title,
    detail,
    createdAt: now(),
  });
  workspace.activity = workspace.activity.slice(0, 100);
}

function analyzeCandidate(dataDir, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const analyzed = analyzeRequirements(payload);
  const timestamp = now();
  const candidate = {
    id: `print-candidate-${crypto.randomUUID()}`,
    title: cleanText(payload.title || analyzed.requirements.concept, 100),
    query: analyzed.requirements.concept,
    status: analyzed.assessment.status,
    stage: "Concept",
    requirements: analyzed.requirements,
    assessment: analyzed.assessment,
    evidence: {
      operatorInput: true,
      externalSources: [],
      generatedClaims: [],
    },
    artifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  workspace.candidates.unshift(candidate);
  workspace.candidates = workspace.candidates.slice(0, 100);
  addActivity(workspace, "candidate_analyzed", "Product fit analyzed", `${candidate.title}: ${candidate.assessment.headline}`);
  writeWorkspace(dataDir, workspace);
  return candidate;
}

function updateCandidate(dataDir, candidateId, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const candidate = workspace.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw serviceError("Print Shop candidate not found.", 404);
  if ((candidate.artifactIds || []).length) {
    throw serviceError("This design already has versioned artifacts. Create a new product record before changing its measured requirements.", 409);
  }
  const analyzed = analyzeRequirements(payload);
  if (candidate.evidence?.origin === "discovery_run") {
    const sourceCount = Array.isArray(candidate.evidence.externalSources) ? candidate.evidence.externalSources.length : 0;
    analyzed.assessment.marketEvidence = {
      ...analyzed.assessment.marketEvidence,
      status: "source_observations_collected",
      note: `${sourceCount} cited search observation${sourceCount === 1 ? "" : "s"} support investigation only; demand, price, competition, and commercial rights remain unmeasured.`,
    };
  }
  candidate.title = cleanText(payload.title || analyzed.requirements.concept, 100);
  candidate.query = analyzed.requirements.concept;
  candidate.status = analyzed.assessment.status;
  candidate.stage = analyzed.assessment.generationEligible ? "Geometry ready" : "Requirements";
  candidate.requirements = analyzed.requirements;
  candidate.assessment = analyzed.assessment;
  candidate.updatedAt = now();
  addActivity(workspace, "candidate_updated", "Measured design requirements updated", `${candidate.title}: ${candidate.assessment.headline}`);
  writeWorkspace(dataDir, workspace);
  return candidate;
}

function triangleNormal(triangle) {
  const [a, b, c] = triangle;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const normal = [
    (uy * vz) - (uz * vy),
    (uz * vx) - (ux * vz),
    (ux * vy) - (uy * vx),
  ];
  const length = Math.hypot(...normal);
  return length > 0 ? normal.map((value) => value / length) : [0, 0, 0];
}

function boxTriangles(size, origin = [0, 0, 0]) {
  const [x, y, z] = size;
  const [ox, oy, oz] = origin;
  if (![x, y, z].every((value) => Number.isFinite(value) && value > 0)) throw serviceError("Generated box dimensions must be positive.");
  const p = [
    [ox, oy, oz], [ox + x, oy, oz], [ox + x, oy + y, oz], [ox, oy + y, oz],
    [ox, oy, oz + z], [ox + x, oy, oz + z], [ox + x, oy + y, oz + z], [ox, oy + y, oz + z],
  ];
  return [
    [p[0], p[2], p[1]], [p[0], p[3], p[2]],
    [p[4], p[5], p[6]], [p[4], p[6], p[7]],
    [p[0], p[1], p[5]], [p[0], p[5], p[4]],
    [p[1], p[2], p[6]], [p[1], p[6], p[5]],
    [p[2], p[3], p[7]], [p[2], p[7], p[6]],
    [p[3], p[0], p[4]], [p[3], p[4], p[7]],
  ];
}

function vertexKey(vertex) {
  return vertex.map((value) => Number(value).toFixed(6)).join(",");
}

function validateClosedComponent(triangles) {
  const edges = new Map();
  let degenerateTriangles = 0;
  for (const triangle of triangles) {
    const normal = triangleNormal(triangle);
    if (Math.hypot(...normal) < 0.5) degenerateTriangles += 1;
    for (let index = 0; index < 3; index += 1) {
      const left = vertexKey(triangle[index]);
      const right = vertexKey(triangle[(index + 1) % 3]);
      const edge = [left, right].sort().join("|");
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
  }
  const openEdges = [...edges.values()].filter((count) => count !== 2).length;
  return {
    triangleCount: triangles.length,
    degenerateTriangles,
    openEdges,
    watertight: degenerateTriangles === 0 && openEdges === 0,
  };
}

function meshBounds(triangles) {
  const vertices = triangles.flat();
  const axes = [0, 1, 2].map((axis) => vertices.map((vertex) => vertex[axis]));
  const minimum = axes.map((values) => Math.min(...values));
  const maximum = axes.map((values) => Math.max(...values));
  return {
    x: Math.round((maximum[0] - minimum[0]) * 100) / 100,
    y: Math.round((maximum[1] - minimum[1]) * 100) / 100,
    z: Math.round((maximum[2] - minimum[2]) * 100) / 100,
  };
}

function asciiStl(name, components) {
  const safeName = cleanText(name, 60).replace(/[^A-Za-z0-9_-]+/g, "_") || "argentum_part";
  const triangles = components.flat();
  const lines = [`solid ${safeName}`];
  for (const triangle of triangles) {
    const normal = triangleNormal(triangle);
    lines.push(`  facet normal ${normal.map((value) => value.toFixed(8)).join(" ")}`);
    lines.push("    outer loop");
    triangle.forEach((vertex) => lines.push(`      vertex ${vertex.map((value) => Number(value).toFixed(6)).join(" ")}`));
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${safeName}`, "");
  return { body: lines.join("\n"), triangles };
}

function geometryForTemplate(candidate, options = {}) {
  const dimensions = candidate.requirements.dimensionsMm;
  const templateId = candidate.requirements.templateId;
  if (templateId === "label_plate" || templateId === "spacer_block") {
    return [{
      name: templateId === "label_plate" ? "label-plate" : "spacer-block",
      color: cleanText(options.color || "single color", 40),
      components: [boxTriangles([dimensions.x, dimensions.y, dimensions.z])],
      notes: templateId === "label_plate"
        ? "Solid plate only. Lettering or relief geometry requires a later measured CAD operation."
        : "Solid calibration geometry. Do not use as a safety-critical structural part without testing.",
    }];
  }
  if (templateId === "divider_set") {
    const quantity = Math.max(1, Math.min(24, Number(options.quantity || candidate.requirements.quantity || 1)));
    return Array.from({ length: quantity }, (_, index) => ({
      name: `divider-${String(index + 1).padStart(2, "0")}`,
      color: cleanText(options.color || "single color", 40),
      components: [boxTriangles([dimensions.x, dimensions.y, dimensions.z])],
      notes: "Separate divider part. Fit and retention still require a physical test.",
    }));
  }
  if (templateId === "storage_tray") {
    const wall = Math.max(1.2, Math.min(6, numberOrNull(options.wallThicknessMm) || 2.4));
    const bottom = Math.max(1.2, Math.min(6, numberOrNull(options.bottomThicknessMm) || wall));
    if (dimensions.x <= wall * 2 || dimensions.y <= wall * 2 || dimensions.z <= bottom) {
      throw serviceError("Tray dimensions are too small for the selected wall and bottom thickness.");
    }
    const components = [
      boxTriangles([dimensions.x, dimensions.y, bottom], [0, 0, 0]),
      boxTriangles([wall, dimensions.y, dimensions.z - bottom], [0, 0, bottom]),
      boxTriangles([wall, dimensions.y, dimensions.z - bottom], [dimensions.x - wall, 0, bottom]),
      boxTriangles([dimensions.x - (wall * 2), wall, dimensions.z - bottom], [wall, 0, bottom]),
      boxTriangles([dimensions.x - (wall * 2), wall, dimensions.z - bottom], [wall, dimensions.y - wall, bottom]),
    ];
    return [{
      name: "storage-tray",
      color: cleanText(options.color || "single color", 40),
      components,
      notes: `Open tray with ${wall} mm walls and ${bottom} mm bottom. Components are closed, touching solids; slicer union and toolpath remain unverified.`,
    }];
  }
  throw serviceError("This product needs custom CAD. Argentum did not create a placeholder STL.", 422);
}

function safeArtifactDirectory(dataDir, candidateId, jobId) {
  const root = artifactRoot(dataDir);
  const directory = path.resolve(root, candidateId, jobId);
  if (!directory.startsWith(`${path.resolve(root)}${path.sep}`)) throw serviceError("Artifact path escaped the Print Shop workspace.", 500);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function generateCandidateModel(dataDir, candidateId, options = {}) {
  const workspace = loadWorkspace(dataDir);
  const candidate = workspace.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw serviceError("Print Shop candidate not found.", 404);
  if (!candidate.assessment?.generationEligible) {
    const blockers = (candidate.assessment?.generationBlockers || []).join(", ") || "requirements";
    throw serviceError(`Geometry generation is blocked by: ${blockers}.`, 422);
  }
  const jobId = `print-design-${crypto.randomUUID()}`;
  const directory = safeArtifactDirectory(dataDir, candidate.id, jobId);
  const generatedFiles = [];
  try {
    const parts = geometryForTemplate(candidate, options);
    for (const [index, part] of parts.entries()) {
      const generated = asciiStl(part.name, part.components);
      const componentChecks = part.components.map(validateClosedComponent);
      if (componentChecks.some((check) => !check.watertight)) throw serviceError("Generated primitive failed its closed-mesh check.", 500);
      const boundsMm = meshBounds(generated.triangles);
      const fit = fitAssessment(boundsMm);
      if (fit.status !== "coarse_fit") throw serviceError("A generated part exceeded the A1 Mini planning envelope.", 500);
      const fileName = `${String(index + 1).padStart(2, "0")}-${part.name}.stl`;
      const absolutePath = path.join(directory, fileName);
      fs.writeFileSync(absolutePath, generated.body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const body = Buffer.from(generated.body, "utf8");
      generatedFiles.push({
        id: `print-artifact-${crypto.randomUUID()}`,
        candidateId: candidate.id,
        designJobId: jobId,
        partId: `part-${String(index + 1).padStart(3, "0")}`,
        name: part.name,
        kind: "stl",
        relativePath: path.relative(artifactRoot(dataDir), absolutePath),
        downloadUrl: null,
        sha256: crypto.createHash("sha256").update(body).digest("hex"),
        byteSize: body.length,
        source: "argentum_deterministic_parametric_v1",
        color: part.color,
        notes: part.notes,
        license: { status: "operator_owned", commercialUse: "operator_must_confirm_product_rights" },
        validation: {
          geometryStatus: "basic_mesh_checks_passed",
          finiteVertices: generated.triangles.flat(2).every(Number.isFinite),
          triangleCount: generated.triangles.length,
          boundsMm,
          closedPrimitiveComponents: componentChecks.every((check) => check.watertight),
          componentCount: componentChecks.length,
          aggregateBooleanUnion: componentChecks.length === 1 ? "not_required" : "not_checked",
          printerFit: "coarse_fit",
          slicerStatus: "not_run",
          calibrationStatus: "not_run",
          prototypeStatus: "not_run",
          productionStatus: "not_ready",
        },
        createdAt: now(),
      });
    }
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  generatedFiles.forEach((artifact) => {
    artifact.downloadUrl = `/api/print-shop/artifacts/${encodeURIComponent(artifact.id)}/download`;
  });
  const designJob = {
    id: jobId,
    candidateId: candidate.id,
    status: "mesh_checks_passed",
    stage: "Mesh checks passed",
    generator: {
      kind: "deterministic_parametric",
      version: 1,
      templateId: candidate.requirements.templateId,
      parameters: {
        dimensionsMm: candidate.requirements.dimensionsMm,
        quantity: options.quantity || candidate.requirements.quantity,
        wallThicknessMm: options.wallThicknessMm || null,
        bottomThicknessMm: options.bottomThicknessMm || null,
      },
    },
    artifactIds: generatedFiles.map((artifact) => artifact.id),
    gates: {
      geometry: "passed",
      mesh: "basic_checks_passed",
      slicer: "pending",
      calibration: "pending",
      prototype: "pending",
      production: "blocked",
    },
    createdAt: now(),
  };
  workspace.artifacts.unshift(...generatedFiles);
  workspace.designJobs.unshift(designJob);
  candidate.artifactIds = [...generatedFiles.map((artifact) => artifact.id), ...(candidate.artifactIds || [])];
  candidate.status = "mesh_checks_passed";
  candidate.stage = "Mesh checks passed";
  candidate.updatedAt = now();
  addActivity(workspace, "geometry_generated", "Versioned STL geometry generated", `${candidate.title}: ${generatedFiles.length} part file(s); slicer and prototype gates remain pending.`);
  writeWorkspace(dataDir, workspace);
  return { candidate, designJob, artifacts: generatedFiles };
}

function recordResearchRequest(dataDir, payload = {}) {
  const query = cleanText(payload.query, 240);
  if (query.length < 3) throw serviceError("Enter a product research query.");
  const workspace = loadWorkspace(dataDir);
  const approvalId = cleanText(payload.approvalId, 160);
  const existing = workspace.researchRequests.find((request) => request.approvalId === approvalId);
  if (existing) return existing;
  const request = {
    id: `print-research-${crypto.randomUUID()}`,
    query,
    queryHash: /^[a-f0-9]{64}$/.test(String(payload.queryHash || ""))
      ? String(payload.queryHash)
      : crypto.createHash("sha256").update(query.toLowerCase()).digest("hex"),
    provider: cleanText(payload.provider || "External web search", 80),
    geography: cleanText(payload.geography || "United States", 80),
    status: "pending_approval",
    approvalId,
    sources: [],
    claims: [],
    error: null,
    createdAt: now(),
  };
  workspace.researchRequests.unshift(request);
  addActivity(workspace, "research_gated", "External research routed to Human Gate", `${query}: no external provider call has run.`);
  writeWorkspace(dataDir, workspace);
  return request;
}

function safeResearchSourceUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    [...parsed.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return null;
  }
}

function discoveryLane(laneId) {
  const normalized = cleanText(laneId || "workspace", 40).toLowerCase();
  const lane = DISCOVERY_LANES.find((item) => item.id === normalized);
  if (!lane) throw serviceError("Choose a supported product-discovery lane.");
  return lane;
}

function buildDiscoveryPlan(payload = {}) {
  const lane = discoveryLane(payload.laneId || payload.lane);
  const geography = cleanText(payload.geography || "United States", 80) || "United States";
  const queries = lane.queries.map((query) => ({
    ...query,
    queryHash: crypto.createHash("sha256").update(`${query.query.toLowerCase()}|${geography.toLowerCase()}`).digest("hex"),
  }));
  const planBasis = {
    version: 1,
    laneId: lane.id,
    geography,
    queryHashes: queries.map((query) => query.queryHash),
  };
  return {
    brief: {
      laneId: lane.id,
      laneName: lane.name,
      geography,
      objective: lane.objective,
    },
    queries,
    planHash: crypto.createHash("sha256").update(JSON.stringify(planBasis)).digest("hex"),
    maximumCalls: queries.length,
    maximumResultsPerCall: 6,
  };
}

function validatedDiscoveryPlan(plan = {}) {
  const expected = buildDiscoveryPlan({
    laneId: plan.brief?.laneId,
    geography: plan.brief?.geography,
  });
  if (plan.planHash !== expected.planHash) throw serviceError("Discovery plan hash does not match the saved research brief.", 409);
  if (JSON.stringify(plan.queries || []) !== JSON.stringify(expected.queries)) {
    throw serviceError("Discovery queries changed after the plan was created.", 409);
  }
  if (Number(plan.maximumCalls) !== expected.maximumCalls || Number(plan.maximumResultsPerCall) !== expected.maximumResultsPerCall) {
    throw serviceError("Discovery call limits changed after the plan was created.", 409);
  }
  return expected;
}

function trimDiscoveryCollections(workspace) {
  const linkedOpportunityIds = new Set(
    workspace.candidates.map((candidate) => candidate.evidence?.opportunityId).filter(Boolean),
  );
  const retainedRuns = workspace.discoveryRuns.slice(0, MAX_DISCOVERY_RUNS);
  const retainedRunIds = new Set(retainedRuns.map((run) => run.id));
  workspace.opportunities = workspace.opportunities
    .filter((opportunity) => retainedRunIds.has(opportunity.discoveryRunId) || linkedOpportunityIds.has(opportunity.id))
    .slice(0, MAX_OPPORTUNITIES);
  const retainedOpportunityIds = new Set(workspace.opportunities.map((opportunity) => opportunity.id));
  const retainedSourceIds = new Set(
    workspace.opportunities.flatMap((opportunity) => opportunity.sourceObservationIds || []),
  );
  retainedRuns.forEach((run) => (run.sourceObservationIds || []).forEach((id) => retainedSourceIds.add(id)));
  workspace.sourceObservations = workspace.sourceObservations
    .filter((source) => retainedSourceIds.has(source.id))
    .slice(0, MAX_SOURCE_OBSERVATIONS);
  const availableSourceIds = new Set(workspace.sourceObservations.map((source) => source.id));
  retainedRuns.forEach((run) => {
    run.opportunityIds = (run.opportunityIds || []).filter((id) => retainedOpportunityIds.has(id));
    run.sourceObservationIds = (run.sourceObservationIds || []).filter((id) => availableSourceIds.has(id));
  });
  workspace.discoveryRuns = retainedRuns;
}

function recordDiscoveryRun(dataDir, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const plan = validatedDiscoveryPlan(payload.plan);
  const provider = cleanText(payload.provider, 80);
  const approvalId = cleanText(payload.approvalId, 160);
  if (!provider) throw serviceError("A configured research provider is required before recording a discovery run.", 409);
  if (!approvalId) throw serviceError("A Human Gate request is required before recording a discovery run.", 409);
  const requestedId = cleanText(payload.id, 180);
  const id = requestedId || `print-discovery-${crypto.randomUUID()}`;
  const existing = workspace.discoveryRuns.find((run) => run.id === id || run.approvalId === approvalId);
  if (existing) return existing;
  if (!/^print-discovery-[A-Za-z0-9-]+$/.test(id)) throw serviceError("Discovery run ID is invalid.");
  const timestamp = now();
  const run = {
    id,
    status: "pending_approval",
    provider,
    providerModel: cleanText(payload.providerModel, 120) || null,
    approvalId,
    plan,
    scope: payload.scope && typeof payload.scope === "object" ? clone(payload.scope) : null,
    execution: {
      startedAt: null,
      completedAt: null,
      providerResponseId: null,
      callsCompleted: 0,
      toolCallsUsed: 0,
      error: null,
    },
    callResults: plan.queries.map((query) => ({ queryId: query.id, status: "pending", resultCount: 0, error: null })),
    sourceObservationIds: [],
    opportunityIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  workspace.discoveryRuns.unshift(run);
  trimDiscoveryCollections(workspace);
  addActivity(workspace, "discovery_gated", "Opportunity discovery routed to Human Gate", `${plan.brief.laneName}: no external research has run.`);
  writeWorkspace(dataDir, workspace);
  return run;
}

function startDiscoveryRun(dataDir, runId) {
  const workspace = loadWorkspace(dataDir);
  const run = workspace.discoveryRuns.find((item) => item.id === runId);
  if (!run) throw serviceError("Print Shop discovery run not found.", 404);
  if (!["pending_approval", "approved_not_run"].includes(run.status)) {
    throw serviceError("This discovery run cannot be started from its current state.", 409);
  }
  run.status = "running";
  run.execution = {
    ...(run.execution || {}),
    startedAt: now(),
    completedAt: null,
    error: null,
  };
  run.updatedAt = now();
  writeWorkspace(dataDir, workspace);
  return run;
}

function sourceDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

function sourceObservationRecords(run, provider, results = []) {
  const approvedQueryIds = new Set(run.plan.queries.map((query) => query.id));
  const queryIdsForResult = (result) => {
    const values = Array.isArray(result?.queryIds) ? result.queryIds : [result?.queryId];
    return [...new Set(values.map((value) => cleanText(value, 100)).filter(Boolean))];
  };
  const invalidQuery = results.find((result) => {
    const queryIds = queryIdsForResult(result);
    return !queryIds.length || queryIds.some((queryId) => !approvedQueryIds.has(queryId));
  });
  if (invalidQuery) throw serviceError("A research result does not belong to an approved discovery query.", 409);
  const observedAt = now();
  const byUrl = new Map();
  results.forEach((result) => {
    const url = safeResearchSourceUrl(result?.url);
    if (!url) return;
    const title = cleanText(result?.title || sourceDomain(url), 240);
    const snippet = cleanText(result?.snippet || result?.summary, 1200);
    const queryIds = queryIdsForResult(result);
    const existing = byUrl.get(url);
    if (existing) {
      queryIds.forEach((queryId) => {
        if (!existing.queryIds.includes(queryId)) existing.queryIds.push(queryId);
      });
      if (snippet.length > existing.snippet.length) existing.snippet = snippet;
      return;
    }
    byUrl.set(url, {
      id: `print-source-${crypto.randomUUID()}`,
      discoveryRunId: run.id,
      queryIds,
      title,
      url,
      domain: sourceDomain(url),
      snippet,
      observationType: ["search_snippet", "provider_summary", "citation"].includes(result?.observationType)
        ? result.observationType
        : "search_snippet",
      provider,
      observedAt,
      contentHash: crypto.createHash("sha256").update(`${title}\n${url}\n${snippet}`).digest("hex"),
    });
  });
  return [...byUrl.values()];
}

function templateName(templateId) {
  return templateById(templateId).name;
}

function sourceIdsForDraft(draft, observations) {
  const byUrl = new Map(observations.map((source) => [source.url, source.id]));
  const ids = [];
  (Array.isArray(draft?.sourceUrls) ? draft.sourceUrls : []).forEach((value) => {
    const url = safeResearchSourceUrl(value);
    const id = url ? byUrl.get(url) : null;
    if (id && !ids.includes(id)) ids.push(id);
  });
  (Array.isArray(draft?.sourceObservationIds) ? draft.sourceObservationIds : []).forEach((id) => {
    if (observations.some((source) => source.id === id) && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

function opportunityRecord(run, observations, input, index) {
  const sourceObservationIds = input.sourceObservationIds;
  const sourceRecords = observations.filter((source) => sourceObservationIds.includes(source.id));
  const title = cleanText(input.title, 100);
  const problem = cleanText(input.problem, 500);
  const targetBuyer = cleanText(input.targetBuyer, 240);
  if (title.length < 3 || problem.length < 10 || !sourceRecords.length) return null;
  const requestedTemplateId = cleanText(input.templateId, 40);
  const templateId = TEMPLATE_CATALOG.some((template) => template.id === requestedTemplateId)
    ? requestedTemplateId
    : inferTemplate(`${title} ${problem}`);
  const safety = safetyAssessment(title, problem);
  const domainCount = new Set(sourceRecords.map((source) => source.domain)).size;
  const timestamp = now();
  return {
    id: `print-opportunity-${crypto.randomUUID()}`,
    discoveryRunId: run.id,
    title,
    problem,
    targetBuyer: targetBuyer || "Buyer segment requires follow-up research",
    stage: "discovered",
    sourceObservationIds,
    evidenceSummary: [
      `${sourceRecords.length} cited web observation${sourceRecords.length === 1 ? "" : "s"} mention this product or problem space.`,
      "This is a research lead, not evidence of demand, sales, price, competition, or commercial rights.",
    ],
    manufacturing: {
      templateId,
      templateName: templateName(templateId),
      templateBasis: cleanText(input.templateBasis || "source_keyword_classifier", 80),
      printerFit: "needs_measurement",
      dimensions: "needs_measurement",
      material: "needs_selection",
      colorProcess: "one_color_preferred_or_separate_parts",
      generationEligible: false,
      blockers: ["measurements", "material", ...(templateId === "custom" ? ["custom_cad"] : [])],
    },
    safety: {
      status: safety.status,
      reviews: safety.reviews,
      intellectualProperty: safety.intellectualProperty,
    },
    truth: {
      evidenceStatus: "source_backed_search_observations",
      marketDemandMeasured: false,
      demand: null,
      salesVolume: null,
      sellingPrice: null,
      competition: null,
      unitEconomics: null,
      profit: null,
      commercialRights: "unverified",
      printerFit: "needs_measurement",
    },
    rankingFactors: {
      sourceObservationCount: sourceRecords.length,
      independentDomainCount: domainCount,
      templatePath: templateById(templateId).generatedGeometry ? "supported_after_measurement" : "custom_cad_after_measurement",
      safetyReviewCount: safety.reviews.length,
      orderBasis: "evidence_coverage_and_manufacturing_investigability",
    },
    discoveryOrder: index + 1,
    promotedCandidateId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function inferredOpportunityInputs(observations) {
  return OPPORTUNITY_ARCHETYPES.map((archetype) => {
    const matching = observations.filter((source) => {
      const text = `${source.title} ${source.snippet}`.toLowerCase();
      return archetype.terms.some((term) => text.includes(term));
    });
    return matching.length ? {
      title: archetype.title,
      problem: archetype.problem,
      targetBuyer: archetype.targetBuyer,
      templateId: archetype.templateId,
      templateBasis: "local_source_keyword_classifier",
      sourceObservationIds: matching.slice(0, 5).map((source) => source.id),
    } : null;
  }).filter(Boolean);
}

function draftedOpportunityInputs(drafts, observations) {
  return (Array.isArray(drafts) ? drafts : []).slice(0, 8).map((draft) => ({
    title: draft?.title,
    problem: draft?.problem || draft?.problemHypothesis || draft?.productHypothesis,
    targetBuyer: draft?.targetBuyer,
    templateId: draft?.templateId || draft?.suggestedTemplateId,
    templateBasis: "agent101_source_synthesis_validated_locally",
    sourceObservationIds: sourceIdsForDraft(draft, observations),
  })).filter((draft) => draft.sourceObservationIds.length);
}

function sortOpportunities(opportunities) {
  return opportunities.sort((left, right) => (
    Number(right.rankingFactors.sourceObservationCount) - Number(left.rankingFactors.sourceObservationCount)
    || Number(right.rankingFactors.independentDomainCount) - Number(left.rankingFactors.independentDomainCount)
    || Number(left.rankingFactors.safetyReviewCount) - Number(right.rankingFactors.safetyReviewCount)
    || left.title.localeCompare(right.title)
  )).map((opportunity, index) => ({ ...opportunity, discoveryOrder: index + 1 }));
}

function completeDiscoveryRun(dataDir, runId, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const run = workspace.discoveryRuns.find((item) => item.id === runId);
  if (!run) throw serviceError("Print Shop discovery run not found.", 404);
  if (["complete", "partial", "failed"].includes(run.status)) throw serviceError("This discovery run is already terminal.", 409);
  const provider = cleanText(payload.provider, 80);
  if (!provider || provider !== run.provider) throw serviceError("Discovery provider does not match the approved run.", 409);
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const observations = sourceObservationRecords(run, provider, rawResults);
  if (!observations.length) throw serviceError("The approved discovery returned no usable HTTP(S) source observations.", 502);
  const coveredQueryIds = new Set(observations.flatMap((source) => source.queryIds));
  const inputs = draftedOpportunityInputs(payload.opportunities, observations);
  const selectedInputs = inputs.length ? inputs : inferredOpportunityInputs(observations);
  const opportunities = sortOpportunities(
    selectedInputs.map((input, index) => opportunityRecord(run, observations, input, index)).filter(Boolean),
  );
  workspace.sourceObservations.unshift(...observations);
  workspace.opportunities.unshift(...opportunities);
  run.sourceObservationIds = observations.map((source) => source.id);
  run.opportunityIds = opportunities.map((opportunity) => opportunity.id);
  run.status = coveredQueryIds.size === run.plan.queries.length ? "complete" : "partial";
  run.execution = {
    ...(run.execution || {}),
    completedAt: now(),
    providerResponseId: cleanText(payload.providerResponseId, 180) || null,
    callsCompleted: Number(payload.callsCompleted || coveredQueryIds.size || 1),
    toolCallsUsed: Number(payload.toolCallsUsed || 0),
    error: null,
  };
  run.callResults = run.plan.queries.map((query) => ({
    queryId: query.id,
    status: coveredQueryIds.has(query.id) ? "complete" : "not_returned",
    resultCount: observations.filter((source) => source.queryIds.includes(query.id)).length,
    error: null,
  }));
  run.updatedAt = now();
  trimDiscoveryCollections(workspace);
  addActivity(
    workspace,
    "discovery_completed",
    opportunities.length ? "Source-backed product opportunities prepared" : "Discovery sources saved without a qualified opportunity",
    `${run.plan.brief.laneName}: ${observations.length} cited observations and ${opportunities.length} research leads saved; demand remains unmeasured.`,
  );
  writeWorkspace(dataDir, workspace);
  return run;
}

function failDiscoveryRun(dataDir, runId, error, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const run = workspace.discoveryRuns.find((item) => item.id === runId);
  if (!run) throw serviceError("Print Shop discovery run not found.", 404);
  if (["complete", "partial"].includes(run.status)) throw serviceError("A completed discovery run cannot be failed.", 409);
  run.status = "failed";
  run.error = cleanText(error?.message || error || "The approved discovery failed.", 500);
  run.execution = {
    ...(run.execution || {}),
    completedAt: now(),
    callsCompleted: Number(payload.callsCompleted || run.execution?.callsCompleted || 0),
    error: run.error,
  };
  run.updatedAt = now();
  addActivity(workspace, "discovery_failed", "Approved opportunity discovery failed", `${run.plan.brief.laneName}: ${run.error}`);
  writeWorkspace(dataDir, workspace);
  return run;
}

function updateOpportunity(dataDir, opportunityId, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const opportunity = workspace.opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) throw serviceError("Print Shop opportunity not found.", 404);
  const action = cleanText(payload.action, 30).toLowerCase();
  const nextStages = {
    shortlist: "shortlisted",
    dismiss: "dismissed",
    restore: "discovered",
  };
  if (!nextStages[action]) throw serviceError("Choose a supported opportunity action.");
  if (opportunity.stage === "promoted" && action !== "restore") throw serviceError("A promoted opportunity is already linked to a design project.", 409);
  opportunity.stage = nextStages[action];
  opportunity.updatedAt = now();
  addActivity(workspace, "opportunity_updated", "Opportunity status updated", `${opportunity.title}: ${opportunity.stage}.`);
  writeWorkspace(dataDir, workspace);
  return opportunity;
}

function promoteOpportunity(dataDir, opportunityId) {
  const workspace = loadWorkspace(dataDir);
  const opportunity = workspace.opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) throw serviceError("Print Shop opportunity not found.", 404);
  if (opportunity.promotedCandidateId) {
    const existing = workspace.candidates.find((candidate) => candidate.id === opportunity.promotedCandidateId);
    if (existing) return { opportunity, candidate: existing };
  }
  const run = workspace.discoveryRuns.find((item) => item.id === opportunity.discoveryRunId);
  if (!run || !["complete", "partial"].includes(run.status)) {
    throw serviceError("The linked discovery run must be complete or partial before promotion.", 409);
  }
  const sources = (opportunity.sourceObservationIds || []).map((sourceId) => (
    workspace.sourceObservations.find((source) => source.id === sourceId)
  ));
  if (!sources.length || sources.some((source) => !source || source.discoveryRunId !== run.id)) {
    throw serviceError("Opportunity evidence is missing or does not match its discovery run.", 409);
  }
  sources.forEach((source) => {
    const expectedHash = crypto.createHash("sha256").update(`${source.title}\n${source.url}\n${source.snippet}`).digest("hex");
    if (expectedHash !== source.contentHash) throw serviceError("Opportunity evidence changed after it was recorded.", 409);
  });
  const analyzed = analyzeRequirements({
    concept: opportunity.title,
    templateId: opportunity.manufacturing?.templateId || "auto",
    material: "",
    dimensionsMm: {},
    colorCount: 1,
    separateColorParts: false,
    useCase: opportunity.problem,
    environment: "",
    loadNotes: "",
    quantity: 1,
  });
  analyzed.assessment.marketEvidence = {
    ...analyzed.assessment.marketEvidence,
    status: "source_observations_collected",
    note: `${sources.length} cited search observation${sources.length === 1 ? "" : "s"} support investigation only; demand, price, competition, and commercial rights remain unmeasured.`,
  };
  const timestamp = now();
  const candidate = {
    id: `print-candidate-${crypto.randomUUID()}`,
    title: opportunity.title,
    query: opportunity.title,
    status: analyzed.assessment.status,
    stage: "Requirements",
    requirements: analyzed.requirements,
    assessment: analyzed.assessment,
    evidence: {
      operatorInput: false,
      origin: "discovery_run",
      discoveryRunId: run.id,
      opportunityId: opportunity.id,
      externalSources: opportunity.sourceObservationIds.slice(),
      sourceHashes: sources.map((source) => ({ id: source.id, contentHash: source.contentHash })),
      generatedClaims: [],
    },
    artifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  workspace.candidates.unshift(candidate);
  workspace.candidates = workspace.candidates.slice(0, 100);
  opportunity.stage = "promoted";
  opportunity.promotedCandidateId = candidate.id;
  opportunity.updatedAt = timestamp;
  addActivity(workspace, "opportunity_promoted", "Research lead opened in Design Lab", `${opportunity.title}: measurements and material are still required.`);
  writeWorkspace(dataDir, workspace);
  return { opportunity, candidate };
}

function completeResearchRequest(dataDir, requestId, payload = {}) {
  const workspace = loadWorkspace(dataDir);
  const request = workspace.researchRequests.find((item) => item.id === requestId);
  if (!request) throw serviceError("Print Shop research request not found.", 404);
  if (request.status === "complete") return request;
  const observedAt = now();
  const sources = (Array.isArray(payload.results) ? payload.results : [])
    .slice(0, 8)
    .map((result) => {
      const url = safeResearchSourceUrl(result?.url);
      if (!url) return null;
      const title = cleanText(result?.title || new URL(url).hostname, 240);
      const snippet = cleanText(result?.snippet, 1200);
      return {
        id: `print-source-${crypto.randomUUID()}`,
        title,
        url,
        snippet,
        provider: cleanText(payload.provider || request.provider, 80),
        observedAt,
        contentHash: crypto.createHash("sha256").update(`${title}\n${url}\n${snippet}`).digest("hex"),
      };
    })
    .filter(Boolean);
  if (!sources.length) throw serviceError("The approved search returned no usable HTTP(S) source records.", 502);
  request.status = "complete";
  request.provider = cleanText(payload.provider || request.provider, 80);
  request.sources = sources;
  request.claims = [];
  request.error = null;
  request.completedAt = observedAt;
  addActivity(
    workspace,
    "research_completed",
    "Cited product evidence saved",
    `${request.query}: ${sources.length} source-linked search observations saved; no demand score was inferred.`,
  );
  writeWorkspace(dataDir, workspace);
  return request;
}

function failResearchRequest(dataDir, requestId, error) {
  const workspace = loadWorkspace(dataDir);
  const request = workspace.researchRequests.find((item) => item.id === requestId);
  if (!request) throw serviceError("Print Shop research request not found.", 404);
  request.status = "failed";
  request.error = cleanText(error?.message || error || "The approved search failed.", 500);
  request.failedAt = now();
  addActivity(workspace, "research_failed", "Approved product search failed", `${request.query}: ${request.error}`);
  writeWorkspace(dataDir, workspace);
  return request;
}

function approvalStatusMap(approvals = []) {
  return new Map((Array.isArray(approvals) ? approvals : []).map((approval) => [approval.id, approval]));
}

function publicSnapshot(dataDir, options = {}) {
  const workspace = loadWorkspace(dataDir);
  const approvals = approvalStatusMap(options.approvals);
  const researchRequests = workspace.researchRequests.map((request) => {
    const approval = approvals.get(request.approvalId);
    return {
      ...request,
      status: ["complete", "failed"].includes(request.status)
        ? request.status
        : approval?.consumedAt
          ? "running_or_consumed"
          : approval?.status === "approved"
            ? "approved_not_run"
            : approval?.status || request.status,
      approval: approval ? {
        id: approval.id,
        status: approval.status,
        expiresAt: approval.expiresAt || null,
        consumedAt: approval.consumedAt || null,
      } : null,
    };
  });
  const artifacts = workspace.artifacts.map((artifact) => ({
    ...artifact,
    relativePath: undefined,
    downloadUrl: `/api/print-shop/artifacts/${encodeURIComponent(artifact.id)}/download`,
  }));
  const discoveryRuns = workspace.discoveryRuns.map((run) => {
    const approval = approvals.get(run.approvalId);
    return {
      ...run,
      status: ["complete", "partial", "failed", "running", "interrupted"].includes(run.status)
        ? run.status
        : approval?.consumedAt
          ? "running_or_consumed"
          : approval?.status === "approved"
            ? "approved_not_run"
            : approval?.status || run.status,
      approval: approval ? {
        id: approval.id,
        status: approval.status,
        expiresAt: approval.expiresAt || null,
        consumedAt: approval.consumedAt || null,
      } : null,
    };
  });
  const pendingApprovals = [
    ...researchRequests.map((request) => request.status),
    ...discoveryRuns.map((run) => run.status),
  ].filter((status) => ["pending", "pending_approval"].includes(status)).length;
  return {
    schemaVersion: workspace.schemaVersion,
    office: {
      id: "print-shop-office",
      name: "Product Research Lab",
      mode: "local_supervised",
      safetyRule: "Research calls, printing, spending, publishing, pricing, and customer contact remain Human Gate actions.",
    },
    printerProfile: workspace.printerProfile,
    settings: workspace.settings,
    templates: TEMPLATE_CATALOG.map(clone),
    discoveryLanes: DISCOVERY_LANES.map((lane) => ({ id: lane.id, name: lane.name, objective: lane.objective })),
    counts: {
      candidates: workspace.candidates.length,
      designJobs: workspace.designJobs.length,
      stlArtifacts: artifacts.filter((artifact) => artifact.kind === "stl").length,
      pendingApprovals,
      discoveryRuns: discoveryRuns.length,
      sourceObservations: workspace.sourceObservations.length,
      opportunities: workspace.opportunities.filter((opportunity) => opportunity.stage !== "dismissed").length,
      shortlisted: workspace.opportunities.filter((opportunity) => opportunity.stage === "shortlisted").length,
      slicedArtifacts: artifacts.filter((artifact) => artifact.validation?.slicerStatus === "accepted").length,
      prototypeVerified: artifacts.filter((artifact) => artifact.validation?.prototypeStatus === "verified").length,
    },
    candidates: workspace.candidates,
    designJobs: workspace.designJobs,
    artifacts,
    researchRequests,
    discoveryRuns,
    sourceObservations: workspace.sourceObservations,
    opportunities: workspace.opportunities,
    activity: workspace.activity.slice(0, 20),
    truth: {
      externalMarketEvidenceCollected: (
        researchRequests.some((request) => request.status === "complete" && request.sources.length)
        || workspace.sourceObservations.length > 0
      ),
      marketDemandMeasured: false,
      researchSearchConfigured: Boolean(options.searchProvider),
      researchSearchProvider: options.searchProvider || null,
      slicerConnected: false,
      printerConnected: false,
      costModelReady: false,
      note: "Unknown values stay unknown. Generated geometry is not a slicing result or a production approval.",
    },
    updatedAt: workspace.updatedAt,
  };
}

function artifactForDownload(dataDir, artifactId) {
  const workspace = loadWorkspace(dataDir);
  const artifact = workspace.artifacts.find((item) => item.id === artifactId);
  if (!artifact) throw serviceError("Print Shop artifact not found.", 404);
  const root = path.resolve(artifactRoot(dataDir));
  if (!artifact.relativePath || path.isAbsolute(artifact.relativePath)) throw serviceError("Artifact path is invalid.", 500);
  const absolutePath = path.resolve(root, artifact.relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) throw serviceError("Artifact path escaped the Print Shop workspace.", 403);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw serviceError("Artifact is not a regular file.", 403);
  const currentHash = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  if (currentHash !== artifact.sha256) throw serviceError("Artifact content changed after validation. Generate a new version.", 409);
  return { artifact, absolutePath };
}

module.exports = {
  A1_MINI_PROFILE,
  DISCOVERY_LANES,
  SCHEMA_VERSION,
  TEMPLATE_CATALOG,
  analyzeCandidate,
  analyzeRequirements,
  artifactForDownload,
  boxTriangles,
  buildDiscoveryPlan,
  completeDiscoveryRun,
  completeResearchRequest,
  failDiscoveryRun,
  failResearchRequest,
  generateCandidateModel,
  loadWorkspace,
  promoteOpportunity,
  publicSnapshot,
  recordDiscoveryRun,
  recordResearchRequest,
  startDiscoveryRun,
  updateCandidate,
  updateOpportunity,
  validateClosedComponent,
  writeWorkspace,
};
