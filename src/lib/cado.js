// CADO grid data calculation — port from Carroyage-JMT/carroyageCado.js
// Pure functions: take a config, return geometry data. No DOM, no I/O.

const {
  toRad,
  letterToNumber,
  numberToLetter,
  generateIndices,
  getOffsetInCells,
  getNextIndex,
  calculateAndRotatePoint,
} = require('./utilities');

const GRID_PRESETS = {
  Q12: { startRow: 1, endRow: 12, startCol: 'A', endCol: 'Q' },
  Z18: { startRow: 1, endRow: 18, startCol: 'A', endCol: 'Z' },
  Z14: { startRow: 1, endRow: 14, startCol: 'A', endCol: 'Z' },
  Q9: { startRow: 1, endRow: 9, startCol: 'A', endCol: 'Q' },
  Z26: { startRow: 1, endRow: 26, startCol: 'A', endCol: 'Z' },
};

function resolveGridBounds(input) {
  if (input.gridType && input.gridType !== 'custom') {
    const preset = GRID_PRESETS[input.gridType];
    if (!preset) throw new Error(`Unknown gridType: ${input.gridType}`);
    return preset;
  }
  const { startRow, endRow, startCol, endCol } = input;
  if (
    startRow === undefined ||
    endRow === undefined ||
    !startCol ||
    !endCol
  ) {
    throw new Error(
      'Custom grid requires startRow, endRow, startCol, endCol',
    );
  }
  return {
    startRow: Number(startRow),
    endRow: Number(endRow),
    startCol: String(startCol).toUpperCase(),
    endCol: String(endCol).toUpperCase(),
  };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const deltaLatRad = toRad(lat2 - lat1);
  const deltaLonRad = toRad(lon2 - lon1);
  const a =
    Math.sin(deltaLatRad / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLonRad / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveZoneBounds(point1, point2, scale) {
  // Matches getZoneCadoConfigAndBounds() in zoneDownloader.js exactly:
  // - NW corner = (maxLat, minLon), SE corner = (minLat, maxLon)
  // - Width measured at nwLat via haversine (not centerLat flat approx)
  // - Height measured along meridian via haversine
  // - Reference point = center of zone → calculateGridData uses center mode
  const nwLat = Math.max(point1.latitude, point2.latitude);
  const seLat = Math.min(point1.latitude, point2.latitude);
  const nwLon = Math.min(point1.longitude, point2.longitude);
  const seLon = Math.max(point1.longitude, point2.longitude);

  const widthMeters = haversineDistance(nwLat, nwLon, nwLat, seLon);
  const heightMeters = haversineDistance(nwLat, nwLon, seLat, nwLon);

  const numCols = Math.max(1, Math.ceil(widthMeters / scale));
  const numRows = Math.max(1, Math.ceil(heightMeters / scale));

  return {
    latitude: (nwLat + seLat) / 2,
    longitude: (nwLon + seLon) / 2,
    startRow: 1,
    endRow: numRows,
    startCol: 'A',
    endCol: numberToLetter(numCols),
  };
}

function buildConfig(input) {
  const letteringDirection = input.letteringDirection || 'ascending';
  let bounds;
  let refLat = input.latitude;
  let refLon = input.longitude;
  let referencePointChoice = input.referencePointChoice || 'center';

  if (input.zonePoint1 && input.zonePoint2) {
    const zoneResult = resolveZoneBounds(
      input.zonePoint1,
      input.zonePoint2,
      Number(input.scale),
    );
    bounds = {
      startRow: zoneResult.startRow,
      endRow: zoneResult.endRow,
      startCol: zoneResult.startCol,
      endCol: zoneResult.endCol,
    };
    refLat = zoneResult.latitude;
    refLon = zoneResult.longitude;
    // 'center' mirrors 'no_cross' in the browser app: calculateGridData uses center-offset mode
    referencePointChoice = 'center';
  } else {
    bounds = resolveGridBounds(input);
  }

  const contentType = input.contentType || 'grid-points';
  const includeGrid = ['grid-only', 'grid-points'].includes(contentType);
  const includePoints = ['points-only', 'grid-points'].includes(contentType);

  return {
    latitude: Number(refLat),
    longitude: Number(refLon),
    scale: Number(input.scale),
    gridColor: input.gridColor || '#FF0000',
    colorName: input.colorName || 'red',
    colorOpacity: input.colorOpacity !== undefined ? Number(input.colorOpacity) : 0.5,
    gridName: input.gridName || 'CADO Grid',
    gridNameBase: input.gridNameBase || input.gridName || 'CADO Grid',
    deviation: input.deviation !== undefined ? Number(input.deviation) : 0,
    labelSize: input.labelSize !== undefined ? Number(input.labelSize) : 1,
    iconSize: input.iconSize !== undefined ? Number(input.iconSize) : 2,
    referencePointChoice,
    letteringDirection,
    startRow: bounds.startRow,
    endRow: bounds.endRow,
    startCol: bounds.startCol,
    endCol: bounds.endCol,
    includeGrid,
    includePoints,
    swapAxes: !!input.swapAxes,
    doubleEntry: !!input.doubleEntry,
    isZoneMode: !!(input.zonePoint1 && input.zonePoint2),
  };
}

function generateCirclePoints(lon, lat, radiusMeters, segments) {
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const pointLon = lon + dx / (111320 * Math.cos(toRad(lat)));
    const pointLat = lat + dy / 111320;
    out.push([pointLon, pointLat]);
  }
  return out;
}

function calculateGridData(config) {
  const metersToLatDegrees = (m) => m / 111320;
  const metersToLonDegrees = (m, lat) => m / (111320 * Math.cos(toRad(lat)));

  let a1CornerLat;
  let a1CornerLon;
  const refLat = config.latitude;
  const refLon = config.longitude;

  if (config.referencePointChoice === 'origin') {
    a1CornerLat = refLat;
    a1CornerLon = refLon;
  } else {
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);

    const calculateCenterOffsetInCells = (start, end) => {
      const indices = generateIndices(start, end);
      const numCells = indices.length;
      const startOffset = getOffsetInCells(indices[0]);
      if (numCells % 2 === 0) {
        return startOffset + numCells / 2;
      }
      return startOffset + Math.floor(numCells / 2) + 0.5;
    };

    const centerColOffset = calculateCenterOffsetInCells(startColNum, endColNum);
    const centerRowOffset = calculateCenterOffsetInCells(
      config.startRow,
      config.endRow,
    );

    const xOffsetMeters = centerColOffset * config.scale;
    const yOffsetMeters = centerRowOffset * config.scale;

    a1CornerLon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
    if (config.letteringDirection === 'ascending') {
      a1CornerLat = refLat - metersToLatDegrees(yOffsetMeters);
    } else {
      a1CornerLat = refLat + metersToLatDegrees(yOffsetMeters);
    }
  }

  const horizontalLines = [];
  const verticalLines = [];
  const points = [];

  const rowsToDraw = generateIndices(config.startRow, config.endRow);
  const colsToDraw = generateIndices(
    letterToNumber(config.startCol),
    letterToNumber(config.endCol),
  );
  const rowsForLines = [
    ...rowsToDraw,
    getNextIndex(rowsToDraw[rowsToDraw.length - 1]),
  ];
  const colsForLines = [
    ...colsToDraw,
    getNextIndex(colsToDraw[colsToDraw.length - 1]),
  ];

  const ptCache = new Map();
  const getIntersection = (col, row) => {
    const key = `${col},${row}`;
    let p = ptCache.get(key);
    if (!p) {
      p = calculateAndRotatePoint(col, row, config, a1CornerLat, a1CornerLon);
      ptCache.set(key, p);
    }
    return p;
  };

  rowsForLines.forEach((rowNum, idx) => {
    const isLast = idx === rowsForLines.length - 1;
    horizontalLines.push({
      name: isLast ? '' : String(rowNum),
      points: colsForLines.map((c) => getIntersection(c, rowNum)),
    });
  });

  colsForLines.forEach((colNum, idx) => {
    const isLast = idx === colsForLines.length - 1;
    verticalLines.push({
      name: isLast ? '' : numberToLetter(colNum),
      points: rowsForLines.map((r) => getIntersection(colNum, r)),
    });
  });

  for (const row of rowsToDraw) {
    for (const col of colsToDraw) {
      const coords = calculateAndRotatePoint(
        col + 0.5,
        row + 0.5,
        config,
        a1CornerLat,
        a1CornerLon,
      );
      const pointName = config.swapAxes
        ? `${numberToLetter(row)}${col}`
        : `${numberToLetter(col)}${row}`;
      points.push({ name: pointName, coordinates: coords });
    }
  }

  const originPointCoords = calculateAndRotatePoint(
    1,
    1,
    config,
    a1CornerLat,
    a1CornerLon,
  );
  const originPlacemarkName = `Origine A1: ${originPointCoords[1].toFixed(6)}, ${originPointCoords[0].toFixed(6)}`;

  return {
    horizontalLines,
    verticalLines,
    points,
    originPointPlacemark: {
      name: originPlacemarkName,
      coordinates: originPointCoords,
    },
    referencePointCircle: generateCirclePoints(
      config.longitude,
      config.latitude,
      config.scale / 4,
      36,
    ),
    a1Corner: [a1CornerLon, a1CornerLat],
  };
}

