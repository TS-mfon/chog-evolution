FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages
COPY contracts ./contracts
COPY genlayer ./genlayer
COPY assets ./assets
COPY docs ./docs
COPY .env.example ./
RUN npm ci && npm run build --workspace=@chog/api
ENV NODE_ENV=production
ENV API_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e 'fetch("http://127.0.0.1:4000/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["npm", "run", "start", "--workspace=@chog/api"]
