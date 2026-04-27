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

function toInt(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(normalizeHeader);

  const idxWarehouse = pickIndex(headers, ["ALMACEN", "WAREHOUSE", "WHS"]);
  const idxShipTo = pickIndex(headers, ["SHIPTO", "SHIP_TO", "SHIP TO", "CONSIGNATARIO"]);
  const idxMspn = pickIndex(headers, ["ARTICULO", "MSPN", "SKU", "PRODUCTO"]);
  const idxAvailable = pickIndex(headers, ["DISPONIBLE", "AVAILABLE", "EXISTENCIA"]);
  const idxDescription = pickIndex(headers, [
    "DESCRIPCION",
    "DESCRIPCIONARTICULO",
    "DESCRIPCION_ARTICULO",
    "ARTICULODESCRIPCION",
    "ARTICULO_DESCRIPCION",
    "NOMBRE",
    "PRODUCTO",
    "MODELO",
    "DESCR",
    "DESCRIP",
    "DESC"
  ]);
  const idxEan = pickIndex(headers, ["EANUCC", "EAN", "CODIGOBARRAS", "CODIGO_BARRAS"]);

  if (idxWarehouse === -1 || idxMspn === -1 || idxAvailable === -1) {
    throw new Error("CSV must contain warehouse, mspn and available columns.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(delimiter);
    const warehouse = String(parts[idxWarehouse] ?? "").trim();
    const mspn = String(parts[idxMspn] ?? "").trim();
    if (!warehouse || !mspn) continue;

    rows.push({
      warehouse,
      shipTo: idxShipTo !== -1 ? String(parts[idxShipTo] ?? "").trim() : "",
      mspn,
      description: idxDescription !== -1 ? String(parts[idxDescription] ?? "").trim() : String(mspn),
      eanucc: idxEan !== -1 ? String(parts[idxEan] ?? "").trim() : "",
      available: toInt(parts[idxAvailable])
    });
  }

  return rows;
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

  return parseCsv(await response.text());
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
    const warehouse = String(event.queryStringParameters?.warehouse || "").trim();
    const mspn = String(event.queryStringParameters?.mspn || "").trim();

    if (!warehouse) {
      return json(400, {
        ...buildBaseResponse(),
        errorCode: { errorCode: 914 },
        errorHeader: "Missing warehouse",
        totalLineItemNumber: 0,
        lineLevel: []
      });
    }

    const items = await fetchInventoryCsv(event);
    let filtered = items.filter((item) => item.warehouse === warehouse);
    if (mspn) filtered = filtered.filter((item) => item.mspn === mspn);

    if (filtered.length === 0) {
      return json(404, {
        ...buildBaseResponse(),
        errorCode: { errorCode: 0 },
        errorHeader: null,
        totalLineItemNumber: 0,
        lineLevel: []
      });
    }

    const lineLevel = filtered.map((item) => ({
      lineId: String(item.mspn),
      article: {
        articleIdentification: {
          manufacturersArticleID: String(item.mspn),
          ...(item.eanucc ? { eanuccArticleID: String(item.eanucc) } : {})
        },
        articleDescription: {
          articleDescriptionText: item.description || String(item.mspn)
        },
        scheduleDetails: {
          availableQuantity: {
            quantityValue: item.available
          }
        }
      }
    }));

    return json(200, {
      ...buildBaseResponse(),
      errorCode: { errorCode: 0 },
      errorHeader: null,
      totalLineItemNumber: lineLevel.length,
      lineLevel
    });
  } catch (error) {
    console.error("whs-inventory error", error);

    return json(500, {
      ...buildBaseResponse(),
      errorCode: { errorCode: 304 },
      errorHeader: "Request to ERP - System disconnected",
      totalLineItemNumber: 0,
      lineLevel: []
    });
  }
};
