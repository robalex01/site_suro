FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* .
RUN npm install --omit=dev
COPY bot.js .
COPY src ./src
CMD ["node", "bot.js"]
