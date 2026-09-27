/** Shared helpers for shaping study-set DTOs (card counts + author names). */
import type { Database } from '../lib/db/repository.js';
import type { StudySetRecord } from '../lib/db/types.js';
import { dto } from '../lib/dto.js';

export type SetSummaryDto = ReturnType<typeof dto.setSummary>;

/** Builds summary DTOs for a batch of sets with card counts and author display names. */
export async function buildSetSummaries(
  db: Database,
  records: StudySetRecord[],
): Promise<SetSummaryDto[]> {
  if (records.length === 0) return [];

  const setIds = records.map((record) => record.id);
  const counts = await db.cards.countBySets(setIds);

  const ownerIds = [...new Set(records.map((record) => record.ownerId))];
  const owners = await Promise.all(ownerIds.map((ownerId) => db.profiles.get(ownerId)));
  const ownerNames = new Map<string, string>();
  for (let index = 0; index < ownerIds.length; index += 1) {
    ownerNames.set(ownerIds[index]!, owners[index]?.displayName ?? 'Lerno student');
  }

  return records.map((record) =>
    dto.setSummary(record, {
      cardCount: counts[record.id] ?? 0,
      authorName: ownerNames.get(record.ownerId) ?? 'Lerno student',
    }),
  );
}