function rgbToKmlColor(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16).toString(16).padStart(2, '0');
  const g = parseInt(hex.slice(3, 5), 16).toString(16).padStart(2, '0');
  const b = parseInt(hex.slice(5, 7), 16).toString(16).padStart(2, '0');
  const a = Math.floor(255 * opacity).toString(16).padStart(2, '0');
  return `${a}${b}${g}${r}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateKML(config, gridData, { isKmz }) {
  const iconScale = isKmz ? config.iconSize : 0;
  const labelScale = isKmz ? 0 : config.labelSize;
  const labelColor = rgbToKmlColor(config.gridColor, 1);
  const lineColor = rgbToKmlColor(config.gridColor, config.colorOpacity);

  const p = [];
  p.push(
    `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(config.gridName)}</name>`,
  );

  p.push(
    `<Style id="gridLineStyle"><LineStyle><color>${lineColor}</color><width>2</width></LineStyle></Style>`,
  );
  p.push(
    `<Style id="referenceCircleStyle"><LineStyle><color>a000ffff</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`,
  );
  p.push(
    `<Style id="originPointStyle"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon><scale>1.1</scale></IconStyle></Style>`,
  );

  if (config.includePoints) {
    p.push(
      `<Style id="gridPointStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${labelColor}</color><scale>${labelScale}</scale></LabelStyle></Style>`,
    );
  }

  p.push('<Folder><name>Carroyage CADO</name>');

  p.push(
    `<Placemark><name>Point de Référence</name><styleUrl>#referenceCircleStyle</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${gridData.referencePointCircle
      .map((pt) => `${pt[0]},${pt[1]},0`)
      .join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`,
  );

  p.push(
    `<Placemark><name>${escapeXml(gridData.originPointPlacemark.name)}</name><styleUrl>#originPointStyle</styleUrl><Point><coordinates>${gridData.originPointPlacemark.coordinates.join(',')},0</coordinates></Point></Placemark>`,
  );

  if (config.includeGrid) {
    p.push('<Folder><name>Lignes</name>');
    [...gridData.horizontalLines, ...gridData.verticalLines].forEach((line) => {
      p.push(
        `<Placemark><name>${escapeXml(line.name)}</name><styleUrl>#gridLineStyle</styleUrl><LineString><tessellate>1</tessellate><coordinates>${line.points
          .map((pt) => `${pt[0]},${pt[1]},0`)
          .join(' ')}</coordinates></LineString></Placemark>`,
      );
    });
    p.push('</Folder>');
  }

  if (config.includePoints) {
    p.push('<Folder><name>Points</name>');
    gridData.points.forEach((point) => {
      const styleBlock = isKmz
        ? `<Style><IconStyle><scale>${iconScale}</scale><Icon><href>icons/${escapeXml(point.name)}.png</href></Icon></IconStyle><LabelStyle><color>${labelColor}</color><scale>${labelScale}</scale></LabelStyle></Style>`
        : `<styleUrl>#gridPointStyle</styleUrl>`;
      p.push(
        `<Placemark><name>${escapeXml(point.name)}</name>${styleBlock}<Point><coordinates>${point.coordinates.join(',')},0</coordinates></Point></Placemark>`,
      );
    });
    p.push('</Folder>');
  }

  if (config.doubleEntry && config.includeGrid) {
    const [a1Lon, a1Lat] = gridData.a1Corner;
    const colsToDraw = generateIndices(
      letterToNumber(config.startCol),
      letterToNumber(config.endCol),
    );
    const rowsToDraw = generateIndices(config.startRow, config.endRow);
    const rowsForLines = [
      ...rowsToDraw,
      getNextIndex(rowsToDraw[rowsToDraw.length - 1]),
    ];
    const colsForLines = [
      ...colsToDraw,
      getNextIndex(colsToDraw[colsToDraw.length - 1]),
    ];
    const lastRow = rowsForLines[rowsForLines.length - 1];
    const lastCol = colsForLines[colsForLines.length - 1];

    p.push(
      `<Style id="borderLabelStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${labelColor}</color><scale>${config.labelSize || 1}</scale></LabelStyle></Style>`,
    );
    p.push('<Folder><name>Labels Double Entrée</name>');

    colsToDraw.forEach((i) => {
      const coords = calculateAndRotatePoint(
        i + 0.5,
        lastRow + 0.5,
        config,
        a1Lat,
        a1Lon,
      );
      const text = config.swapAxes ? String(i) : numberToLetter(i);
      p.push(
        `<Placemark><name>${escapeXml(text)}</name><styleUrl>#borderLabelStyle</styleUrl><Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`,
      );
    });
    rowsToDraw.forEach((i) => {
      const coords = calculateAndRotatePoint(
        lastCol + 0.5,
        i + 0.5,
        config,
        a1Lat,
        a1Lon,
      );
      const text = config.swapAxes ? numberToLetter(i) : String(i);
      p.push(
        `<Placemark><name>${escapeXml(text)}</name><styleUrl>#borderLabelStyle</styleUrl><Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`,
      );
    });
    p.push('</Folder>');
  }

  p.push('</Folder></Document></kml>');
  return p.join('');
}

module.exports = {
  buildConfig,
  calculateGridData,
  generateKML,
  rgbToKmlColor,
  GRID_PRESETS,
};
