// Assembles the final KMZ buffer: zips doc.kml + per-point letter PNG icons.
// Mirrors the Carroyage-JMT browser logic, but runs on Node with @napi-rs/canvas.

const JSZip = require('jszip');
const { createCanvas } = require('@napi-rs/canvas');
const { calculateGridData, generateKML } = require('./cado');

function renderLetterIcon(text, color) {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.clearRect(0, 0, 64, 64);
  ctx.fillText(text, 32, 32);

  if (color.toUpperCase() === '#FFFFFF') {
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeText(text, 32, 32);
  }

  return canvas.toBuffer('image/png');
}

async function buildKmz(config) {
  const gridData = calculateGridData(config);
  const kmlContent = generateKML(config, gridData, { isKmz: true });

  const zip = new JSZip();
  zip.file('doc.kml', kmlContent);

  if (config.includePoints) {
    const iconsFolder = zip.folder('icons');
    for (const point of gridData.points) {
      const pngBuffer = renderLetterIcon(point.name, config.gridColor);
      iconsFolder.file(`${point.name}.png`, pngBuffer);
    }
  }

  const kmzBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/vnd.google-earth.kmz',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { kmzBuffer, gridData };
}

module.exports = { buildKmz, renderLetterIcon };
