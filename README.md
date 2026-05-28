# carroyage-jmt-api

REST API that generates **KMZ grid files and map images identical** to those produced by [Carroyage-JMT](https://github.com/BaDjams/Carroyage-JMT) — for the **CADO** grid system.

Built with Node.js + Express + JSZip + `@napi-rs/canvas`.

---

## Features

- **POST `/api/kmz/cado`** — returns a binary KMZ file (`application/vnd.google-earth.kmz`) with:
  - `doc.kml` containing reference circle, A1 origin pushpin, grid lines, point placemarks, optional double-entry labels
  - `icons/<name>.png` — one 64×64 letter icon per cell, drawn server-side on canvas (matches the browser-side Carroyage-JMT output)
- **POST `/api/kmz/cado/preview`** — returns grid metadata (cell count, A1 corner, etc.) without generating the KMZ. Useful for client-side validation.
- **POST `/api/image/cado`** — returns a PNG or JPEG image of the grid overlaid on a map background (IGN ortho, IGN plan, OSM, or blank).
- **Two-point zone mode** — provide `zonePoint1`/`zonePoint2` instead of a center coordinate to auto-compute grid bounds from a geographic bounding box.
- **GET `/api`** — lists all available endpoints.
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

**Request body** (JSON) — minimal (single-point mode):

```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "scale": 10
}
```

**Minimal — two-point zone mode** (grid auto-sized to cover the bounding box):

```json
{
  "zonePoint1": { "latitude": 48.84, "longitude": 2.32 },
  "zonePoint2": { "latitude": 48.87, "longitude": 2.38 },
  "scale": 10
}
```

**Full schema**:

| Field | Type | Default | Notes |
|---|---|---|---|
| `latitude` | number | — | -90..90. Required unless `zonePoint1`/`zonePoint2` provided |
| `longitude` | number | — | -180..180. Required unless `zonePoint1`/`zonePoint2` provided |
| `zonePoint1` | `{latitude, longitude}` | — | First corner for zone mode |
| `zonePoint2` | `{latitude, longitude}` | — | Second corner for zone mode |
| `scale` | number | required | meters per cell, > 0 |
| `gridType` | enum | `"Q12"` | `Q12 \| Z18 \| Z14 \| Q9 \| Z26 \| custom` (ignored in zone mode) |
| `startRow`, `endRow` | int | — | required if `gridType=custom` |
| `startCol`, `endCol` | string | — | required if `gridType=custom`, e.g. `"A"`, `"-B"` |
| `contentType` | enum | `"grid-points"` | `grid-only \| points-only \| grid-points` |
| `gridColor` | string | `"#FF0000"` | hex `#RRGGBB` |
| `colorName` | string | `"red"` | used for icon outline color selection |
| `colorOpacity` | number | `0.5` | 0..1 |
| `gridName` | string | `"CADO Grid"` | KML `<name>` |
| `gridNameBase` | string | — | optional base name (used in zone mode for auto-naming) |
| `deviation` | number | `0` | rotation in degrees |
| `labelSize` | number | `1` | KML label scale |
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

---

### `POST /api/kmz/cado/preview`

Same body as `/api/kmz/cado`, returns JSON metadata only:

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

In zone mode, `stats` also includes `zoneMode`, `zonePoint1`, `zonePoint2`, and `gridDimensions`.

---

### `POST /api/image/cado`

Generates a raster image of the CADO grid overlaid on a map background.

Accepts the same fields as `/api/kmz/cado`, plus:

| Field | Type | Default | Notes |
|---|---|---|---|
| `tileProvider` | enum | `"ign_ortho"` | `ign_ortho \| ign_plan \| osm \| none` |
| `imageFormat` | enum | `"png"` | `png \| jpeg` |
| `jpegQuality` | number | `0.9` | 0..1, only used when `imageFormat=jpeg` |
| `lineWidth` | number | `1` | grid line width in pixels, > 0, max 20 |
| `upscale` | boolean | `true` | upscale output for better resolution |

**Tile providers**:

| ID | Source | Layers |
|---|---|---|
| `ign_ortho` | Géoportail IGN | aerial photography + roads + place names |
| `ign_plan` | Géoportail IGN | IGN Plan V2 topographic map |
| `osm` | OpenStreetMap | standard tile layer |
| `none` | — | white background, no tiles downloaded |

**Response**: `200 OK`, `Content-Type: image/png` or `image/jpeg`, body = image binary.

Custom response headers:
- `X-Grid-Origin` — JSON-encoded origin coordinates

**Errors**: `400` validation, `500` for unexpected (includes tile limit exceeded).

---

### `GET /api`

Returns a JSON discovery document listing all endpoints.

---

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

### Node fetch — KMZ

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

### Node fetch — image (zone mode)

```js
const res = await fetch('http://localhost:3000/api/image/cado', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    zonePoint1: { latitude: 48.84, longitude: 2.32 },
    zonePoint2: { latitude: 48.87, longitude: 2.38 },
    scale: 50,
    tileProvider: 'ign_ortho',
    imageFormat: 'jpeg',
  }),
});
const buf = Buffer.from(await res.arrayBuffer());
require('fs').writeFileSync('grid.jpg', buf);
```

---

## Architecture

```
src/
├── server.js                Express bootstrap, middlewares, error handler
├── routes/
│   ├── kmz.js               POST /api/kmz/cado(/preview)
│   └── image.js             POST /api/image/cado
├── lib/
│   ├── utilities.js         Geometry helpers (port of Carroyage-JMT/utilities.js)
│   ├── cado.js              buildConfig, calculateGridData, generateKML
│   ├── kmzBuilder.js        JSZip + @napi-rs/canvas → KMZ buffer
│   ├── imageBuilder.js      Map tile compositing + grid drawing → PNG/JPEG buffer
│   └── tileDownloader.js    Tile fetching (IGN WMTS, OSM XYZ) + Mercator projection
└── schemas/
    ├── cadoRequest.js        Zod validation (KMZ + shared fields)
    └── imageRequest.js       Zod validation (image-specific fields, extends cadoRequest)
```

The geometry math is a **direct port** of the browser code in `Carroyage-JMT/utilities.js` and `carroyageCado.js` — same rotation matrix, same A1 corner derivation, same letter/number index logic. The only Node-specific change is replacing the browser `Canvas` with `@napi-rs/canvas` for letter icons and image generation.

---

## Compatibility note

Output KMZ should be **byte-equivalent in geometry** to the browser version for any given config. Trivial differences may occur in:
- compression metadata (zip timestamps)
- icon antialiasing (Skia vs browser canvas)

If you need bit-exact output for diff tests, compare unzipped `doc.kml` content rather than the `.kmz` archive directly.
