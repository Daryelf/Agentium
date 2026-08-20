const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const DEFAULT_BAUD_RATE = 115200;
const DEFAULT_REFRESH_MS = 8000;
const RECONNECT_MS = 2500;
const MAX_LINE_BYTES = 256;

const OFFICE_ROUTES = Object.freeze({
  "depo-habitat": "/?agent101=1",
  "clips-office": "/apps/clipping-office/",
  "stock-office": "/apps/stock-office/",
  "print-shop-office": "/apps/print-shop-office/",
  "etsy-office": "/apps/etsy-office/",
  "essentrx-office": "/apps/essentrx-office/",
});

function cleanField(value, maxLength = 28) {
  return String(value ?? "")
    .replace(/[|\r\n\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function measuredNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : -1;
}

function measuredSum(...values) {
  const known = values.map(measuredNumber).filter((value) => value >= 0);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : -1;
}

function displayOfficeSnapshot(payload = {}) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const officesById = new Map(
    nodes
      .filter((node) => node?.kind === "office" && OFFICE_ROUTES[node?.refs?.officeId])
      .map((node) => [node.refs.officeId, node]),
  );
  const gate = nodes.find((node) => node?.id === "gate:human");
  const offices = Object.keys(OFFICE_ROUTES).map((officeId) => {
    const node = officesById.get(officeId) || {};
    const counts = node.counts || {};
    const isStockOffice = officeId === "stock-office";
    return {
      id: officeId,
      label: cleanField(node.label || officeId, 24),
      lifecycle: cleanField(node.lifecycle || "unknown", 20),
      availability: cleanField(node.availability || "unknown", 20),
      tasks: isStockOffice ? measuredNumber(counts.trackedRecords ?? counts.records) : measuredNumber(counts.tasks),
      active: isStockOffice ? measuredNumber(counts.activeResearch) : measuredSum(counts.activeTasks, counts.activeMissions),
      outputs: measuredSum(counts.outputs, counts.officeOutputs, counts.artifacts),
      approvals: measuredSum(counts.approvalsPending, counts.officeApprovalsPending),
    };
  });
  return {
    generatedAt: cleanField(payload.generatedAt || new Date().toISOString(), 32),
    partial: Boolean(payload.partial),
    activeOffices: measuredNumber(payload.summary?.activeOffices),
    approvalsPending: measuredNumber(payload.summary?.approvalsPending ?? gate?.counts?.pending),
    outputsReady: measuredNumber(payload.summary?.outputsReady),
    offices,
  };
}

function encodeDisplaySnapshot(payload = {}) {
  const snapshot = displayOfficeSnapshot(payload);
  const lines = [
    [
      "BEGIN",
      "1",
      snapshot.generatedAt,
      snapshot.partial ? "1" : "0",
      snapshot.activeOffices,
      snapshot.approvalsPending,
      snapshot.outputsReady,
    ].join("|"),
  ];
  snapshot.offices.forEach((office) => {
    lines.push([
      "OFFICE",
      office.id,
      office.label,
      office.lifecycle,
      office.availability,
      office.tasks,
      office.active,
      office.outputs,
      office.approvals,
    ].join("|"));
  });
  lines.push("END");
  return `${lines.join("\n")}\n`;
}

function parseDisplayCommand(line = "") {
  const fields = String(line).trim().split("|");
  if (fields[0] === "HELLO" || fields[0] === "REFRESH") return { type: fields[0].toLowerCase() };
  if (fields[0] === "OPEN" && OFFICE_ROUTES[fields[1]]) {
    return { type: "open", officeId: fields[1], route: OFFICE_ROUTES[fields[1]] };
  }
  return null;
}

function supportedSerialDevice(name = "") {
  return /^cu\.(?:usbserial|wchusbserial|SLAB_USBtoUART|usbmodem)/i.test(name);
}

function discoverOfficeDisplayPort(options = {}) {
  const configured = String(options.configuredPort || "").trim();
  if (configured) return configured.startsWith("/dev/") ? configured : "";
  let devices = [];
  try {
    devices = fs.readdirSync("/dev")
      .filter(supportedSerialDevice)
      .map((name) => path.join("/dev", name));
  } catch (_error) {
    return "";
  }
  if (devices.length === 1) return devices[0];
  const classicUsbSerial = devices.filter((device) => /\/cu\.usbserial-/i.test(device));
  return classicUsbSerial.length === 1 ? classicUsbSerial[0] : "";
}

function configureSerialPort(portPath, baudRate) {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/stty",
      ["-f", portPath, String(baudRate), "cs8", "-cstopb", "-parenb", "raw", "-echo", "-hupcl"],
      { timeout: 3000 },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

class OfficeDisplayBridge {
  constructor(options = {}) {
    this.getSnapshot = options.getSnapshot;
    this.onOpenOffice = options.onOpenOffice;
    this.onStatus = options.onStatus;
    this.configuredPort = options.portPath || process.env.ARGENTUM_OFFICE_DISPLAY_PORT || "";
    this.baudRate = Number(options.baudRate || DEFAULT_BAUD_RATE);
    this.refreshMs = Number(options.refreshMs || DEFAULT_REFRESH_MS);
    this.fd = null;
    this.portPath = "";
    this.readBuffer = Buffer.alloc(512);
    this.lineBuffer = "";
    this.running = false;
    this.connectTimer = null;
    this.refreshTimer = null;
    this.writeTail = Promise.resolve();
    this.refreshInFlight = false;
    this.lastStatus = "";
  }

  status(state, detail = "") {
    const signature = `${state}:${detail}`;
    if (signature === this.lastStatus) return;
    this.lastStatus = signature;
    this.onStatus?.({ state, detail, portPath: this.portPath });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  async connect() {
    if (!this.running || this.fd !== null) return;
    const portPath = discoverOfficeDisplayPort({ configuredPort: this.configuredPort });
    if (!portPath) {
      this.status("waiting", "Connect one supported USB serial display");
      this.scheduleReconnect();
      return;
    }
    try {
      await configureSerialPort(portPath, this.baudRate);
      if (!this.running) return;
      this.fd = fs.openSync(
        portPath,
        fs.constants.O_RDWR | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK,
      );
      this.portPath = portPath;
      this.lineBuffer = "";
      this.status("connected", portPath);
      this.readNext();
      this.scheduleRefresh(250);
    } catch (error) {
      this.status("waiting", cleanField(error?.message || "serial unavailable", 96));
      this.disconnect();
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    clearTimeout(this.connectTimer);
    if (!this.running) return;
    this.connectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  scheduleRefresh(delay = this.refreshMs) {
    clearTimeout(this.refreshTimer);
    if (!this.running || this.fd === null) return;
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  async refresh() {
    if (!this.running || this.fd === null || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      const result = await this.getSnapshot?.();
      if (!result?.ok || !result.payload) {
        const state = Number(result?.status) === 401 ? "LOCKED" : "WAITING";
        await this.write(`${state}|OPEN ARGENTUM ON MAC\n`);
      } else {
        await this.write(encodeDisplaySnapshot(result.payload));
      }
    } catch (error) {
      this.status("degraded", cleanField(error?.message || "snapshot unavailable", 96));
      await this.write("WAITING|ARGENTUM STATUS UNAVAILABLE\n").catch(() => {});
    } finally {
      this.refreshInFlight = false;
      this.scheduleRefresh();
    }
  }

  readNext() {
    if (!this.running || this.fd === null) return;
    const activeFd = this.fd;
    fs.read(activeFd, this.readBuffer, 0, this.readBuffer.length, null, (error, bytesRead) => {
      if (!this.running || this.fd !== activeFd) return;
      if (error) {
        if (["EAGAIN", "EWOULDBLOCK"].includes(error.code)) {
          setTimeout(() => this.readNext(), 25);
          return;
        }
        this.status("waiting", cleanField(error.message, 96));
        this.disconnect();
        this.scheduleReconnect();
        return;
      }
      if (bytesRead === 0) {
        setTimeout(() => this.readNext(), 25);
        return;
      }
      this.consume(this.readBuffer.subarray(0, bytesRead).toString("utf8"));
      setImmediate(() => this.readNext());
    });
  }

  consume(chunk = "") {
    this.lineBuffer += String(chunk).replace(/[^\x20-\x7e\r\n]/g, "");
    if (this.lineBuffer.length > MAX_LINE_BYTES * 4) this.lineBuffer = this.lineBuffer.slice(-MAX_LINE_BYTES);
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() || "";
    lines.forEach((line) => {
      if (line.length > MAX_LINE_BYTES) return;
      const command = parseDisplayCommand(line);
      if (!command) return;
      if (command.type === "open") this.onOpenOffice?.(command);
      if (["hello", "refresh"].includes(command.type)) this.scheduleRefresh(0);
    });
  }

  write(payload) {
    const data = Buffer.from(String(payload), "utf8");
    this.writeTail = this.writeTail.then(() => new Promise((resolve, reject) => {
      if (this.fd === null) {
        reject(new Error("serial display is disconnected"));
        return;
      }
      const activeFd = this.fd;
      const writePart = (offset) => {
        fs.write(activeFd, data, offset, data.length - offset, null, (error, bytesWritten) => {
          if (error && ["EAGAIN", "EWOULDBLOCK"].includes(error.code)) {
            setTimeout(() => writePart(offset), 10);
            return;
          }
          if (error || this.fd !== activeFd) {
            reject(error || new Error("serial display disconnected during write"));
            return;
          }
          if (offset + bytesWritten < data.length) writePart(offset + bytesWritten);
          else resolve();
        });
      };
      writePart(0);
    })).catch((error) => {
      this.status("waiting", cleanField(error?.message || "serial write failed", 96));
      this.disconnect();
      this.scheduleReconnect();
    });
    return this.writeTail;
  }

  disconnect() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const fd = this.fd;
    this.fd = null;
    this.portPath = "";
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_error) {}
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.connectTimer);
    clearTimeout(this.refreshTimer);
    this.disconnect();
    this.status("stopped", "");
  }
}

function createOfficeDisplayBridge(options = {}) {
  return new OfficeDisplayBridge(options);
}

module.exports = {
  OFFICE_ROUTES,
  OfficeDisplayBridge,
  cleanField,
  createOfficeDisplayBridge,
  discoverOfficeDisplayPort,
  displayOfficeSnapshot,
  encodeDisplaySnapshot,
  parseDisplayCommand,
};
