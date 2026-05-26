const express = require('express');
const { cadoRequestSchema } = require('../schemas/cadoRequest');
const { buildConfig } = require('../lib/cado');
const { buildKmz } = require('../lib/kmzBuilder');

const router = express.Router();

function sanitizeFileName(name) {
  return name.replace(/[^\w\-. ]/g, '_');
}

router.post('/cado', async (req, res, next) => {
  try {
    const parsed = cadoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        issues: parsed.error.issues,
      });
    }

    const config = buildConfig(parsed.data);
    const { kmzBuffer, gridData } = await buildKmz(config);

    const baseName = parsed.data.fileName || `${config.gridName}.kmz`;
    const filename = sanitizeFileName(
      baseName.endsWith('.kmz') ? baseName : `${baseName}.kmz`,
    );

    res.setHeader('Content-Type', 'application/vnd.google-earth.kmz');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('X-Grid-Cells', String(gridData.points.length));
    res.setHeader('X-Grid-Origin', gridData.a1Corner.join(','));
    return res.status(200).send(kmzBuffer);
  } catch (err) {
    return next(err);
  }
});

router.post('/cado/preview', async (req, res, next) => {
  try {
    const parsed = cadoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        issues: parsed.error.issues,
      });
    }

    const config = buildConfig(parsed.data);
    const { calculateGridData } = require('../lib/cado');
    const gridData = calculateGridData(config);

    const stats = {
      rows: Math.abs(config.endRow - config.startRow) +
        (config.endRow * config.startRow < 0 ? 0 : 1),
      cells: gridData.points.length,
      origin: gridData.a1Corner,
      referenceCenter: [config.longitude, config.latitude],
    };

    if (config.isZoneMode) {
      stats.zoneMode = true;
      stats.zonePoint1 = parsed.data.zonePoint1;
      stats.zonePoint2 = parsed.data.zonePoint2;
      stats.gridDimensions = {
        columns: config.endCol,
        rows: config.endRow,
      };
    }

    return res.json({ config, stats });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
