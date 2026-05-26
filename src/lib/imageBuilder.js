'use strict';

// Port of imagetoprint.js + utilities.js drawing functions.
// Identical algorithm to the browser app: pivot-based projection, straight grid over rotated map.

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  toRad,
  letterToNumber,
  numberToLetter,
  generateIndices,
  getNextIndex,
  calculateAndRotatePoint,
} = require('./utilities');
const { calculateGridData } = require('./cado');
const { latLonToWorldPixels, buildTileCanvas, TILE_PROVIDERS } = require('./tileDownloader');

// --- GEOMETRY HELPERS ---

// Same as getCadoCount() in imagetoprint.js
function getCadoCount(start, end) {
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  let count = max - min + 1;
  if (min < 0 && max > 0) count--;
  return count;
}

// Same as getCellOffsetFromOrigin() in imagetoprint.js
function getCellOffset(n) {
  return n > 0 ? n - 1 : n;
}

// Returns the AABB of the rotated grid at the given zoom (with buffer cells)
function getDownloadBBox(config, a1Corner, bufferCells) {
  const [a1Lon, a1Lat] = a1Corner;
  const sc = letterToNumber(config.startCol);
  const ec = letterToNumber(config.endCol);
  const sr = config.startRow;
  const er = config.endRow;

  // 4 outer corners of the grid
  const corners = [
    calculateAndRotatePoint(sc, sr, config, a1Lat, a1Lon),
    calculateAndRotatePoint(ec + 1, sr, config, a1Lat, a1Lon),
    calculateAndRotatePoint(sc, er + 1, config, a1Lat, a1Lon),
    calculateAndRotatePoint(ec + 1, er + 1, config, a1Lat, a1Lon),
  ];

  const lats = corners.map((p) => p[1]);
  const lons = corners.map((p) => p[0]);
  const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2;

  const bufLat = (bufferCells * config.scale) / 111320;
  const bufLon =
    (bufferCells * config.scale) / (111320 * Math.cos(toRad(centerLat)));

  return {
    north: Math.max(...lats) + bufLat,
    south: Math.min(...lats) - bufLat,
    east: Math.max(...lons) + bufLon,
    west: Math.min(...lons) - bufLon,
  };
}

// Same as calculateOptimalZoom() in imagetoprint.js
function calculateOptimalZoom(bbox, maxZoom) {
  const lonDiff = Math.abs(bbox.east - bbox.west);
  if (lonDiff === 0) return maxZoom;
  const targetWidthPx = 4000;
  const approx = Math.log2((360 * targetWidthPx) / (lonDiff * 256));
  return Math.min(Math.floor(approx), maxZoom);
}

// --- DRAWING FUNCTIONS — port of utilities.js (no DOM) ---

function drawLabelWithOutline(ctx, text, x, y, config) {
  const darkColors = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
  const outlineColor = darkColors.includes(config.colorName) ? 'white' : 'black';
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.max(3, (config.lineWidth || 1) * 2.5);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = config.gridColor;
  ctx.fillText(text, x, y);
}

function drawSubdivisionKey(ctx, latLonToPixels, config, a1Corner) {
  const [a1Lon, a1Lat] = a1Corner;
  const startColNum = letterToNumber(config.startCol);
  const southRowNum =
    config.letteringDirection === 'ascending'
      ? Math.min(config.startRow, config.endRow)
      : Math.max(config.startRow, config.endRow);
  const rowN =
    config.letteringDirection === 'ascending' ? southRowNum + 1 : southRowNum;
  const rowS =
    config.letteringDirection === 'ascending' ? southRowNum : southRowNum + 1;

  const gNW = calculateAndRotatePoint(startColNum, rowN, config, a1Lat, a1Lon);
  const gNE = calculateAndRotatePoint(startColNum + 1, rowN, config, a1Lat, a1Lon);
  const gSW = calculateAndRotatePoint(startColNum, rowS, config, a1Lat, a1Lon);
  const gSE = calculateAndRotatePoint(startColNum + 1, rowS, config, a1Lat, a1Lon);
  const gC = calculateAndRotatePoint(
    startColNum + 0.5,
    southRowNum + 0.5,
    config,
    a1Lat,
    a1Lon,
  );

  const pNW = latLonToPixels(gNW[1], gNW[0]);
  const pNE = latLonToPixels(gNE[1], gNE[0]);
  const pSW = latLonToPixels(gSW[1], gSW[0]);
  const pSE = latLonToPixels(gSE[1], gSE[0]);
  const pC = latLonToPixels(gC[1], gC[0]);

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const quad = (color, p1, p2, p3, p4) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();
  };

  // OTAN convention: Yellow=NW, Blue=NE, Green=SW, Red=SE
  quad('rgba(255,255,0,0.7)', pNW, mid(pNW, pNE), pC, mid(pNW, pSW));
  quad('rgba(0,0,255,0.7)', mid(pNW, pNE), pNE, mid(pNE, pSE), pC);
  quad('rgba(0,128,0,0.7)', mid(pNW, pSW), pC, mid(pSW, pSE), pSW);
  quad('rgba(255,0,0,0.7)', pC, mid(pNE, pSE), pSE, mid(pSW, pSE));

  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pNW.x, pNW.y);
  ctx.lineTo(pNE.x, pNE.y);
  ctx.lineTo(pSE.x, pSE.y);
  ctx.lineTo(pSW.x, pSW.y);
  ctx.closePath();
  ctx.stroke();
}

