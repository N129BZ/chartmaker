FROM ghcr.io/osgeo/gdal:ubuntu-small-latest

LABEL org.opencontainers.image.source=https://github.com

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    zip \
    sqlite3 \
    ca-certificates \
    build-essential \
    libgdal-dev \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*
    
# Ensure prerequisites are present, set up the GPG key, and add the correct repository
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*
  
# Keep app code isolated inside /app so volume mounts don't overwrite it
WORKDIR /app

# Clone application from GitHub repository
RUN git clone https://github.com/n129bz/chartmaker .

# Fix Docker environment detection in cgroups v2 / container runtimes
RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

# Install dependencies directly from the cloned repository
RUN npm install

# Prepare externalized directory targets and cache default settings template
RUN mkdir -p /chartmaker/chartcache /chartmaker/externalcharts /chartmaker/externalsettings /app/public \
    && mkdir -p /app/defaults \
    && cp settings.json /app/defaults/settings.json \
    && rm -rf /app/public/charts \
    && ln -s /chartmaker/externalcharts /app/public/charts

# FIX: Copy chartdates.json and users.json to the /chartmaker folder where your code expects them
RUN cp chartdates.json /chartmaker/chartdates.json \
    && cp users.json /chartmaker/users.json

# Expose single application port
EXPOSE 8500

# Pre-seed the configuration to the path expected by the compose mount targets
RUN cp /app/defaults/settings.json /chartmaker/externalsettings/settings.json

# Default entrypoint
CMD ["node", "make.js"]
