# الفنان ERP — الواجهة (build context = جذر المستودع)
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web ./apps/web

# داخل Docker تمر طلبات الواجهة عبر بروكسي nginx على /api
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm ci --workspace=apps/web && npm run build --workspace=apps/web

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
