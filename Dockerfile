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
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then PM_ARCH="arm64"; else PM_ARCH="x86_64"; fi && \
    curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_${PM_ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin pmtiles && \
    chmod +x /usr/local/bin/pmtiles

WORKDIR /chartmaker

COPY package*.json ./
RUN npm ci

COPY . .

RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production

RUN mkdir -p /chartmaker/chartcache /chartmaker/mbtiles /chartmaker/pmtiles /chartmaker/config \ 
    && chmod 777 /chartmaker

EXPOSE 8500
CMD ["node", "make.js"]
