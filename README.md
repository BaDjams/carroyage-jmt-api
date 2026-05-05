# carroyage-jmt-api

REST API that generates **KMZ grid files identical** to those produced by [Carroyage-JMT](https://github.com/BaDjams/Carroyage-JMT) — for the **CADO** grid system.

Built with Node.js + Express + JSZip + `@napi-rs/canvas`.

---

## Features

- **POST `/api/kmz/cado`** — returns a binary KMZ file (`application/vnd.google-earth.kmz`) with:
  - `doc.kml` containing reference circle, A1 origin pushpin, grid lines, point placemarks, optional double-entry labels
  - `icons/<name>.png` — one 64×64 letter icon per cell, drawn server-side on canvas (matches the browser-side Carroyage-JMT output)
- **POST `/api/kmz/cado/preview`** — returns grid metadata (cell count, A1 corner, etc.) without generating the KMZ. Useful for client-side validation.
- Full Zod validation, CORS, helmet, request logging.
- Docker image, Docker Compose, automated tests via `node --test`.

---

## Quick start

### Local

```bash
npm install
npm start
# → API listening on http://0.0.0.0:3000
```

### Docker

```bash
docker compose up --build
```

### Tests

```bash
npm test
```

---

## API

### `POST /api/kmz/cado`

**Request body** (JSON) — minimal:

```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "scale": 10
}
```

**Full schema**:

| Field | Type | Default | Notes |
|---|---|---|---|
| `latitude` | number | required | -90..90 |
| `longitude` | number | required | -180..180 |
| `scale` | number | required | meters per cell, > 0 |
| `gridType` | enum | `"Q12"` | `Q12 \| Z18 \| Z14 \| Q9 \| Z26 \| custom` |
| `startRow`, `endRow` | int | — | required if `gridType=custom` |
| `startCol`, `endCol` | string | — | required if `gridType=custom`, e.g. `"A"`, `"-B"` |
| `contentType` | enum | `"grid-points"` | `grid-only \| points-only \| grid-points` |
| `gridColor` | string | `"#FF0000"` | hex `#RRGGBB` |
| `colorName` | string | `"red"` | only used in browser draw outlines; harmless here |
| `colorOpacity` | number | `0.5` | 0..1 |
| `gridName` | string | `"CADO Grid"` | KML `<name>` |
| `deviation` | number | `0` | rotation in degrees |
| `labelSize` | number | `1` | KML label scale (used when output is plain KML) |
| `iconSize` | number | `2` | KMZ icon scale |
| `referencePointChoice` | enum | `"center"` | `origin \| center` |
| `letteringDirection` | enum | `"ascending"` | `ascending \| descending` |
| `swapAxes` | boolean | `false` | swap letter/number axes |
| `doubleEntry` | boolean | `false` | add labels on opposite borders |
| `fileName` | string | — | optional KMZ file name (sanitized) |

**Grid presets**:

| ID | Columns | Rows | Total cells |
|---|---|---|---|
| `Q12` | A-Q (17) | 1-12 | 204 |
| `Z18` | A-Z (26) | 1-18 | 468 |
| `Z14` | A-Z (26) | 1-14 | 364 |
| `Q9` | A-Q (17) | 1-9 | 153 |
| `Z26` | A-Z (26) | 1-26 | 676 |

**Response**: `200 OK`, `Content-Type: application/vnd.google-earth.kmz`, body = KMZ binary.

Custom response headers:
- `X-Grid-Cells` — total number of points
- `X-Grid-Origin` — `"<lon>,<lat>"` of A1 corner

**Errors**: `400` with Zod issues array, `500` for unexpected.

### `POST /api/kmz/cado/preview`

Same body as `/cado`, returns JSON metadata only:

```json
{
  "config": { "...resolved config..." },
  "stats": {
    "cells": 204,
    "origin": [2.3399, 48.8513],
    "referenceCenter": [2.3522, 48.8566]
  }
}
```

### `GET /health`

Returns `{"status":"ok"}`.

---

## Examples

### Bash / curl

```bash
./examples/curl.sh
```

### PowerShell

```powershell
.\examples\curl.ps1
```

### Node fetch

```js
const res = await fetch('http://localhost:3000/api/kmz/cado', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    latitude: 48.8566, longitude: 2.3522, scale: 10,
    gridType: 'Z18', deviation: 30, doubleEntry: true,
  }),
});
const buf = Buffer.from(await res.arrayBuffer());
require('fs').writeFileSync('grid.kmz', buf);
```

---

## Architecture

```
src/
├── server.js              Express bootstrap, middlewares, error handler
├── routes/kmz.js          POST /api/kmz/cado(/preview)
├── lib/
│   ├── utilities.js       Geometry helpers (port of Carroyage-JMT/utilities.js)
│   ├── cado.js            buildConfig, calculateGridData, generateKML
│   └── kmzBuilder.js      JSZip + @napi-rs/canvas → KMZ buffer
└── schemas/cadoRequest.js Zod validation
```

The geometry math is a **direct port** of the browser code in `Carroyage-JMT/utilities.js` and `carroyageCado.js` — same rotation matrix, same A1 corner derivation, same letter/number index logic. The only Node-specific change is replacing the browser `Canvas` with `@napi-rs/canvas` for letter icons.

---

## Compatibility note

Output KMZ should be **byte-equivalent in geometry** to the browser version for any given config. Trivial differences may occur in:
- compression metadata (zip timestamps)
- icon antialiasing (Skia vs browser canvas)

If you need bit-exact output for diff tests, compare unzipped `doc.kml` content rather than the `.kmz` archive directly.

---

## License

MIT
