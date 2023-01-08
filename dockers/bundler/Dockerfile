FROM node:16-buster-slim
COPY dist/bundler.js app/
WORKDIR /app/
ENTRYPOINT [ "node","/app/bundler.js" ]
