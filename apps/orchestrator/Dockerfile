# Playwright base image ships the browsers and system deps the sandbox needs.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

RUN corepack enable

# Copy the whole monorepo so workspace packages resolve.
COPY . .

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@stakefit/orchestrator", "start"]
