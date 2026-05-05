const { z } = require('zod');

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const COL_LETTERS = /^-?[A-Za-z]{1,3}$/;

const cadoRequestSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    scale: z.number().positive().max(100000),

    gridType: z
      .enum(['Q12', 'Z18', 'Z14', 'Q9', 'Z26', 'custom'])
      .default('Q12'),
    startRow: z.number().int().optional(),
    endRow: z.number().int().optional(),
    startCol: z.string().regex(COL_LETTERS).optional(),
    endCol: z.string().regex(COL_LETTERS).optional(),

    contentType: z
      .enum(['grid-only', 'points-only', 'grid-points'])
      .default('grid-points'),

    gridColor: z.string().regex(HEX_COLOR).default('#FF0000'),
    colorName: z.string().default('red'),
    colorOpacity: z.number().min(0).max(1).default(0.5),

    gridName: z.string().min(1).max(200).default('CADO Grid'),
    gridNameBase: z.string().min(1).max(200).optional(),

    deviation: z.number().min(-360).max(360).default(0),
    labelSize: z.number().min(0).max(10).default(1),
    iconSize: z.number().min(0).max(10).default(2),

    referencePointChoice: z.enum(['origin', 'center']).default('center'),
    letteringDirection: z.enum(['ascending', 'descending']).default('ascending'),

    swapAxes: z.boolean().default(false),
    doubleEntry: z.boolean().default(false),

    fileName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[\w\-. ]+$/)
      .optional(),
  })
  .refine(
    (data) => {
      if (data.gridType !== 'custom') return true;
      return (
        data.startRow !== undefined &&
        data.endRow !== undefined &&
        data.startCol !== undefined &&
        data.endCol !== undefined
      );
    },
    {
      message:
        'Custom gridType requires startRow, endRow, startCol, endCol',
      path: ['gridType'],
    },
  );

module.exports = { cadoRequestSchema };
