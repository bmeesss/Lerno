/** Query-string / route-param helpers shared by list endpoints. */

import { ValidationError } from './errors.js';

function parsePositiveInt(raw: unknown, field: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(`Query parameter "${field}" must be a positive integer`);
  }
  return value;
}

export interface ListQuery {
  page: number;
  pageSize: number;
}

export function parseListQuery(query: Record<string, unknown>, maxPageSize = 100): ListQuery {
  return {
    page: parsePositiveInt(query.page, 'page', 1),
    pageSize:
      parsePositiveInt(query.pageSize, 'pageSize', 20) > maxPageSize
        ? maxPageSize
        : parsePositiveInt(query.pageSize, 'pageSize', 20),
  };
}

export function parseIntParam(raw: string | undefined, field: string): number {
  return parsePositiveInt(raw, field, NaN);
}
