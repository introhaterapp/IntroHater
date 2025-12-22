FROM node:20-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY server.js .
COPY src ./src
COPY docs ./docs
COPY tests ./tests

# Run tests
RUN npm test

# Ensure data directory exists
RUN mkdir -p src/data

# Expose port
EXPOSE 7000

# Environment variables
ENV PORT=7000
ENV NODE_ENV=production

# Start command
CMD ["node", "server.js"]
