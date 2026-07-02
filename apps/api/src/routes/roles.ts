import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/roles — list all roles with permission codes and counts
router.get('/', requirePermission('roles.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: {
        permissions: {
          include: { permission: { select: { id: true, code: true, group: true, nameAr: true } } },
        },
        _count: { select: { users: true } },
      },
    });

    const result = roles.map(r => ({
      id: r.id,
      code: r.code,
      nameAr: r.nameAr,
      description: r.description,
      userCount: r._count.users,
      permissionCount: r.permissions.length,
      permissions: r.permissions.map(rp => rp.permission),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Built-in roles cannot be deleted (the system seeds and depends on them).
const BUILTIN_ROLE_CODES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STOREKEEPER', 'CASHIER'];

// POST /api/roles — create a new role (optionally with an initial permission set)
router.post('/', requirePermission('roles.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      code: z
        .string()
        .min(2)
        .regex(/^[A-Z][A-Z0-9_]*$/, 'الرمز يجب أن يكون أحرفاً إنجليزية كبيرة وأرقاماً وشرطة سفلية'),
      nameAr: z.string().min(1),
      description: z.string().optional().nullable(),
      permissionCodes: z.array(z.string()).optional(),
    });
    const data = schema.parse(req.body);

    const exists = await prisma.role.findUnique({ where: { code: data.code } });
    if (exists) {
      res.status(400).json({ error: 'يوجد دور بنفس الرمز بالفعل' });
      return;
    }

    const permissions = data.permissionCodes?.length
      ? await prisma.permission.findMany({ where: { code: { in: data.permissionCodes } } })
      : [];

    const role = await prisma.role.create({
      data: {
        code: data.code,
        nameAr: data.nameAr,
        description: data.description ?? null,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      include: {
        permissions: { include: { permission: { select: { id: true, code: true, group: true, nameAr: true } } } },
        _count: { select: { users: true } },
      },
    });

    res.status(201).json({
      id: role.id,
      code: role.code,
      nameAr: role.nameAr,
      description: role.description,
      userCount: role._count.users,
      permissionCount: role.permissions.length,
      permissions: role.permissions.map((rp) => rp.permission),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/roles/:id — delete a custom role (built-in roles and roles in use are protected)
router.delete('/:id', requirePermission('roles.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roleId = parseInt(req.params.id);
    const role = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: { _count: { select: { users: true } } },
    });

    if (BUILTIN_ROLE_CODES.includes(role.code)) {
      res.status(400).json({ error: 'لا يمكن حذف الأدوار الأساسية في النظام' });
      return;
    }
    if (role._count.users > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الدور لوجود مستخدمين مرتبطين به' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId } });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/roles/:id/permissions — replace a role's permission set
router.put('/:id/permissions', requirePermission('roles.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ permissionCodes: z.array(z.string()) });
    const { permissionCodes } = schema.parse(req.body);

    const roleId = parseInt(req.params.id);

    const permissions = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const perm of permissions) {
        await tx.rolePermission.create({
          data: { roleId, permissionId: perm.id },
        });
      }
    });

    const updated = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: { select: { id: true, code: true, group: true, nameAr: true } } },
        },
      },
    });

    res.json({
      id: updated.id,
      code: updated.code,
      nameAr: updated.nameAr,
      description: updated.description,
      permissions: updated.permissions.map(rp => rp.permission),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
