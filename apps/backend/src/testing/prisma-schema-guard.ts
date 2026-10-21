import * as fs from 'fs';
import * as path from 'path';

/**
 * A Prisma-query-shape guard for UNIT tests.
 *
 * Why this exists (production incident 2026-10-21): the scanner's
 * "Process return" resolve crashed with
 * `Unknown field 'image' for select statement on model 'Product'` — a 500 on
 * a live flow — because the shared item include selected a scalar `image`
 * from Product (Product only has `images`). The unit tests never caught it
 * because a hand-rolled Prisma mock accepts ANY select: it never validates
 * the query against the schema.
 *
 * `withSchemaValidation(prismaMock)` wraps every mocked delegate so the
 * query shape is checked against the REAL `prisma/schema.prisma` BEFORE the
 * mock returns. An invalid field now fails the test with Prisma's own
 * message instead of shipping a 500.
 *
 * It is deliberately a schema-level check (no database needed), so it runs
 * everywhere: unit tests, CI, and any environment without a DB.
 */

export interface SchemaModel {
  name: string;
  /** Scalar fields (columns). */
  scalars: Set<string>;
  /** Relation fields → the model they point at. */
  relations: Map<string, string>;
}

const SCALARS = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
  'Unsupported',
]);

export function parsePrismaSchema(schemaPath: string): Map<string, SchemaModel> {
  const source = fs.readFileSync(schemaPath, 'utf8');
  const modelNames = new Set<string>();
  for (const m of source.matchAll(/^model\s+(\w+)\s*\{/gm)) modelNames.add(m[1]);

  const models = new Map<string, SchemaModel>();
  const blocks = source.match(/^model\s+\w+\s*\{[\s\S]*?^\}/gm) ?? [];
  for (const block of blocks) {
    const name = block.match(/^model\s+(\w+)/)![1];
    const model: SchemaModel = { name, scalars: new Set(), relations: new Map() };
    for (const line of block.split('\n')) {
      const field = line.match(/^\s{2}(\w+)\s+([\w\[\]?]+)/);
      if (!field) continue;
      const [, fieldName, rawType] = field;
      const type = rawType.replace(/[\[\]?]/g, '');
      if (SCALARS.has(type)) {
        model.scalars.add(fieldName);
      } else if (modelNames.has(type)) {
        model.relations.set(fieldName, type);
      }
    }
    models.set(name, model);
  }
  return models;
}

function relationTarget(
  models: Map<string, SchemaModel>,
  model: SchemaModel,
  field: string,
): string | null {
  return model.relations.get(field) ?? null;
}

/** Throws Prisma's own wording when a selected/included field is unknown. */
export function validatePrismaArgs(
  models: Map<string, SchemaModel>,
  modelName: string,
  args: any,
): void {
  const model = models.get(modelName);
  if (!model || !args) return;

  const walkSelect = (owner: SchemaModel, select: any, ownerName: string) => {
    if (!select || typeof select !== 'object') return;
    for (const [field, raw] of Object.entries(select)) {
      const value = raw as any;
      if (owner.scalars.has(field) || owner.relations.has(field)) {
        const target = relationTarget(models, owner, field);
        if (target && value && typeof value === 'object') {
          const targetModel = models.get(target);
          if (!targetModel) continue;
          walkSelect(targetModel, value.select, target);
          walkInclude(targetModel, value.include, target);
        }
        continue;
      }
      throw new Error(
        `Unknown field \`${field}\` for select statement on model \`${ownerName}\`.`,
      );
    }
  };

  const walkInclude = (owner: SchemaModel, include: any, ownerName: string) => {
    if (!include || typeof include !== 'object') return;
    for (const [field, raw] of Object.entries(include)) {
      const value = raw as any;
      const target = relationTarget(models, owner, field);
      if (!target) {
        if (owner.scalars.has(field)) {
          throw new Error(
            `Unknown field \`${field}\` for include statement on model \`${ownerName}\`.`,
          );
        }
        throw new Error(
          `Unknown field \`${field}\` for include statement on model \`${ownerName}\`.`,
        );
      }
      const targetModel = models.get(target);
      if (!targetModel || !value || typeof value !== 'object') continue;
      walkSelect(targetModel, value.select, target);
      walkInclude(targetModel, value.include, target);
    }
  };

  walkSelect(model, args.select, modelName);
  walkInclude(model, args.include, modelName);
}

const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../../prisma/schema.prisma');

/**
 * Wrap a hand-rolled Prisma mock so every query is validated against the
 * real schema. The mock functions keep their identity (and therefore their
 * call history) — only the implementation is wrapped.
 */
export function withSchemaValidation<T extends Record<string, any>>(
  prisma: T,
  schemaPath: string = DEFAULT_SCHEMA_PATH,
): T {
  const models = parsePrismaSchema(schemaPath);
  for (const [delegate, methods] of Object.entries(prisma)) {
    if (delegate.startsWith('$')) continue;
    if (!methods || typeof methods !== 'object') continue;
    const modelName = delegate.charAt(0).toUpperCase() + delegate.slice(1);
    if (!models.has(modelName)) continue;
    for (const method of Object.keys(methods)) {
      const fn = (methods as any)[method];
      if (typeof fn !== 'function') continue;
      if (
        typeof fn.getMockImplementation !== 'function' ||
        typeof fn.mockImplementation !== 'function'
      ) {
        continue;
      }
      const original = fn.getMockImplementation();
      fn.mockImplementation(async (...args: any[]) => {
        validatePrismaArgs(models, modelName, args[0]);
        return original ? await original(...args) : undefined;
      });
    }
  }
  return prisma;
}