function drawReferenceCross(ctx, latLonToPixels, config, cellWidthPx) {
  if (config.referencePointChoice !== 'center') return;
  const center = latLonToPixels(config.latitude, config.longitude);
  const crossSize = cellWidthPx ? cellWidthPx / 5 : 20;
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = Math.max(3, (config.lineWidth || 1) * 2);
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - crossSize);
  ctx.lineTo(center.x, center.y + crossSize);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(center.x - crossSize, center.y);
  ctx.lineTo(center.x + crossSize, center.y);
  ctx.stroke();
}

function drawCartouche(ctx, latLonToPixels, config, a1Corner, cellWidthPx) {
  const [a1Lon, a1Lat] = a1Corner;
  const startColNum = letterToNumber(config.startCol);
  const topRowNum =
    config.letteringDirection === 'ascending'
      ? Math.max(config.startRow, config.endRow) + 1
      : Math.min(config.startRow, config.endRow);
  const anchorGeo = calculateAndRotatePoint(
    startColNum,
    topRowNum,
    config,
    a1Lat,
    a1Lon,
  );
  const anchorPx = latLonToPixels(anchorGeo[1], anchorGeo[0]);

  const fontSize = Math.max(12, cellWidthPx * 0.15);
  const padding = fontSize * 0.5;
  const lineSpacing = fontSize * 1.3;

  ctx.font = `${fontSize}px Arial`;

  const lines = [config.gridNameBase];
  if (config.referencePointChoice === 'center') {
    lines.push(
      `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`,
    );
  }
  lines.push(`Échelle: 1 case = ${config.scale}m`);

  const maxW = Math.max(...lines.map((t) => ctx.measureText(t).width));
  const cW = maxW + padding * 2;
  const cH = lineSpacing * lines.length + padding * 2;
  const cX = anchorPx.x + padding;
  const cY = anchorPx.y + padding;

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(cX, cY, cW, cH);
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.strokeRect(cX, cY, cW, cH);

  ctx.fillStyle = 'black';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let textY = cY + padding + lineSpacing / 2;

  for (const line of lines) {
    if (line.startsWith('Pt. Réf:')) {
      const cs = fontSize * 0.4;
      const cx2 = cX + padding + cs;
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx2 - cs, textY);
      ctx.lineTo(cx2 + cs, textY);
      ctx.moveTo(cx2, textY - cs);
      ctx.lineTo(cx2, textY + cs);
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillText(line, cx2 + cs + padding / 2, textY);
    } else {
      ctx.fillText(line, cX + padding, textY);
    }
    textY += lineSpacing;
  }
}

