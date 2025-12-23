function detectDelimiter(headerLine) {
  const comma = headerLine.split(",").length;
  const semi = headerLine.split(";").length;
  return semi > comma ? ";" : ",";
}

function normalizeHeader(h) {
  return (h || "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickDescriptionIndex(headersNorm) {
  const candidates = [
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
  ];
  for (const c of candidates) {
    const idx = headersNorm.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headersRaw = lines[0].split(delimiter);
  const headersNorm = headersRaw.map(normalizeHeader);

  const idxWhs = headersNorm.indexOf("ALMACEN");
  const idxShip = headersNorm.indexOf("SHIPTO");
  const idxMspn = headersNorm.indexOf("ARTICULO");
  const idxAvail = headersNorm.indexOf("DISPONIBLE");
  const idxDesc = pickDescriptionIndex(headersNorm);

  if (idxWhs === -1 || idxMspn === -1 || idxAvail === -1) {
    throw new Error("CSV debe contener columnas: ALMACEN, ARTICULO, DISPONIBLE (SHIPTO opcional).");
  }

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(delimiter);
    const warehouse = String(row[idxWhs] ?? "").trim();
    const shipTo = idxShip !== -1 ? String(row[idxShip] ?? "").trim() : "";
    const mspn = String(row[idxMspn] ?? "").trim();

    let availRaw = String(row[idxAvail] ?? "").trim().replace(/,/g, ".");
    let available = parseFloat(availRaw);
    if (Number.isNaN(available)) available = 0;

    const desc = idxDesc !== -1 ? String(row[idxDesc] ?? "").trim() : "";
    if (!warehouse || !mspn) continue;

    out.push({
      warehouse,
      shipTo,
      mspn,
      description: desc,
      available: Math.round(available)
    });
  }
  return out;
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,apikey,client-id"
    },
    body: JSON.stringify(obj, null, 2)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, { ok: true });

  try {
    const warehouse = (event.queryStringParameters?.warehouse || "").trim();
    const mspn = (event.queryStringParameters?.mspn || "").trim();

    const origin =
      event.headers["x-forwarded-proto"] && event.headers["host"]
        ? `${event.headers["x-forwarded-proto"]}://${event.headers["host"]}`
        : "";

    const csvUrl = `${origin}/inventarios.csv?ts=${Date.now()}`;
    const res = await fetch(csvUrl, { headers: { "cache-control": "no-store" } });
    if (!res.ok) {
      const d = new Date();
      return json(502, {
        issueDate: d.toISOString().slice(0, 10),
        issueTime: d.toTimeString().slice(0, 8),
        documentID: "C1",
        documentNumber: "00001",
        variant: "0",
        errorHeader: { errorCode: "2" },
        totalLineItemNumber: "0",
        contract: { documentID: "00001" },
        lineLevel: []
      });
    }

    let items = parseCsv(await res.text());
    if (warehouse) items = items.filter(x => x.warehouse === warehouse);
    if (mspn) items = items.filter(x => x.mspn === mspn);

    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
    const issueTime = now.toTimeString().slice(0, 8);

    const lineLevel = items.map((x) => ({
      lineId: String(x.mspn),
      article: {
        articleIdentification: {
          manufacturersArticleID: String(x.mspn),
          eanuccArticleID: String(x.mspn)
        },
        articleDescription: {
          articleDescriptionText: (x.description && x.description.length > 0) ? x.description : String(x.mspn)
        },
        scheduleDetails: {
          availableQuantity: {
            quantityValue: Number(x.available) || 0
          }
        }
      }
    }));

    return json(items.length ? 200 : 404, {
      issueDate,
      issueTime,
      documentID: "C1",
      documentNumber: "00001",
      variant: "0",
      errorHeader: { errorCode: "0" },
      totalLineItemNumber: String(lineLevel.length),
      contract: { documentID: "00001" },
      lineLevel
    });
  } catch (err) {
    const d = new Date();
    return json(500, {
      issueDate: d.toISOString().slice(0, 10),
      issueTime: d.toTimeString().slice(0, 8),
      documentID: "C1",
      documentNumber: "00001",
      variant: "0",
      errorHeader: { errorCode: "1" },
      totalLineItemNumber: "0",
      contract: { documentID: "00001" },
      lineLevel: []
    });
  }
};
