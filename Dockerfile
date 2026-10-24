# The hosted game: the built client and the game server on one port.
# docker build -t bedfall . && docker run -p 3000:3000 bedfall
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:node

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/server/main.js"]
