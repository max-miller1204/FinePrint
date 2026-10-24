// Converts a Zod schema to the Gemini API's `responseSchema`, the OpenAPI 3.0
// subset the API constrains decoding with (spec §7.1). Zod stays the source of
// truth: the model is steered by this schema, then its output is validated by
// the Zod schema itself, so keywords the API cannot express are dropped here
// and still enforced by Zod.

import { z } from 'zod';

export interface ResponseSchema {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  description?: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  properties?: Record<string, ResponseSchema>;
  required?: string[];
  propertyOrdering?: string[];
  items?: ResponseSchema;
  anyOf?: ResponseSchema[];
  minItems?: string;
  maxItems?: string;
  minLength?: string;
  maxLength?: string;
  minimum?: number;
  maximum?: number;
}

type JsonSchema = Record<string, unknown>;

const TYPES = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
} as const;

// Constrained by Zod after the call, not by the API: regexes and most formats
// make the API reject the schema or slow decoding, and `additionalProperties`
// is not part of the subset.
const DROPPED = new Set(['$schema', 'additionalProperties', 'pattern', 'default', 'exclusiveMinimum', 'exclusiveMaximum', 'examples', 'title']);
const API_FORMATS = new Set(['date-time']);

export class UnsupportedSchemaError extends Error {
  constructor(path: string, reason: string) {
    super(`responseSchema cannot express ${reason} at ${path || '<root>'}`);
    this.name = 'UnsupportedSchemaError';
  }
}

export function toResponseSchema(schema: z.ZodType): ResponseSchema {
  // `io: 'output'` describes what the model must produce, after defaults apply.
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output', unrepresentable: 'throw' }) as JsonSchema;
  return convert(json, '');
}

function convert(node: JsonSchema, path: string): ResponseSchema {
  const out: ResponseSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED.has(key)) continue;
    switch (key) {
      case 'type': {
        const type = TYPES[value as keyof typeof TYPES];
        if (!type) throw new UnsupportedSchemaError(path, `type ${JSON.stringify(value)}`);
        out.type = type;
        break;
      }
      case 'description':
        out.description = value as string;
        break;
      case 'nullable':
        if (value === true) out.nullable = true;
        break;
      case 'enum': {
        const values = value as unknown[];
        if (!values.every((v) => typeof v === 'string')) throw new UnsupportedSchemaError(path, 'a non-string enum');
        out.enum = values as string[];
        break;
      }
      case 'format':
        if (API_FORMATS.has(value as string)) out.format = value as string;
        break;
      case 'properties': {
        const properties = value as Record<string, JsonSchema>;
        out.properties = Object.fromEntries(
          Object.entries(properties).map(([name, child]) => [name, convert(child, `${path}.${name}`)]),
        );
        // Without an ordering the API may emit keys in any order; Zod's key
        // order is the order the schema author wrote.
        out.propertyOrdering = Object.keys(properties);
        break;
      }
      case 'required':
        out.required = value as string[];
        break;
      case 'items':
        // Zod's OpenAPI 3.0 output already turns a tuple into an array of anyOf.
        out.items = convert(value as JsonSchema, `${path}[]`);
        break;
      case 'anyOf':
        out.anyOf = (value as JsonSchema[]).map((child, i) => convert(child, `${path}|${i}`));
        break;
      case 'minItems':
      case 'maxItems':
      case 'minLength':
      case 'maxLength':
        // The API takes int64 fields as strings.
        out[key] = String(value);
        break;
      case 'minimum':
      case 'maximum':
        // z.number().int() adds the safe-integer bounds; they constrain nothing.
        if (Math.abs(value as number) < Number.MAX_SAFE_INTEGER) out[key] = value as number;
        break;
      default:
        // $ref (recursive or registered schemas), allOf, not, and the rest.
        throw new UnsupportedSchemaError(path, `the "${key}" keyword`);
    }
  }
  return out;
}
