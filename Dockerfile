# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
RUN npm i -g pnpm@12
# No .git in the image, so no hooks.
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
RUN npm i -g pnpm@12
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The commit: the build id, and what /privacy names.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1
# AUTH_SECRET is a placeholder for lib/env.ts during page-data collection, kept on the command
# so it stays out of the stage's environment. The trace pulls the TypeScript compiler into
# standalone and the `**` includes in next.config.ts copy packages whole (types, maps, tests);
# none of it runs. outputFileTracingExcludes would be ignored (Turbopack reads only includes),
# so strip here. `test -d` fails the build if the compiler moves, rather than quietly regaining
# 23MB. `./scripts/**` stays whole: operators run it.
RUN AUTH_SECRET=insecure-build-time-placeholder pnpm build \
    && test -d .next/standalone/node_modules/@typescript \
    && rm -rf .next/standalone/node_modules/@typescript .next/standalone/node_modules/typescript \
    && find .next/standalone \
        \( -name '*.test.ts' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) \
        -delete

# Serves the app and runs the compose `migrate` service (see next.config.ts).
FROM node:24-alpine AS runner
WORKDIR /app
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
