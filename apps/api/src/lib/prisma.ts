import { PrismaClient, Prisma } from '@prisma/client';

// Serialize Prisma Decimal values as JSON numbers (not strings) everywhere.
// Money fields (prices, totals, balances) are Decimal in the schema; without this
// JSON.stringify emits them as strings, which breaks numeric formatting and sums on the client.
(Prisma.Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (
  this: Prisma.Decimal,
): number {
  return this.toNumber();
};

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export default prisma;
