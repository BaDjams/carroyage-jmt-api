'use strict';

const express = require('express');
const { imageRequestSchema } = require('../schemas/imageRequest');
const { buildConfig } = require('../lib/cado');
const { generateImage } = require('../lib/imageBuilder');

const router = express.Router();

function sanitizeFileName(name) {
  return name.replace(/[^\w\-. ]/g, '_');
}

router.post('/cado', async (req, res, next) => {
  try {
    const parsed = imageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        issues: parsed.error.issues,
      });
    }

    const {
      tileProvider,
      imageFormat,
      jpegQuality,
      lineWidth,
      upscale,
      fileName,
      ...cadoParams
    } = parsed.data;

    const config = buildConfig(cadoParams);

    const imageBuffer = await generateImage(config, {
      tileProvider,
      imageFormat,
      jpegQuality,
      lineWidth,
      upscale,
    });

    const ext = imageFormat === 'jpeg' ? 'jpg' : 'png';
    const mimeType = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';

    const baseName = fileName || `${config.gridName}.${ext}`;
    const filename = sanitizeFileName(
      baseName.endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`,
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Grid-Origin', JSON.stringify(config.isZoneMode
      ? { mode: 'zone', center: [config.longitude, config.latitude] }
      : [config.longitude, config.latitude]
    ));
    return res.status(200).send(imageBuffer);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
