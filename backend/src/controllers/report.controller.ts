import type { Request, Response } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { reportService } from '../services/report-service.js';
import { adminService } from '../services/admin-service.js';
import type {
  AdminListQuery,
  CreateReportBody,
  ModerateSetBody,
  ResolveReportBody,
  SetRoleBody,
} from '../validators/report.validators.js';

export const reportController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.unauthorized();
    const body = req.body as CreateReportBody;
    sendOk(res, await reportService.create(req.db, req.auth.id, body), 201);
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as AdminListQuery;
    const db = req.db;
    const result = await reportService.list(db, {
      status: query.status,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    sendOk(res, {
      ...result,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),

  resolve: asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw errors.forbidden();
    const { reportId } = req.params as { reportId: string };
    const body = req.body as ResolveReportBody;
    sendOk(res, await reportService.resolve(req.db, req.auth.id, reportId, body.status));
  }),
};

export const adminController = {
  metrics: asyncHandler(async (_req: Request, res: Response) => {
    sendOk(res, await adminService.metrics());
  }),

  listUsers: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await adminService.listUsers(req.query as unknown as AdminListQuery));
  }),

  setRole: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as SetRoleBody;
    sendOk(res, await adminService.setRole(userId, body));
  }),

  deleteUser: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    sendOk(res, await adminService.deleteUser(userId));
  }),

  listPublicSets: asyncHandler(async (req: Request, res: Response) => {
    sendOk(res, await adminService.listPublicSets(req.query as unknown as AdminListQuery));
  }),

  moderateSet: asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.params as { setId: string };
    const body = req.body as ModerateSetBody;
    sendOk(res, await adminService.moderateSet(setId, body));
  }),
};
