FROM node:20-slim

# Install yt-dlp, deno (for YouTube JS runtime), and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    && pip3 install --break-system-packages --upgrade yt-dlp \
    && curl -fsSL https://deno.land/install.sh | sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Add deno to PATH
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

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