function drawCompass(ctx, latLonToPixels, config, a1Corner, cellWidthPx, forcedRotation) {
  const [a1Lon, a1Lat] = a1Corner;
  const endColNum = letterToNumber(config.endCol);
  const topRowNum =
    config.letteringDirection === 'ascending'
      ? Math.max(config.startRow, config.endRow)
      : Math.min(config.startRow, config.endRow);

  const centerGeo = calculateAndRotatePoint(
    endColNum + 0.5,
    topRowNum + 0.5,
    config,
    a1Lat,
    a1Lon,
  );
  const center = latLonToPixels(centerGeo[1], centerGeo[0]);
  const radius = cellWidthPx * 0.4;

  ctx.save();
  ctx.translate(center.x, center.y);

  let rotAngle = 0;
  if (forcedRotation !== null && forcedRotation !== undefined) {
    rotAngle = -toRad(forcedRotation);
  } else {
    const northGeoLat = centerGeo[1] + (config.scale * 2) / 111320;
    const northPx = latLonToPixels(northGeoLat, centerGeo[0]);
    rotAngle =
      Math.atan2(northPx.y - center.y, northPx.x - center.x) + Math.PI / 2;
  }
  ctx.rotate(rotAngle);

  // Circle background
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();

  const arrowLen = radius * 0.9;
  const arrowW = radius * 0.25;

  // North arrow (red)
  ctx.beginPath();
  ctx.moveTo(0, -arrowLen);
  ctx.lineTo(arrowW, 0);
  ctx.lineTo(-arrowW, 0);
  ctx.closePath();
  ctx.fillStyle = 'red';
  ctx.fill();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();

  // South arrow (white)
  ctx.beginPath();
  ctx.moveTo(0, arrowLen);
  ctx.lineTo(arrowW, 0);
  ctx.lineTo(-arrowW, 0);
  ctx.closePath();
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();

  // N label
  ctx.font = `bold ${radius * 0.6}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = radius * 0.15;
  ctx.strokeStyle = 'white';
  ctx.lineJoin = 'round';
  ctx.strokeText('N', 0, -arrowLen - radius * 0.1);
  ctx.fillStyle = 'black';
  ctx.fillText('N', 0, -arrowLen - radius * 0.1);

  ctx.restore();

  // Deviation text
  const devVal =
    forcedRotation !== null && forcedRotation !== undefined
      ? forcedRotation
      : config.deviation;
  if (devVal && Math.abs(devVal) > 0) {
    const sign = devVal > 0 ? '+' : '';
    ctx.font = `bold ${radius * 0.4}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.strokeText(`${sign}${devVal}°`, center.x, center.y + radius + 4);
    ctx.fillStyle = 'black';
    ctx.fillText(`${sign}${devVal}°`, center.x, center.y + radius + 4);
  }
}

