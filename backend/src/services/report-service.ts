/**
 * Report service — content reporting (spec §6 Admin, §15 abuse protection).
 * Reports are created by authenticated users; only admins can read/resolve.
 */
import type { Database } from '../lib/db/repository.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import type { CreateReportBody } from '../validators/report.validators.js';

export const reportService = {
  async create(db: Database, reporterId: string, input: CreateReportBody) {
    // The reporter must be able to see the target (public content or own).
    if (input.targetType === 'study_set') {
      const set = await db.sets.get(input.targetId);
      if (!set || (set.visibility !== 'public' && set.ownerId !== reporterId)) {
        throw errors.notFound('Content not found');
      }
    } else if (input.targetType === 'card') {
      const card = await db.cards.get(input.targetId);
      if (!card) throw errors.notFound('Content not found');
      const set = await db.sets.get(card.setId);
      if (!set || (set.visibility !== 'public' && set.ownerId !== reporterId)) {
        throw errors.notFound('Content not found');
      }
    } else {
      const profile = await db.profiles.get(input.targetId);
      if (!profile) throw errors.notFound('Content not found');
    }

    // Basic abuse protection: one open report per reporter/target pair.
    const existing = await db.reports.list({ limit: 100, offset: 0 });
    const duplicate = existing.find(
      (report) =>
        report.reporterId === reporterId &&
        report.targetId === input.targetId &&
        report.targetType === input.targetType &&
        report.status === 'open',
    );
    if (duplicate) {
      throw errors.conflict('You already have an open report for this content');
    }

    const report = await db.reports.create({
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ?? null,
    });
    return dto.report(report);
  },

  async list(db: Database, filter: { status?: string; limit: number; offset: number }) {
    const [reports, total] = await Promise.all([
      db.reports.list(filter),
      db.reports.count({ status: filter.status }),
    ]);
    return { items: reports.map(dto.report), total };
  },

  async resolve(db: Database, adminId: string, reportId: string, status: 'resolved' | 'dismissed') {
    const report = await db.reports.get(reportId);
    if (!report) throw errors.notFound('Report not found');
    const updated = await db.reports.update(reportId, {
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminId,
    });
    return dto.report(updated);
  },
};
