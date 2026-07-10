FROM node:22-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN npm install --global pnpm@10
COPY package.json ./
RUN pnpm install
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN npm install --global pnpm@10
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.data && chown node:node /app/.data

USER node
EXPOSE 3000
VOLUME ["/app/.data"]

CMD ["pnpm", "start"]