// Port of drawCadoElementsOnCanvas() from utilities.js
function drawCadoGrid(ctx, config, latLonToPixels, a1Corner) {
  const [a1Lon, a1Lat] = a1Corner;
  const startColNum = letterToNumber(config.startCol);
  const endColNum = letterToNumber(config.endCol);
  const colsToDraw = generateIndices(startColNum, endColNum);
  const rowsToDraw = generateIndices(config.startRow, config.endRow);
  if (!colsToDraw.length || !rowsToDraw.length) return;

  const colsForLines = [...colsToDraw, getNextIndex(colsToDraw[colsToDraw.length - 1])];
  const rowsForLines = [...rowsToDraw, getNextIndex(rowsToDraw[rowsToDraw.length - 1])];

  ctx.strokeStyle = config.gridColor;
  ctx.lineWidth = config.lineWidth || 1;

  for (const colNum of colsForLines) {
    const s = calculateAndRotatePoint(colNum, rowsForLines[0], config, a1Lat, a1Lon);
    const e = calculateAndRotatePoint(
      colNum,
      rowsForLines[rowsForLines.length - 1],
      config,
      a1Lat,
      a1Lon,
    );
    const ps = latLonToPixels(s[1], s[0]);
    const pe = latLonToPixels(e[1], e[0]);
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(pe.x, pe.y);
    ctx.stroke();
  }

  for (const rowNum of rowsForLines) {
    const s = calculateAndRotatePoint(colsForLines[0], rowNum, config, a1Lat, a1Lon);
    const e = calculateAndRotatePoint(
      colsForLines[colsForLines.length - 1],
      rowNum,
      config,
      a1Lat,
      a1Lon,
    );
    const ps = latLonToPixels(s[1], s[0]);
    const pe = latLonToPixels(e[1], e[0]);
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(pe.x, pe.y);
    ctx.stroke();
  }

  // Cell size in pixels (for font scaling)
  const gA = calculateAndRotatePoint(
    startColNum + 0.5,
    config.startRow + 0.5,
    config,
    a1Lat,
    a1Lon,
  );
  const gB = calculateAndRotatePoint(
    startColNum + 1.5,
    config.startRow + 0.5,
    config,
    a1Lat,
    a1Lon,
  );
  const pA = latLonToPixels(gA[1], gA[0]);
  const pB = latLonToPixels(gB[1], gB[0]);
  const cellWidthPx = Math.hypot(pB.x - pA.x, pB.y - pA.y);

  if (cellWidthPx > 5) {
    const labelFontSize = cellWidthPx * 0.75;
    ctx.font = `bold ${labelFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Column labels
    for (const i of colsToDraw) {
      const lp = calculateAndRotatePoint(
        i + 0.5,
        config.startRow - 0.5,
        config,
        a1Lat,
        a1Lon,
      );
      const lpx = latLonToPixels(lp[1], lp[0]);
      drawLabelWithOutline(
        ctx,
        config.swapAxes ? i.toString() : numberToLetter(i),
        lpx.x,
        lpx.y,
        config,
      );
    }

    // Row labels
    for (const i of rowsToDraw) {
      const lp = calculateAndRotatePoint(
        startColNum - 0.5,
        i + 0.5,
        config,
        a1Lat,
        a1Lon,
      );
      const lpx = latLonToPixels(lp[1], lp[0]);
      drawLabelWithOutline(
        ctx,
        config.swapAxes ? numberToLetter(i) : i.toString(),
        lpx.x,
        lpx.y,
        config,
      );
    }

    // Double-entry labels
    if (config.doubleEntry) {
      const lastRow = rowsForLines[rowsForLines.length - 1];
      const lastCol = colsForLines[colsForLines.length - 1];
      for (const i of colsToDraw) {
        const lp = calculateAndRotatePoint(
          i + 0.5,
          lastRow + 0.5,
          config,
          a1Lat,
          a1Lon,
        );
        const lpx = latLonToPixels(lp[1], lp[0]);
        drawLabelWithOutline(
          ctx,
          config.swapAxes ? i.toString() : numberToLetter(i),
          lpx.x,
          lpx.y,
          config,
        );
      }
      for (const i of rowsToDraw) {
        const lp = calculateAndRotatePoint(
          lastCol + 0.5,
          i + 0.5,
          config,
          a1Lat,
          a1Lon,
        );
        const lpx = latLonToPixels(lp[1], lp[0]);
        drawLabelWithOutline(
          ctx,
          config.swapAxes ? numberToLetter(i) : i.toString(),
          lpx.x,
          lpx.y,
          config,
        );
      }
    }

    drawSubdivisionKey(ctx, latLonToPixels, config, a1Corner);
    drawCartouche(ctx, latLonToPixels, config, a1Corner, cellWidthPx);
    drawCompass(ctx, latLonToPixels, config, a1Corner, cellWidthPx, config.realDeviation);
    drawReferenceCross(ctx, latLonToPixels, config, cellWidthPx);
  }
}

// --- MAIN PIPELINE — port of generateImageToPrint() from imagetoprint.js ---

async function generateImage(config, options = {}) {
  const {
    tileProvider = 'ign_ortho',
    imageFormat = 'png',
    jpegQuality = 0.9,
    lineWidth = 1,
    upscale = true,
  } = options;

  // 1. Grid geometry
  const gridData = calculateGridData(config);
  const a1Corner = gridData.a1Corner;

  // 2. Download bounding box (2-cell buffer around rotated grid)
  const downloadBBox = getDownloadBBox(config, a1Corner, 2);

  // 3. Optimal zoom
  const provider = TILE_PROVIDERS[tileProvider];
  const maxZoom = provider ? provider.maxZoom : 19;
  const zoom = calculateOptimalZoom(downloadBBox, maxZoom);

  // 4. Natural tile canvas dimensions
  const nwPx = latLonToWorldPixels(downloadBBox.north, downloadBBox.west, zoom);
  const sePx = latLonToWorldPixels(downloadBBox.south, downloadBBox.east, zoom);
  const naturalH = Math.ceil(sePx.y - nwPx.y);

  // 5. Scale factor for upscaling (mirrors browser logic)
  const TARGET_HEIGHT = 2160;
  let scaleFactor = 1;
  if (upscale && naturalH < TARGET_HEIGHT) {
    scaleFactor = Math.min(TARGET_HEIGHT / naturalH, 16);
  }

  // 6. Pixels-per-meter at ref latitude (accounts for scaleFactor)
  const refLat = config.latitude;
  const metersPerPixel =
    (Math.cos(toRad(refLat)) * 2 * Math.PI * 6378137) /
    (256 * Math.pow(2, zoom));
  const pixelsPerMeter = scaleFactor / metersPerPixel;
  const scalePx = config.scale * pixelsPerMeter;

  // 7. Grid pixel dimensions
  const startColNum = letterToNumber(config.startCol);
  const endColNum = letterToNumber(config.endCol);
  const colsCount = getCadoCount(startColNum, endColNum);
  const rowsCount = getCadoCount(config.startRow, config.endRow);
  const gridWidthPx = colsCount * scalePx;
  const gridHeightPx = rowsCount * scalePx;

  // 8. Margins
  const marginLarge = scalePx * 1.0;
  const marginSmall = scalePx * 0.3;
  const marginLeft = marginLarge;
  const marginRight = config.doubleEntry ? marginLarge : marginSmall;
  let marginTop, marginBottom;
  if (config.letteringDirection === 'ascending') {
    marginTop = config.doubleEntry ? marginLarge : marginSmall;
    marginBottom = marginLarge;
  } else {
    marginTop = marginLarge;
    marginBottom = config.doubleEntry ? marginLarge : marginSmall;
  }

  const finalW = Math.ceil(gridWidthPx + marginLeft + marginRight);
  const finalH = Math.ceil(gridHeightPx + marginTop + marginBottom);

  // 9. Pivot placement (mirrors imagetoprint.js exactly)
  // config.latitude/longitude is always the pivot:
  //   - center mode: grid center
  //   - origin mode: A1 corner (set in buildConfig)
  const isCenterMode = config.referencePointChoice === 'center';
  const pivotGeoLat = config.latitude;
  const pivotGeoLon = config.longitude;
  const cosPivotLat = Math.cos(toRad(pivotGeoLat));

  let pivotFinalX, pivotFinalY;
  if (isCenterMode) {
    pivotFinalX = marginLeft + gridWidthPx / 2;
    pivotFinalY = marginTop + gridHeightPx / 2;
  } else {
    const colOffsetStart = getCellOffset(startColNum);
    const rowOffsetStart = getCellOffset(config.startRow);
    pivotFinalX = marginLeft - colOffsetStart * scalePx;
    if (config.letteringDirection === 'ascending') {
      pivotFinalY = finalH - marginBottom + rowOffsetStart * scalePx;
    } else {
      pivotFinalY = marginTop - rowOffsetStart * scalePx;
    }
  }

  // 10. Create final canvas
  const finalCanvas = createCanvas(finalW, finalH);
  const finalCtx = finalCanvas.getContext('2d');
  finalCtx.fillStyle = '#ffffff';
  finalCtx.fillRect(0, 0, finalW, finalH);

  // 11. Download tiles and draw background map (rotated around pivot)
  if (tileProvider !== 'none') {
    const { canvas: worldCanvas } = await buildTileCanvas(
      downloadBBox,
      zoom,
      tileProvider,
      { createCanvas, loadImage },
    );

    const pivotWorldPx = latLonToWorldPixels(pivotGeoLat, pivotGeoLon, zoom);
    const pivotOnWorldX = (pivotWorldPx.x - nwPx.x) * scaleFactor;
    const pivotOnWorldY = (pivotWorldPx.y - nwPx.y) * scaleFactor;

    finalCtx.save();
    finalCtx.translate(pivotFinalX, pivotFinalY);
    finalCtx.rotate(-toRad(config.deviation));
    // drawImage with explicit size = scaleFactor zoom
    finalCtx.drawImage(
      worldCanvas,
      -pivotOnWorldX,
      -pivotOnWorldY,
      worldCanvas.width * scaleFactor,
      worldCanvas.height * scaleFactor,
    );
    finalCtx.restore();
  }

  // 12. Draw grid overlay — straight (deviation=0), pivot-relative Cartesian pixels
  const drawConfig = {
    ...config,
    deviation: 0,
    realDeviation: config.deviation,
    lineWidth: lineWidth * scaleFactor,
  };

  const localLatLonToPixels = (lat, lon) => {
    const dLat = lat - pivotGeoLat;
    const dLon = lon - pivotGeoLon;
    const dY = dLat * 111320; // meters north
    const dX = dLon * 111320 * cosPivotLat; // meters east
    return {
      x: pivotFinalX + dX * pixelsPerMeter,
      y: pivotFinalY - dY * pixelsPerMeter, // canvas Y increases downward
    };
  };

  drawCadoGrid(finalCtx, drawConfig, localLatLonToPixels, a1Corner);

  // 13. Export
  if (imageFormat === 'jpeg') {
    return finalCanvas.toBuffer('image/jpeg', { quality: jpegQuality });
  }
  return finalCanvas.toBuffer('image/png');
}

module.exports = { generateImage };
