FROM ghcr.io/osgeo/gdal:ubuntu-small-latest

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
    git
    
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*
  
# Work directory expected by make.js
WORKDIR /chartmaker

# Clone application from GitHub repository
RUN git clone https://github.com/n129bz/chartmaker .

# Fix Docker environment detection in cgroups v2 / container runtimes
RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

# Install dependencies directly from the cloned repository
RUN npm install

# Ensure externalized directories exist and symlink mbtilesfolder (public/charts) to externalcharts
RUN mkdir -p /chartmaker/chartcache /chartmaker/externalcharts /chartmaker/public \
    && rm -rf /chartmaker/public/charts \
    && ln -s /chartmaker/externalcharts /chartmaker/public/charts

# Expose web server and websocket ports
EXPOSE 5062

# Default entrypoint
CMD ["node", "make.js"]
