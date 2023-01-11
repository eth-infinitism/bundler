FROM node:16-buster-slim
WORKDIR /app/
COPY dist/bundler.js /app/
COPY bundler.sh /app/
RUN chmod +rx /app/bundler.sh 
ENTRYPOINT [ "/app/bundler.sh" ]
