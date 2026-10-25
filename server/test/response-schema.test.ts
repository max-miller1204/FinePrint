import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnsupportedSchemaError, toResponseSchema } from '../src/ai/response-schema.js';

describe('toResponseSchema', () => {
  it('converts objects, enums, arrays, nullables, and literals', () => {
    const schema = z.object({
      severity: z.enum(['unenforceable', 'ask', 'info']).describe('How serious the finding is'),
      citation: z.string().nullable(),
      quotes: z.array(z.string()).min(1).max(3),
      pageCount: z.number().int().positive(),
      checkType: z.literal('semantic'),
      note: z.string().optional(),
      email: z.string().email(),
      at: z.iso.datetime(),
    });
    expect(toResponseSchema(schema)).toEqual({
      type: 'OBJECT',
      properties: {
        severity: { type: 'STRING', enum: ['unenforceable', 'ask', 'info'], description: 'How serious the finding is' },
        citation: { type: 'STRING', nullable: true },
        quotes: { type: 'ARRAY', items: { type: 'STRING' }, minItems: '1', maxItems: '3' },
        pageCount: { type: 'INTEGER', minimum: 0 },
        checkType: { type: 'STRING', enum: ['semantic'] },
        note: { type: 'STRING' },
        email: { type: 'STRING' },
        at: { type: 'STRING', format: 'date-time' },
      },
      required: ['severity', 'citation', 'quotes', 'pageCount', 'checkType', 'email', 'at'],
      propertyOrdering: ['severity', 'citation', 'quotes', 'pageCount', 'checkType', 'note', 'email', 'at'],
    });
  });

  it('converts unions to anyOf', () => {
    expect(toResponseSchema(z.union([z.string(), z.number()]))).toEqual({ anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }] });
  });

  it('refuses what the API cannot express', () => {
    const Node: z.ZodType = z.lazy(() => z.object({ children: z.array(Node) }));
    expect(() => toResponseSchema(Node)).toThrow(UnsupportedSchemaError);
    expect(() => toResponseSchema(z.object({ level: z.literal(3) }))).toThrow(/non-string enum/);
  });
});
