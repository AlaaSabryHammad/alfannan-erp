import { enforceLimit } from '../middleware/subscription';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { invalidateUserSessions } from '../lib/userSession';

/**
 * Privilege-escalation guard. Only an ADMIN may hand out the ADMIN role, touch an ADMIN account, or
 * change a role at all for themselves — otherwise anyone holding "users.edit" could make themselves admin.
 * Returns an Arabic error message when the action must be refused.
 */
async function escalationError(
  req: Request,
  opts: { targetUserId?: number; newRoleId?: number },
): Promise<string | null> {
  const caller = req.user!;
  if (caller.roleCode === 'ADMIN') return null;

  if (opts.newRoleId !== undefined) {
    const role = await prisma.role.findFirst({ where: { id: opts.newRoleId }, select: { code: true } });
    if (!role) return 'الدور غير موجود';
    if (role.code === 'ADMIN') return 'إسناد دور المدير العام لا يتم إلا بواسطة مدير عام';
    if (opts.targetUserId === caller.userId) return 'لا يمكنك تغيير دورك بنفسك';
  }
  if (opts.targetUserId !== undefined) {
    const target = await prisma.user.findFirst({
      where: { id: opts.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (target?.role.code === 'ADMIN') return 'لا يمكن تعديل حساب المدير العام إلا بواسطة مدير عام';
  }
  return null;
}

const router = Router();
router.use(requireAuth);

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  roleId: z.number().int().positive(),
  branchId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleId: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/users
router.get('/', requirePermission('users.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
          roleId: true,
          role: { select: { id: true, code: true, nameAr: true } },
          branch: { select: { id: true, nameAr: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', requirePermission('users.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        roleId: true,
        role: { select: { id: true, code: true, nameAr: true } },
        branch: { select: { id: true, nameAr: true } },
      },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// POST /api/users
router.post('/', requirePermission('users.create'), enforceLimit('users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password, ...rest } = createUserSchema.parse(req.body);
    const refused = await escalationError(req, { newRoleId: rest.roleId });
    if (refused) {
      res.status(403).json({ error: refused });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { ...rest, passwordHash },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        roleId: true,
        role: { select: { id: true, code: true, nameAr: true } },
        branch: { select: { id: true, nameAr: true } },
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id
router.put('/:id', requirePermission('users.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateUserSchema.parse(req.body);
    const { password, ...rest } = parsed;
    const targetId = parseInt(req.params.id);

    const refused = await escalationError(req, { targetUserId: targetId, newRoleId: rest.roleId });
    if (refused) {
      res.status(403).json({ error: refused });
      return;
    }

    const updateData: Record<string, unknown> = { ...rest };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
      updateData.sessionsValidAfter = new Date(); // a password set by someone else ends the old sessions
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        roleId: true,
        role: { select: { id: true, code: true, nameAr: true } },
        branch: { select: { id: true, nameAr: true } },
      },
    });

    invalidateUserSessions(req.user!.tenantId, targetId); // deactivation / role change apply at once
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id
router.delete('/:id', requirePermission('users.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Prevent self-deletion
    if (parseInt(req.params.id) === req.user!.userId) {
      res.status(400).json({ error: 'لا يمكن حذف حسابك الخاص' });
      return;
    }
    const refused = await escalationError(req, { targetUserId: parseInt(req.params.id) });
    if (refused) {
      res.status(403).json({ error: refused });
      return;
    }
    await prisma.user.delete({ where: { id: parseInt(req.params.id) } });
    invalidateUserSessions(req.user!.tenantId, parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default router;
