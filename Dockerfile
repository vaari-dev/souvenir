FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS node

FROM node AS pnpm
WORKDIR /app
# Keep equal to packageManager.
RUN npm i -g --ignore-scripts pnpm@12.6.0

FROM pnpm AS deps
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM pnpm AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1
# AUTH_SECRET only satisfies lib/env.ts, and stays out of the stage's environment. Turbopack
# ignores outputFileTracingExcludes, so what standalone needn't ship is stripped here.
RUN AUTH_SECRET=insecure-build-time-placeholder pnpm build \
    && rm -rf .next/standalone/node_modules/@typescript .next/standalone/node_modules/typescript \
    && find .next/standalone \
        \( -name '*.test.ts' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) \
        -delete

# Also runs the compose `migrate` service (see next.config.ts).
FROM node AS runner
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
