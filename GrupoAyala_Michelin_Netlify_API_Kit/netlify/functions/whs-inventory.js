function detectDelimiter(headerLine) {
  const comma = headerLine.split(",").length;
  const semi = headerLine.split(";").length;
  return semi > comma ? ";" : ",";
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(h => h.trim().toUpperCase());

  const idxAlm  = headers.indexOf("ALMACEN");
  const idxShip = headers.indexOf("SHIPTO");
  const idxArt  = headers.indexOf("ARTICULO");
  const idxDisp = headers.indexOf("DISPONIBLE");

  if (idxAlm === -1 || idxShip === -1 || idxArt === -1 || idxDisp === -1) {
    throw new Error("CSV debe contener columnas: ALMACEN, SHIPTO, ARTICULO, DISPONIBLE");
  }

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(delimiter);
    if (row.length < headers.length) continue;

    const warehouse = String(row[idxAlm] ?? "").trim();
    const shipTo = String(row[idxShip] ?? "").trim();
    const article = String(row[idxArt] ?? "").trim();

    let dispRaw = String(row[idxDisp] ?? "").trim().replace(/,/g, ".");
    let available = parseFloat(dispRaw);
    if (Number.isNaN(available)) available = 0;

    if (!warehouse || !article) continue;

    out.push({ warehouse, shipTo, mspn: article, available: Math.round(available) });
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
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(obj, null, 2),
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
      return json(502, { ok: false, error: "CSV not reachable", status: res.status, csvUrl });
    }

    const csvText = await res.text();
    let items = parseCsv(csvText);

    if (warehouse) items = items.filter(x => x.warehouse === warehouse);
    if (mspn) items = items.filter(x => x.mspn === mspn);

    return json(200, {
      ok: true,
      query: { warehouse: warehouse || null, mspn: mspn || null },
      count: items.length,
      items,
      source: "inventarios.csv",
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
