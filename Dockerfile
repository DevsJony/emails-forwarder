FROM node:18-alpine

WORKDIR /opt/node-app

# Install packages
COPY package*.json ./
RUN npm install

# Build node app
COPY . .
RUN npm run build

CMD ["npm", "run", "start:prod"]
