FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY . .

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@stakefit/orchestrator", "start"]
