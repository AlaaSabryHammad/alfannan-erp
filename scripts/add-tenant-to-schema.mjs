// One-off codemod: adds multi-tenancy (tenantId + Tenant relation) to every business model in
// apps/api/prisma/schema.prisma and turns business-key @unique String fields into per-tenant uniques.
// Usage: node scripts/add-tenant-to-schema.mjs <schema.prisma>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const GLOBAL_MODELS = new Set(['Permission', 'RolePermission', 'Tenant']);
const KEEP_GLOBAL_UNIQUE = new Map([['User', new Set(['email'])]]); // login is by email → globally unique
const DEFAULT = `@default(dbgenerated("(current_setting('app.tenant_id'::text))::integer"))`;

const lines = readFileSync(file, 'utf8').split('\n');
const out = [];
const tenantModels = [];
let i = 0;
while (i < lines.length) {
  const m = /^model (\w+) \{/.exec(lines[i]);
  if (!m || GLOBAL_MODELS.has(m[1])) { out.push(lines[i++]); continue; }
  const name = m[1];
  const block = [];
  i++;
  while (!/^\}/.test(lines[i])) block.push(lines[i++]);
  i++; // closing brace
  tenantModels.push(name);

  const uniques = [];
  const body = block.map((l) => {
    if (name === 'Setting' && /^\s+key\s+String\s+@id\s*$/.test(l)) return l.replace('@id', '').trimEnd();
    const f = /^(\s+)(\w+)(\s+)String(\??)(\s+)@unique(.*)$/.exec(l);
    if (f && !KEEP_GLOBAL_UNIQUE.get(name)?.has(f[2])) {
      uniques.push(f[2]);
      return `${f[1]}${f[2]}${f[3]}String${f[4]}${f[6] ? ' ' + f[6].trim() : ''}`.trimEnd();
    }
    if (name === 'FiscalPeriod' && l.includes('@@unique([year, month])')) return l.replace('[year, month]', '[tenantId, year, month]');
    return l;
  });

  const extra = [
    `  tenantId     Int ${DEFAULT}`,
    `  tenant       Tenant @relation(fields: [tenantId], references: [id])`,
  ];
  // insert right after the first field line (the id), or at the top for Setting (composite id)
  const idx = name === 'Setting' ? 0 : body.findIndex((l) => /@id\b/.test(l)) + 1;
  body.splice(idx, 0, ...extra);
  // trim trailing blank lines then add block-level attributes
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  body.push('');
  if (name === 'Setting') body.push('  @@id([tenantId, key])');
  for (const u of uniques) body.push(`  @@unique([tenantId, ${u}])`);
  body.push('  @@index([tenantId])');
  out.push(`model ${name} {`, ...body, '}');
}

const lower = (s) => s[0].toLowerCase() + s.slice(1);
out.push(
  '',
  '// ── TENANTS (SaaS) ────────────────────────────────────────────────────────────',
  '',
  'model Tenant {',
  '  id        Int      @id @default(autoincrement())',
  '  name      String',
  '  slug      String   @unique',
  '  isActive  Boolean  @default(true)',
  '  createdAt DateTime @default(now())',
  '',
  ...tenantModels.map((n) => `  ${lower(n)}Rows ${n}[]`),
  '}',
  '',
);
writeFileSync(file, out.join('\n'));
console.log(`tenant-scoped models: ${tenantModels.length}`);
