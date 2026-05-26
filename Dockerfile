# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.15.0

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Enable pnpm via corepack (bundled with Node 24+).
RUN corepack enable

# Bind-mount package.json, pnpm-lock.yaml, and pnpm-workspace.yaml (which holds the allowBuilds
# entries) so the install layer is invalidated only when these change.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
    --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --prod --frozen-lockfile

USER node

COPY . .

CMD ["pnpm", "start"]
