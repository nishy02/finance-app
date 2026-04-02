FROM node:22-slim

# Install build tools needed for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install backend deps
COPY finance-backend/package*.json ./finance-backend/
RUN cd finance-backend && npm install

# Copy all source files
COPY finance-backend ./finance-backend
COPY finance-frontend ./finance-frontend

EXPOSE 3000

CMD ["node", "finance-backend/src/app.js"]
