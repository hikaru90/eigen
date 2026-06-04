FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

# Non-sensitive defaults only. Docker BuildKit warns on ARG/ENV names like *_SECRET, *_PASSWORD, *_API_KEY (SecretsUsedInArgOrEnv). Those values are supplied only for the build command below and are not baked as ENV on the image. At runtime, set them via compose / your platform (see `compose.yaml`).
FROM deps AS build
ARG DATABASE_URL=postgres://eigen:eigen@db:5432/eigen
ARG ORIGIN=http://localhost:3000
ARG AGE_GRAPH_NAME=eigen_graph
ARG LLM_BASE_URL=https://example.com/v1
ARG LLM_MIN_REQUEST_INTERVAL_MS=1000
ARG LLM_RULE_CHAT=00000000-0000-0000-0000-000000000001
ARG LLM_RULE_EMBEDDING=00000000-0000-0000-0000-000000000002
ARG EMBEDDING_COMPRESS_INTENSITY=full
ENV DATABASE_URL=${DATABASE_URL}
ENV ORIGIN=${ORIGIN}
ENV AGE_GRAPH_NAME=${AGE_GRAPH_NAME}
ENV LLM_BASE_URL=${LLM_BASE_URL}
ENV LLM_MIN_REQUEST_INTERVAL_MS=${LLM_MIN_REQUEST_INTERVAL_MS}
ENV LLM_RULE_CHAT=${LLM_RULE_CHAT}
ENV LLM_RULE_EMBEDDING=${LLM_RULE_EMBEDDING}
ENV EMBEDDING_COMPRESS_INTENSITY=${EMBEDDING_COMPRESS_INTENSITY}
COPY . .
RUN BETTER_AUTH_SECRET="local-dev-build-secret-change-me" \
  AGE_GRAPH_NAME="eigen_graph" \
  LLM_API_KEY="docker-build-placeholder" \
  npm run build

FROM base AS runner
# LLM gateway vars are intentionally NOT baked in here — set them at runtime via compose env_file / your platform.
# Build-stage placeholders (example.com) exist only so `npm run build` can succeed in CI; they must not ship in the image.
ARG EMBEDDING_COMPRESS_INTENSITY=full
ENV EMBEDDING_COMPRESS_INTENSITY=${EMBEDDING_COMPRESS_INTENSITY}
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package*.json ./
RUN npm ci
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/server/db/enable_rls.sql ./src/lib/server/db/enable_rls.sql
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
ENV NODE_ENV=production

EXPOSE 3000
CMD ["./entrypoint.sh"]
