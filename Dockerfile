FROM ghcr.io/osgeo/gdal:ubuntu-small-latest

LABEL org.opencontainers.image.source=https://github.com

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    zip \
    sqlite3 \
    procps \
    ca-certificates \
    gnupg \
    nano \
    build-essential \
    libgdal-dev \
    libssl-dev \
    git \
	&& rm -rf /var/lib/apt/lists/*
    
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://nodesource.com | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://nodesource.com nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*
  
# STEP 1: Keep app code isolated inside /app so volume mounts don't overwrite it
WORKDIR /app

# Clone application from GitHub repository
RUN git clone https://github.com .

# Fix Docker environment detection in cgroups v2 / container runtimes
RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

# Install dependencies directly from the cloned repository
RUN npm install

# STEP 2: Prepare externalized directory targets and cache default settings template
RUN mkdir -p /chartmaker/chartcache /chartmaker/externalcharts /chartmaker/externalsettings /app/public \
    && mkdir -p /app/defaults \
    && cp settings.json /app/defaults/settings.json \
    && rm -rf /app/public/charts \
    && ln -s /chartmaker/externalcharts /app/public/charts

# Expose single application port
EXPOSE 8500

# Copy the default configuration to the expected volume path ONLY if it isn't already mounted
RUN cp /app/defaults/settings.json /chartmaker/externalsettings/settings.json

# Launch the Node process directly from your safe app environment directory
CMD ["node", "make.js"]