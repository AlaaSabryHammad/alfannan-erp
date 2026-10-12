/**
 * The departments page shows how many products each department holds.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };

type Dept = { id: number; nameAr: string; children: Dept[]; _count?: { products: number } };

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الأقسام ${stamp}`, adminName: 'مدير', email: `dept-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
});

describe('department product counts', () => {
  it('counts the products filed under each department (tree and flat)', async () => {
    const root = (await request(app).post('/api/departments').set(h).send({ nameAr: 'قسم رئيسي' })).body as Dept;
    const sub = (await request(app).post('/api/departments').set(h).send({ nameAr: 'قسم فرعي', parentId: root.id })).body as Dept;
    const empty = (await request(app).post('/api/departments').set(h).send({ nameAr: 'قسم فارغ' })).body as Dept;

    const make = (n: number, departmentId: number) =>
      request(app).post('/api/products').set(h)
        .send({ nameAr: `صنف ${n}`, sku: `D-${stamp}-${n}`, costPrice: 1, salePrice: 2, departmentId });
    expect((await make(1, root.id)).status).toBe(201);
    expect((await make(2, sub.id)).status).toBe(201);
    expect((await make(3, sub.id)).status).toBe(201);

    const tree = (await request(app).get('/api/departments').set(h)).body as Dept[];
    const r = tree.find((d) => d.id === root.id)!;
    expect(r._count?.products).toBe(1);
    expect(r.children[0]._count?.products).toBe(2);
    expect(tree.find((d) => d.id === empty.id)!._count?.products).toBe(0);

    const flat = (await request(app).get('/api/departments/flat').set(h)).body as Dept[];
    expect(flat.find((d) => d.id === sub.id)!._count?.products).toBe(2);
  });
});
