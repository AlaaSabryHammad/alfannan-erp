import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const deptSchema = z.object({
  nameAr: z.string().min(1),
  descriptionAr: z.string().optional().nullable(),
  parentId: z.number().int().optional().nullable(),
  icon: z.string().optional().nullable(),
});

type DeptNode = {
  id: number;
  nameAr: string;
  descriptionAr: string | null;
  parentId: number | null;
  icon: string | null;
  children: DeptNode[];
};

function buildTree(items: DeptNode[]): DeptNode[] {
  const map = new Map<number, DeptNode>();
  items.forEach(item => map.set(item.id, { ...item, children: [] }));
  const roots: DeptNode[] = [];
  map.forEach(item => {
    if (item.parentId === null) {
      roots.push(item);
    } else {
      const parent = map.get(item.parentId);
      if (parent) parent.children.push(item);
    }
  });
  return roots;
}

// GET /api/departments — returns tree
router.get('/', requirePermission('departments.view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const all = await prisma.department.findMany({ orderBy: { id: 'asc' } });
    const tree = buildTree(all as DeptNode[]);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

// GET /api/departments/flat — flat list
router.get('/flat', requirePermission('departments.view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const all = await prisma.department.findMany({ orderBy: { id: 'asc' } });
    res.json(all);
  } catch (err) {
    next(err);
  }
});

// POST /api/departments
router.post('/', requirePermission('departments.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = deptSchema.parse(req.body);
    const dept = await prisma.department.create({ data });
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

// PUT /api/departments/:id
router.put('/:id', requirePermission('departments.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = deptSchema.partial().parse(req.body);
    const dept = await prisma.department.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/departments/:id
router.delete('/:id', requirePermission('departments.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.department.delete({ where: { id: parseInt(req.params.id) } });
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
