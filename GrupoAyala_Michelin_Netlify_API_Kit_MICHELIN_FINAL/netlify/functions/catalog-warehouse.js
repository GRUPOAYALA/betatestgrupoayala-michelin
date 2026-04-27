const {
  json,
  buildIssueTimestamp,
  buildDocumentNumber
} = require("./_lib/auth");

function detectDelimiter(headerLine) {
  const comma = headerLine.split(",").length;
  const semi = headerLine.split(";").length;
  return semi > comma ? ";" : ",";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickIndex(headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseWarehousesCsv(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(normalizeHeader);

  const idxWarehouse = pickIndex(headers, ["ALMACEN", "WAREHOUSE", "WHS"]);
  const idxShipTo = pickIndex(headers, ["SHIPTO", "SHIP_TO", "SHIP TO", "CONSIGNATARIO"]);

  if (idxWarehouse === -1) {
    throw new Error("CSV must contain warehouse column.");
  }

  const map = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(delimiter);
    const warehouse = String(parts[idxWarehouse] ?? "").trim();
    const shipTo = idxShipTo !== -1 ? String(parts[idxShipTo] ?? "").trim() : "";

    if (!warehouse) continue;

    if (!map.has(warehouse)) {
      map.set(warehouse, { warehouse, shipTo });
    }
  }

  return Array.from(map.values());
}

async function fetchInventoryCsv(event) {
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.host;
  if (!host) throw new Error("Missing host header.");

  const url = `${proto}://${host}/inventarios.csv?ts=${Date.now()}`;
  const response = await fetch(url, {
    headers: { "cache-control": "no-store" }
  });

  if (!response.ok) {
    throw new Error(`Inventory CSV request failed with status ${response.status}.`);
  }

  return parseWarehousesCsv(await response.text());
}

function buildBaseResponse() {
  return {
    ...buildIssueTimestamp(),
    documentID: "",
    documentNumber: buildDocumentNumber(),
    variant: 0
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "method_not_allowed", message: "Only GET is allowed." });
  }

  try {
    const warehouses = await fetchInventoryCsv(event);

    return json(200, {
      ...buildBaseResponse(),
      errorCode: { errorCode: 0 },
      errorHeader: null,
      totalLineItemNumber: warehouses.length,
      warehouses
    });
  } catch (error) {
    console.error("catalog-warehouse error", error);

    return json(500, {
      ...buildBaseResponse(),
      errorCode: { errorCode: 304 },
      errorHeader: "Request to ERP - System disconnected",
      totalLineItemNumber: 0,
      warehouses: []
    });
  }
};
