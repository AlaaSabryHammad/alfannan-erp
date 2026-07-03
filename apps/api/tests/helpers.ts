/**
 * Shared test helpers: the Express app driven by supertest, an admin token,
 * a prisma client on the test database, and the core accounting invariants.
 */
import request from 'supertest';
import { expect } from 'vitest';
import app from '../src/index';
import prisma from '../src/lib/prisma';

export { app, prisma };

let cachedToken: string | null = null;

export async function adminToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@store.com', password: '123456' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  cachedToken = res.body.token as string;
  return cachedToken;
}

export async function api(method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) {
  const token = await adminToken();
  const req = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${token}`);
  return body !== undefined ? req.send(body) : req;
}

/** Seeded fixtures every test can rely on. */
export async function fixtures() {
  const customer = await prisma.customer.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { isActive: true } });
  const balance = await prisma.stockBalance.findFirstOrThrow({
    where: { warehouseId: warehouse.id, quantity: { gt: 20 } },
    include: { product: true },
  });
  return { customer, supplier, warehouse, product: balance.product };
}

/**
 * The two invariants that must survive every flow:
 * 1. Σ debit == Σ credit across all journal lines (double entry).
 * 2. Every account's stored currentBalance equals opening + its journal net.
 */
export async function expectLedgerInvariants() {
  const agg = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  expect(Math.abs(Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0))).toBeLessThan(0.01);

  const accounts = await prisma.account.findMany();
  for (const acct of accounts) {
    const lines = await prisma.journalLine.aggregate({
      where: { accountId: acct.id },
      _sum: { debit: true, credit: true },
    });
    const debit = Number(lines._sum.debit ?? 0);
    const credit = Number(lines._sum.credit ?? 0);
    const isDebitNormal = acct.type === 'ASSET' || acct.type === 'EXPENSE';
    const expected = Number(acct.openingBalance) + (isDebitNormal ? debit - credit : credit - debit);
    expect(
      Math.abs(Number(acct.currentBalance) - expected),
      `account ${acct.code} ${acct.nameAr}: stored=${acct.currentBalance} derived=${expected}`,
    ).toBeLessThan(0.01);
  }
}
