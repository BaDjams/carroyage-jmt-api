const { z } = require('zod');
const { cadoRequestSchema } = require('./cadoRequest');

const imageRequestSchema = cadoRequestSchema.and(
  z.object({
    tileProvider: z
      .enum(['ign_ortho', 'ign_plan', 'osm', 'none'])
      .default('ign_ortho'),
    imageFormat: z.enum(['png', 'jpeg']).default('png'),
    jpegQuality: z.number().min(0).max(1).default(0.9),
    lineWidth: z.number().positive().max(20).default(1),
    upscale: z.boolean().default(true),
  }),
);

module.exports = { imageRequestSchema };
