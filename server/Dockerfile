# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.13.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules AND poppler-utils + tesseract
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    build-essential \
    node-gyp \
    pkg-config \
    python-is-python3 \
    poppler-utils \
    tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci --only=production

# Copy application code
COPY . .


# Final stage for app image
FROM base

# Install runtime dependencies (poppler-utils and tesseract) in final image
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    poppler-utils \
    tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=build /app /app

# Create tmp_ocr directory for OCR processing
RUN mkdir -p /app/tmp_ocr

# Start the server by default, this can be overwritten at runtime
EXPOSE 5050
CMD [ "node", "index.js" ]