FROM node:18-slim

# Install yt-dlp and dependencies for social media video extraction
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Expose port (Railway will set PORT env var)
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
