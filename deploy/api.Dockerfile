# الفنان ERP — الخادم الخلفي (build context = جذر المستودع)
FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

RUN npm ci --workspace=apps/api \
    && npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npm run build --workspace=apps/api

WORKDIR /app/apps/api
EXPOSE 4000

# apply pending migrations on boot, then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
