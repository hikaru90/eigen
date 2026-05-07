FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
ARG DATABASE_URL=postgres://eigen:eigen@db:5432/eigen
ARG BETTER_AUTH_SECRET=local-dev-build-secret-change-me
ARG BETTER_AUTH_URL=http://localhost:3000
ENV DATABASE_URL=${DATABASE_URL}
ENV BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
ENV BETTER_AUTH_URL=${BETTER_AUTH_URL}
COPY . .
RUN npm run build

FROM base AS runner
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package*.json ./
RUN npm ci
COPY --from=build /app/build ./build
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "build/index.js"]
