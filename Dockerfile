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
  
WORKDIR /chartmaker

COPY package*.json ./
RUN npm ci

COPY . .

RUN sed -i 's/indocker = (r.search("\/docker\/") > -1);/indocker = (r.search("\/docker\/") > -1) || fs.existsSync("\/\.dockerenv") || process.env.DOCKER === "true";/' make.js

RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production

RUN mkdir -p /chartmaker/chartcache /chartmaker/mbtiles /chartmaker/config \ 
    && ln -s /chartmaker/chartcache /chartmaker/chartcache \
    && ln -s /chartmaker/mbtiles /chartmaker/mbtiles

EXPOSE 8500
CMD ["node", "make.js"]
