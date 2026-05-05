// Geometry and grid index utilities — port from Carroyage-JMT/utilities.js
// Browser-only helpers (DOM, canvas drawing) are intentionally omitted.

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

function letterToNumber(str) {
  if (!str || typeof str !== 'string') return 0;
  if (str.startsWith('-')) return -letterToNumber(str.substring(1));
  return str
    .toUpperCase()
    .split('')
    .reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

function numberToLetter(num) {
  if (num < 0) return '-' + numberToLetter(-num);
  if (num === 0) return '';
  let letter = '';
  let tempNum = num;
  while (tempNum > 0) {
    const remainder = (tempNum - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    tempNum = Math.floor((tempNum - 1) / 26);
  }
  return letter;
}

function generateIndices(start, end) {
  const indices = [];
  if (start <= end) {
    for (let i = start; i <= end; i++) if (i !== 0) indices.push(i);
  } else {
    for (let i = start; i >= end; i--) if (i !== 0) indices.push(i);
  }
  return indices;
}

const getOffsetInCells = (n) => (n > 0 ? n - 1 : n);
const getNextIndex = (n) => (n === -1 ? 1 : n + 1);

function calculateAndRotatePoint(colNumber, rowNumber, config, a1Lat, a1Lon) {
  const metersToLatDegrees = (meters) => meters / 111320;
  const metersToLonDegrees = (meters, lat) =>
    meters / (111320 * Math.cos(toRad(lat)));

  const xOffsetMeters =
    (colNumber > 0 ? colNumber - 1 : colNumber) * config.scale;
  const yOffsetMeters =
    (rowNumber > 0 ? rowNumber - 1 : rowNumber) * config.scale;

  const finalYOffset =
    config.letteringDirection === 'ascending' ? yOffsetMeters : -yOffsetMeters;

  const cosRefLat =
    config && config.latitude != null ? config.latitude : a1Lat;
  const unrotatedLon = a1Lon + metersToLonDegrees(xOffsetMeters, cosRefLat);
  const unrotatedLat = a1Lat + metersToLatDegrees(finalYOffset);

  if (config.deviation === 0 || !config.deviation) {
    return [unrotatedLon, unrotatedLat];
  }

  const pivotLon = config.longitude;
  const pivotLat = config.latitude;
  const deviationRad = -toRad(config.deviation);

  const cartesianX =
    (unrotatedLon - pivotLon) * 111320 * Math.cos(toRad(pivotLat));
  const cartesianY = (unrotatedLat - pivotLat) * 111320;

  const rotatedX =
    cartesianX * Math.cos(deviationRad) - cartesianY * Math.sin(deviationRad);
  const rotatedY =
    cartesianX * Math.sin(deviationRad) + cartesianY * Math.cos(deviationRad);

  const finalLon = pivotLon + metersToLonDegrees(rotatedX, pivotLat);
  const finalLat = pivotLat + metersToLatDegrees(rotatedY);

  return [finalLon, finalLat];
}

module.exports = {
  toRad,
  toDeg,
  letterToNumber,
  numberToLetter,
  generateIndices,
  getOffsetInCells,
  getNextIndex,
  calculateAndRotatePoint,
};
