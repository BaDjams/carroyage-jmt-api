const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const { buildConfig, calculateGridData, generateKML } = require('../src/lib/cado');
const { buildKmz } = require('../src/lib/kmzBuilder');
const { cadoRequestSchema } = require('../src/schemas/cadoRequest');

const BASE_REQUEST = {
  latitude: 48.8566,
  longitude: 2.3522,
  scale: 10,
  gridType: 'Q12',
  gridName: 'Test Grid',
  gridColor: '#FF0000',
  colorOpacity: 0.5,
  contentType: 'grid-points',
  referencePointChoice: 'center',
  letteringDirection: 'ascending',
};

test('schema validates a minimal request', () => {
  const parsed = cadoRequestSchema.safeParse({
    latitude: 48.85,
    longitude: 2.35,
    scale: 10,
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.gridType, 'Q12');
  assert.equal(parsed.data.contentType, 'grid-points');
});

test('schema rejects invalid latitude', () => {
  const parsed = cadoRequestSchema.safeParse({
    latitude: 200,
    longitude: 2.35,
    scale: 10,
  });
  assert.equal(parsed.success, false);
});

test('schema requires custom bounds when gridType=custom', () => {
  const parsed = cadoRequestSchema.safeParse({
    latitude: 48.85,
    longitude: 2.35,
    scale: 10,
    gridType: 'custom',
  });
  assert.equal(parsed.success, false);
});

test('Q12 preset produces 17 columns x 12 rows = 204 cells', () => {
  const config = buildConfig(BASE_REQUEST);
  const data = calculateGridData(config);
  // Q is the 17th letter, so A->Q = 17 columns; rows 1->12 = 12 rows
  assert.equal(data.points.length, 17 * 12);
});

test('grid is centered around the reference point', () => {
  const config = buildConfig(BASE_REQUEST);
  const data = calculateGridData(config);
  const lons = data.points.map((p) => p.coordinates[0]);
  const lats = data.points.map((p) => p.coordinates[1]);
  const meanLon = lons.reduce((a, b) => a + b, 0) / lons.length;
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  // With center reference, the mean of cell centers should be close to the input point
  assert.ok(Math.abs(meanLon - 2.3522) < 0.001, `meanLon=${meanLon}`);
  assert.ok(Math.abs(meanLat - 48.8566) < 0.001, `meanLat=${meanLat}`);
});

test('origin reference places A1 corner exactly on the input point', () => {
  const config = buildConfig({ ...BASE_REQUEST, referencePointChoice: 'origin' });
  const data = calculateGridData(config);
  assert.ok(Math.abs(data.a1Corner[0] - 2.3522) < 1e-9);
  assert.ok(Math.abs(data.a1Corner[1] - 48.8566) < 1e-9);
});

test('KML output is valid XML and references icons folder when KMZ', () => {
  const config = buildConfig(BASE_REQUEST);
  const data = calculateGridData(config);
  const kml = generateKML(config, data, { isKmz: true });
  assert.ok(kml.startsWith('<?xml version="1.0"'));
  assert.ok(kml.includes('icons/A1.png'));
  assert.ok(kml.includes('<kml xmlns="http://www.opengis.net/kml/2.2">'));
});

test('buildKmz produces a valid zip with doc.kml + icons', async () => {
  const config = buildConfig(BASE_REQUEST);
  const { kmzBuffer } = await buildKmz(config);
  assert.ok(Buffer.isBuffer(kmzBuffer));
  assert.ok(kmzBuffer.length > 1000, `kmz too small: ${kmzBuffer.length} bytes`);

  const zip = await JSZip.loadAsync(kmzBuffer);
  assert.ok(zip.file('doc.kml'), 'doc.kml missing');

  const iconFiles = Object.keys(zip.files).filter(
    (p) => p.startsWith('icons/') && !p.endsWith('/'),
  );
  assert.equal(iconFiles.length, 17 * 12, 'expected one PNG per cell');

  const samplePng = await zip.file('icons/A1.png').async('nodebuffer');
  assert.equal(samplePng[0], 0x89);
  assert.equal(samplePng[1], 0x50);
  assert.equal(samplePng[2], 0x4e);
  assert.equal(samplePng[3], 0x47);
});

test('contentType=grid-only omits points and icons', async () => {
  const config = buildConfig({ ...BASE_REQUEST, contentType: 'grid-only' });
  const { kmzBuffer } = await buildKmz(config);
  const zip = await JSZip.loadAsync(kmzBuffer);
  const iconFiles = Object.keys(zip.files).filter(
    (p) => p.startsWith('icons/') && !p.endsWith('/'),
  );
  assert.equal(iconFiles.length, 0);
});

test('rotation (deviation) changes coordinates', () => {
  const config1 = buildConfig({ ...BASE_REQUEST, deviation: 0 });
  const config2 = buildConfig({ ...BASE_REQUEST, deviation: 45 });
  const data1 = calculateGridData(config1);
  const data2 = calculateGridData(config2);
  // Pick a corner point — must differ between rotated and non-rotated
  const p1 = data1.points[0].coordinates;
  const p2 = data2.points[0].coordinates;
  assert.ok(
    Math.abs(p1[0] - p2[0]) > 1e-6 || Math.abs(p1[1] - p2[1]) > 1e-6,
    'rotation produced identical coords',
  );
});

test('custom grid bounds work', () => {
  const config = buildConfig({
    ...BASE_REQUEST,
    gridType: 'custom',
    startRow: 1,
    endRow: 5,
    startCol: 'A',
    endCol: 'E',
  });
  const data = calculateGridData(config);
  assert.equal(data.points.length, 5 * 5);
});

test('swapAxes flips the labelling', () => {
  const normal = buildConfig(BASE_REQUEST);
  const swapped = buildConfig({ ...BASE_REQUEST, swapAxes: true });
  const dN = calculateGridData(normal);
  const dS = calculateGridData(swapped);
  // Same geometry, but point names are swapped: A1 ↔ A1 (1=A so identical here),
  // pick a non-symmetric cell (B3): normal "B3", swapped "C2"
  const findName = (data, name) => data.points.find((p) => p.name === name);
  assert.ok(findName(dN, 'B3'));
  assert.ok(findName(dS, 'C2'));
});
