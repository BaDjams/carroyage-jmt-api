'use strict';

// Port of imagetoprint.js / zoneDownloader.js tile-fetching logic.
// Runs server-side: uses native fetch (Node 18+) instead of browser Image loading.

const TILE_SIZE = 256;

// Mercator projection — identical to itpLatLonToWorldPixels() in imagetoprint.js
function latLonToWorldPixels(lat, lon, zoom) {
  const siny = Math.sin((lat * Math.PI) / 180);
  const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
  const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
  const x = (lon + 180) / 360;
  const mapSize = TILE_SIZE * Math.pow(2, zoom);
  return { x: x * mapSize, y: y * mapSize };
}

function coordsToQuadKey(x, y, zoom) {
  const digits = [];
  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((y & mask) !== 0) digit += 2;
    if ((x & mask) !== 0) digit += 1;
    digits.push(digit);
  }
  return digits.join('');
}

// Free public providers — no API key needed
const TILE_PROVIDERS = {
  ign_ortho: {
    maxZoom: 19,
    layers: [
      {
        type: 'xyz',
        url: 'https://data.geopf.fr/wmts?Layer=ORTHOIMAGERY.ORTHOPHOTOS&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
      },
      {
        type: 'xyz',
        url: 'https://data.geopf.fr/wmts?Layer=TRANSPORTNETWORKS.ROADS&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}',
      },
      {
        type: 'xyz',
        url: 'https://data.geopf.fr/wmts?Layer=GEOGRAPHICALNAMES.NAMES&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}',
      },
    ],
  },
  ign_plan: {
    maxZoom: 19,
    layers: [
      {
        type: 'xyz',
        url: 'https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}',
      },
    ],
  },
  osm: {
    maxZoom: 19,
    layers: [
      {
        type: 'xyz',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      },
    ],
  },
};

async function fetchTileBuffer(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'carroyage-jmt-api/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await mapper(items[i], i);
      }
    }),
  );
  return results;
}

// Builds a canvas at natural tile resolution compositing all provider layers.
// Returns { canvas, nwPx } where nwPx is the world-pixel coordinate of the NW corner.
async function buildTileCanvas(bbox, zoom, providerKey, { createCanvas, loadImage }) {
  const provider = TILE_PROVIDERS[providerKey];
  if (!provider) throw new Error(`Unknown tile provider: ${providerKey}`);

  const nwPx = latLonToWorldPixels(bbox.north, bbox.west, zoom);
  const sePx = latLonToWorldPixels(bbox.south, bbox.east, zoom);

  const nwTile = {
    x: Math.floor(nwPx.x / TILE_SIZE),
    y: Math.floor(nwPx.y / TILE_SIZE),
  };
  const seTile = {
    x: Math.floor(sePx.x / TILE_SIZE),
    y: Math.floor(sePx.y / TILE_SIZE),
  };

  const tileCountX = seTile.x - nwTile.x + 1;
  const tileCountY = seTile.y - nwTile.y + 1;
  const totalTiles = tileCountX * tileCountY * provider.layers.length;
  if (totalTiles > 800) {
    throw new Error(
      `Too many tiles requested (${totalTiles}). Reduce the zone size or increase the scale.`,
    );
  }

  const canvasW = Math.ceil(sePx.x - nwPx.x);
  const canvasH = Math.ceil(sePx.y - nwPx.y);

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (const layer of provider.layers) {
    const jobs = [];
    for (let tx = nwTile.x; tx <= seTile.x; tx++) {
      for (let ty = nwTile.y; ty <= seTile.y; ty++) {
        let url;
        if (layer.type === 'quadkey') {
          const q = coordsToQuadKey(tx, ty, zoom);
          const s = (tx + ty) % 4;
          url = layer.url.replace('{q}', q).replace('{s}', s);
        } else {
          url = layer.url
            .replace('{z}', zoom)
            .replace('{x}', tx)
            .replace('{y}', ty);
        }
        jobs.push({ url, tx, ty });
      }
    }

    await mapWithConcurrency(jobs, 8, async ({ url, tx, ty }) => {
      const buf = await fetchTileBuffer(url);
      if (!buf) return;
      try {
        const img = await loadImage(buf);
        const destX = Math.round(tx * TILE_SIZE - nwPx.x);
        const destY = Math.round(ty * TILE_SIZE - nwPx.y);
        ctx.drawImage(img, destX, destY, TILE_SIZE, TILE_SIZE);
      } catch {
        // skip corrupt tiles silently
      }
    });
  }

  return { canvas, nwPx };
}

module.exports = { latLonToWorldPixels, buildTileCanvas, TILE_PROVIDERS };
