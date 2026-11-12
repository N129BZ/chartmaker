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
WORKDIR /chartmaker


# Clone application from GitHub repository
RUN git clone https://github.com/n129bz/chartmaker .

# Fix Docker environment detection in cgroups v2 / container runtimes
RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

# Install dependencies and build client directly from the cloned repository
RUN npm install && npm run build

# Prepare externalized directory targets
RUN mkdir -p /chartmaker/chartcache /chartmaker/mbtiles /chartmaker/config \ 
    && ln -s /chartmaker/chartcache /chartmaker/chartcache \
    && ln -s /chartmaker/mbtiles /chartmaker/mbtiles

# Expose single application port
EXPOSE 8500

# Default entrypoint
CMD ["node", "make.js"]
