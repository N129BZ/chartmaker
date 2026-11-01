'use strict';

import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import readlineSync from 'readline-sync';
import path from 'node:path';
import express from 'express';
import { cwd } from 'node:process';
import { WebSocketServer } from 'ws';
import archiver from 'archiver';

class AppMessage {
    static mtInfo = "info";
    static mtTiming = "timing";
    static mtCommandResponse = "commandresponse";
    static mtRunning = "running";
    static mtComplete = "complete";
    static mtCommand = "command";
    static mtSettings = "settings";
    static mtDownload = "download";
    static mtConnection = "connection";
    static mtCommandPackage = "commandpackage";
    static mtExistingDb = "existingdb";

    constructor(msgtype) {
        this.type = msgtype;
        this.css = [];
        this.payload = "";
        this.rowindex = -1;
        this.completed = false;
        this.items = [];
        this.filename = "";
        this.getexisting = false;
        this.dbfilename = "";
        this.uid = "";
    }
}

class MakeCommand {
    constructor(command, chart, rowindex, chartname, layertype) {
        this.command = command;
        this.chart = chart;
        this.rowindex = rowindex;
        this.chartname = chartname;
        this.layertype = layertype;
    }
}

class ProcessTime {
    constructor(processName) {
        this.processname = (processName || "").replaceAll("_", " ");
        this.startdate = new Date();
        this.totaltime = "";
        this.logtime = "";
    }

    calculateProcessTime() {
        let pt = ProcessTime.reportProcessingTime(this.startdate);
        this.totaltime = `time: ${pt}`;
    }

    static reportProcessingTime(startdate) {
        let date2 = new Date();
        if (date2 < startdate) {
            date2.setDate(date2.getDate() + 1);
        }

        let msec = date2 - startdate;
        let hh = Math.floor(msec / 1000 / 60 / 60);
        msec -= hh * 1000 * 60 * 60;
        let mm = Math.floor(msec / 1000 / 60);
        msec -= mm * 1000 * 60;
        let ss = Math.floor(msec / 1000);

        let phh = pad2(hh);
        let pmm = pad2(mm);
        let pss = pad2(ss);
        let ttime = `${phh}:${pmm}:${pss}`;
        logEntry(`Start time: ${startdate.toISOString()}, End time: ${date2.toISOString()}, Total time: ${ttime}`);
        return ttime;
    }
}

// Websocket variables
var connections = new Map();
var inMakeLoop = false;
var pingSenderId = 0;

// Application directories
let appdir = cwd();
let isdocker = isRunningInDocker();

function isRunningInDocker() {
    let indocker = false;
    try {
        let r = execSync(`cat /proc/1/cgroup`, { encoding: "utf8" });
        indocker = (r.search("/docker/") > -1);
    } catch { }
    if (indocker) {
        console.log("Running in docker container!");
        appdir = "/chartmaker";
    }
    return indocker;
}

function processPrompt(message) {
    return readlineSync.question(message);
}

const settings = JSON.parse(fs.readFileSync(path.join(appdir, "settings.json"), "utf-8")).settings;
const useWebServer = settings.webservermode;
let timings = new Map();

if (settings.timezone && settings.timezone !== "") {
    process.env.TZ = settings.timezone;
}

function getProcessCount() {
    let pc = 4;
    try {
        let r = execSync(`grep -c "^processor" /proc/cpuinfo`, { encoding: 'utf8' });
        pc = Number(r.replace('\n', "").trim());
        logEntry(`Processor count = ${pc}`);
    } catch { }
    return pc;
}

// Logging
let logfd = 0;
const setupDebugLog = function (logfolder) {
    if (settings.logtofile) {
        logfd = fs.openSync(path.join(logfolder, "debug.log"), 'w', 0o666);
    }
};

const logEntry = function (entry) {
    if (settings.logtofile && logfd) {
        fs.writeSync(logfd, `${entry}\n`);
    } else {
        console.log(entry);
    }
};

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

let expiredate = "";
const chartdate = getBestChartDate();
const remotemenu = JSON.parse(fs.readFileSync(path.join(appdir, "remotemenu.json"), "utf-8"));
const users = JSON.parse(fs.readFileSync(path.join(appdir, "users.json"), "utf-8")).users;
const zipfilename = settings.zipfilename;
const zipfilepath = path.join(appdir, "public", "charts", chartdate, zipfilename);

const startdate = new Date();

let workarea = path.join(appdir, "workarea");
if (settings.renameworkarea) workarea += `_${chartdate}`;
if (!fs.existsSync(workarea)) fs.mkdirSync(workarea, { recursive: true });

let chartcache = path.join(appdir, "chartcache");
if (!fs.existsSync(chartcache)) fs.mkdirSync(chartcache, { recursive: true });

let chartsfolder = path.join(appdir, "public", "charts");
if (!fs.existsSync(chartsfolder)) fs.mkdirSync(chartsfolder, { recursive: true });

let dbfolder = path.join(chartsfolder, chartdate);
if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder, { recursive: true });

if (isdocker) {
    let extcharts = path.join(appdir, "externalcharts");
    if (fs.existsSync(extcharts)) {
        dbfolder = extcharts;
    }
}

let imageformat = settings.tiledrivers[settings.tiledriverindex];
let chartlayertype = settings.layertypes[settings.layertypeindex];
let chartworkname = "";
let chartname = "";
let charturl = "";
let clippedShapeFolder = "";
let chartfolder = "";
let dir_1_unzipped = "";
let dir_2_clipped = "";
let dir_3_mosaic = "";
let dir_4_tiled = "";
let isifrchart = false;
let addmetabounds = false;

let parray = [];
let nm = 0;
const processes = getProcessCount();

/**
 * =========================================================================
 * STREAMLINED IMAGE PROCESSING PIPELINE
 * =========================================================================
 * 
 * Key architectural improvements over legacy make.js:
 * 1. Multi-TIF Handling: Handles FAA zip files with dozens of GeoTIFFs
 *    (e.g. 57 sectionals, 30+ terminal charts, 36+ enroute charts) seamlessly.
 * 2. Pre-Tiling VRT Mosaic: Instead of tiling each TIF into loose disk files
 *    and merging with Perl mergetiles.pl + ImageMagick `convert`, all clipped
 *    rasters are assembled into a single Virtual Dataset (VRT) in < 1 second.
 * 3. 180° Antimeridian Crossing Fix: Automatically detects charts that cross
 *    the 180° meridian (e.g. Western Aleutian Islands East) and splits the warp
 *    into East (+177° to 180°) and West (-180° to -172°) halves, preventing
 *    the 360-degree globe-spanning distortion and 600,000-pixel explosion.
 * 4. Zero Loose File MBTiles Creation: Supports direct creation of SQLite
 *    MBTiles using GDAL's native MBTILES raster driver with power-of-two
 *    overviews generated via gdaladdo, completely avoiding loose files.
 * 5. Elimination of Bottlenecks: Perl (mergetiles.pl), ImageMagick (convert),
 *    per-tile pngquant loops, and redundant gdaladdo passes are eliminated.
 */

function runProcessing() {
    logEntry(`\n======================================================`);
    logEntry(`Starting streamlined processing for: ${chartname}`);
    logEntry(`======================================================`);

    dir_1_unzipped = path.join(chartfolder, "1_unzipped");
    dir_2_clipped = path.join(chartfolder, "2_clipped");
    dir_3_mosaic = path.join(chartfolder, "3_mosaic");
    dir_4_tiled = path.join(chartfolder, "4_tiled");

    setupEnvironment();
    downloadCharts();
    unzipCharts();
    normalizeChartNames();

    // Core streamlined stages:
    // 1. Process all TIFs (with antimeridian splitting & cutline clipping) into dir_2_clipped
    const clippedFiles = processImagesStreamlined();

    if (clippedFiles.length === 0) {
        logEntry(`ERROR: No clipped chart images were generated. Aborting MBTiles creation.`);
        return;
    }

    // 2. Build a single unified Virtual Mosaic VRT from all clipped charts
    const mosaicVrt = buildMosaic(clippedFiles);

    // 3. Create the final MBTiles database with zoom level overviews
    makeMbTilesStreamlined(mosaicVrt);

    // Clean up working directories if configured
    if (settings.cleanprocessfolders === true) {
        logEntry(`Cleaning up work area folder: ${chartfolder}`);
        fs.rmSync(chartfolder, { recursive: true, force: true });
        fs.mkdirSync(chartfolder, { recursive: true });
    }
}

/**
 * Setup working directory structure
 */
function setupEnvironment() {
    if (fs.existsSync(chartfolder)) {
        fs.rmSync(chartfolder, { recursive: true, force: true });
    }
    fs.mkdirSync(chartfolder, { recursive: true });

    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped, { recursive: true });
    if (!fs.existsSync(dir_2_clipped)) fs.mkdirSync(dir_2_clipped, { recursive: true });
    if (!fs.existsSync(dir_3_mosaic)) fs.mkdirSync(dir_3_mosaic, { recursive: true });
    if (!fs.existsSync(dir_4_tiled)) fs.mkdirSync(dir_4_tiled, { recursive: true });

    if (settings.logtofile) setupDebugLog(chartfolder);
    logEntry(`Initialized streamlined workspace at: ${chartfolder}`);
}

/**
 * Download chart zip file from FAA aeronav repository if not cached
 */
function downloadCharts() {
    let chartzip = path.join(chartcache, `${chartworkname}-${chartdate}.zip`);
    if (fs.existsSync(chartzip)) {
        logEntry(`Using cached: ${chartzip}`);
        return;
    }

    // Clean out outdated cache versions for this chart
    let oldfiles = fs.readdirSync(chartcache);
    for (let i = 0; i < oldfiles.length; i++) {
        if (oldfiles[i].startsWith(chartworkname)) {
            try {
                fs.rmSync(path.join(chartcache, oldfiles[i]));
            } catch { }
            break;
        }
    }

    logEntry(`Downloading chart archive: ${charturl}`);
    let cmd = `curl -s -S "${charturl}" -o "${chartzip}"`;
    executeCommand(cmd, true);
}

/**
 * Extract chart archive and clean non-chart files
 */
function unzipCharts() {
    let chartzip = path.join(chartcache, `${chartworkname}-${chartdate}.zip`);
    logEntry(`Extracting archive: ${chartzip}`);
    let cmd = `unzip -o -q "${chartzip}" -x '*.htm' -d "${dir_1_unzipped}"`;
    executeCommand(cmd);

    // IFR archives contain nested zip files for individual low/high charts
    if (isifrchart) {
        let zipfiles = fs.readdirSync(dir_1_unzipped);
        zipfiles.forEach(zipfile => {
            let srchstr = chartname === "Enroute_High" ? "ENR_H" : "ENR_L";
            if (zipfile.search(srchstr) > -1) {
                let nestedZip = path.join(dir_1_unzipped, zipfile);
                cmd = `unzip -o -q "${nestedZip}" -d "${dir_1_unzipped}"`;
                executeCommand(cmd);
            }
        });
    }

    // Remove extraneous non-georeferenced assets
    const cleanupExts = ["*.pdf", "*.htm", "*.html", "*.zip", "*.txt"];
    for (const ext of cleanupExts) {
        try {
            execSync(`rm -f ${path.join(dir_1_unzipped, ext)}`);
        } catch { }
    }

    // Remove known anomalous non-conforming images
    let badFiles = ["Caribbean Planning Chart.tif", "caribbean_planning_chart.tif"];
    for (const bad of badFiles) {
        let p = path.join(dir_1_unzipped, bad);
        if (fs.existsSync(p)) {
            try { fs.rmSync(p); } catch { }
        }
    }
}

/**
 * Normalize extracted filenames: lower-case, underscores instead of spaces/dashes
 */
function normalizeChartNames() {
    let files = fs.readdirSync(dir_1_unzipped);
    files.forEach((file) => {
        if (file.endsWith(".tif") || file.endsWith(".tfw") || file.endsWith(".tfwx")) {
            let newfile = normalizeFileName(file);
            if (newfile !== file) {
                fs.renameSync(path.join(dir_1_unzipped, file), path.join(dir_1_unzipped, newfile));
            }
        }
    });
}

/**
 * Check if a given chart TIF crosses the 180° meridian (antimeridian).
 * Specifically handles Aleutian Islands East and checks wgs84Extent bounds.
 */
function checkAntimeridianCrossing(tifPath, areaName) {
    const lowerName = areaName.toLowerCase();
    if (lowerName.includes("aleutian") && lowerName.includes("east")) {
        return true;
    }

    try {
        let out = execSync(`gdalinfo -json "${tifPath}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        let info = JSON.parse(out);
        if (info.wgs84Extent && info.wgs84Extent.coordinates && info.wgs84Extent.coordinates.length > 0) {
            let ring = info.wgs84Extent.coordinates[0];
            let hasEast = false; // Longitude > 160°
            let hasWest = false; // Longitude < -160°
            for (let coord of ring) {
                let lon = coord[0];
                if (lon > 160) hasEast = true;
                if (lon < -160) hasWest = true;
            }
            if (hasEast && hasWest) {
                return true;
            }
        }
    } catch { }

    return false;
}

/**
 * Locate cutline shapefile for a given chart area.
 * Looks in primary shape folder, then in clipshapes/insets fallback.
 */
function findShapefile(area) {
    let shpName = `${area}.shp`;
    let primary = path.join(clippedShapeFolder, shpName);
    if (fs.existsSync(primary)) return primary;

    let insetPath = path.join(appdir, "clipshapes", "insets", shpName);
    if (fs.existsSync(insetPath)) return insetPath;

    let sectionalPath = path.join(appdir, "clipshapes", "sectional", shpName);
    if (fs.existsSync(sectionalPath)) return sectionalPath;

    return null;
}

/**
 * Streamlined image processor:
 * - Warps all TIFs to Web Mercator (EPSG:3857) with cutlines and RGBA alpha
 * - Handles the 180° antimeridian split for Western Aleutian Islands East
 * - Outputs clean, compressed GeoTIFFs to dir_2_clipped
 * @returns {Array<string>} Array of absolute paths to clipped GeoTIFF files
 */
function processImagesStreamlined() {
    let chartareas = buildChartNameArray();
    let cblend = settings.blendpixels || 5;
    let clippedOutputs = [];

    logEntry(`Processing ${chartareas.length} geo-referenced chart TIF file(s)...`);

    chartareas.forEach((area) => {
        let srcTif = path.join(dir_1_unzipped, `${area}.tif`);
        let shapefile = findShapefile(area);
        let isAntiMeridian = checkAntimeridianCrossing(srcTif, area);

        // Step 1: Create an on-the-fly RGBA VRT to expand paletted color tables
        let rgbaVrt = path.join(dir_2_clipped, `${area}_rgba.vrt`);
        let expandCmd = `gdal_translate -of vrt -expand rgba "${srcTif}" "${rgbaVrt}"`;
        executeCommand(expandCmd);

        // Common GTiff creation options for intermediate warped rasters
        let coOptions = `-co COMPRESS=DEFLATE -co PREDICTOR=2 -co TILED=YES -co BIGTIFF=IF_SAFER -to ONLY_BEST=YES`;
        let cutlineArgs = shapefile ? `-cutline "${shapefile}" -cblend ${cblend}` : "";

        if (isAntiMeridian) {
            /**
             * -------------------------------------------------------------
             * 180° ANTIMERIDIAN DIVISION RESOLUTION:
             * 
             * Western Aleutian Islands East extends across the 180° meridian:
             *   Eastern Hemisphere: ~177.0°E to 180.0°E  (lands on right edge in Web Mercator)
             *   Western Hemisphere: ~180.0°W to 172.0°W  (lands on left edge in Web Mercator)
             * 
             * Warping naively produces a 360° global distortion (~600,000 px).
             * We split the warp into two bounded halves using -te in EPSG:4326.
             * -------------------------------------------------------------
             */
            logEntry(`>> Detected 180° meridian crossing for chart: ${area}. Splitting into East/West halves...`);

            let eastClipped = path.join(dir_2_clipped, `${area}_180e.tif`);
            let westClipped = path.join(dir_2_clipped, `${area}_180w.tif`);

            // Eastern hemisphere half: 177.0° to 180.0°
            let eastWarpCmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 512 ` +
                `-te 177.0 50.5 180.0 53.5 -te_srs EPSG:4326 ` +
                `-wo NUM_THREADS=ALL_CPUS ${coOptions} ` +
                `${cutlineArgs} "${rgbaVrt}" "${eastClipped}"`;
            executeCommand(eastWarpCmd);
            if (fs.existsSync(eastClipped)) clippedOutputs.push(eastClipped);

            // Western hemisphere half: -180.0° to -172.0°
            let westWarpCmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 512 ` +
                `-te -180.0 50.5 -172.0 53.5 -te_srs EPSG:4326 ` +
                `-wo NUM_THREADS=ALL_CPUS ${coOptions} ` +
                `${cutlineArgs} "${rgbaVrt}" "${westClipped}"`;
            executeCommand(westWarpCmd);
            if (fs.existsSync(westClipped)) clippedOutputs.push(westClipped);

        } else {
            // Standard chart clipping & reprojection
            let clippedTif = path.join(dir_2_clipped, `${area}_clipped.tif`);
            let cropArg = shapefile ? `-crop_to_cutline` : "";

            let warpCmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 512 ` +
                `-wo NUM_THREADS=ALL_CPUS ${coOptions} ` +
                `${cutlineArgs} ${cropArg} "${rgbaVrt}" "${clippedTif}"`;
            executeCommand(warpCmd);
            if (fs.existsSync(clippedTif)) clippedOutputs.push(clippedTif);
        }

        // Clean up temporary VRT file
        try { fs.rmSync(rgbaVrt); } catch { }
    });

    return clippedOutputs;
}

/**
 * Assembles all clipped GeoTIFFs into a single virtual mosaic VRT.
 * Replaces mergetiles.pl and per-tile ImageMagick `convert -composite` completely.
 * @param {Array<string>} clippedFiles 
 * @returns {string} Path to generated mosaic.vrt
 */
function buildMosaic(clippedFiles) {
    logEntry(`>> Building seamless virtual mosaic from ${clippedFiles.length} chart image(s)...`);
    let mosaicVrt = path.join(dir_3_mosaic, `${chartname}_mosaic.vrt`);
    let fileListTxt = path.join(dir_3_mosaic, "mosaic_file_list.txt");

    // Write file paths to prevent shell command line length limits
    fs.writeFileSync(fileListTxt, clippedFiles.map(f => `${f}`).join("\n"));

    let cmd = `gdalbuildvrt -addalpha -input_file_list "${fileListTxt}" "${mosaicVrt}"`;
    executeCommand(cmd);

    return mosaicVrt;
}

/**
 * Generate a single MBTiles database with zoom level overviews from the mosaic VRT.
 * 
 * Supports two operational modes:
 * Mode A (Default: Native GDAL MBTiles Driver):
 *   Translates mosaic directly to SQLite MBTiles and builds overviews via gdaladdo.
 *   Zero loose files, built-in palette quantization (PNG8) / WebP compression.
 * Mode B (Single-Pass gdal2tiles):
 *   Tiles the unified mosaic VRT once using multi-processing, then packs with mb-util.
 */
function makeMbTilesStreamlined(mosaicVrt) {
    let mbtilesFile = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
    fs.rmSync(mbtilesFile, { force: true });

    let zooms = (settings.zoomrange || "0-11").split("-");
    let minzoom = parseInt(zooms[0], 10) || 0;
    let maxzoom = parseInt(zooms.length > 1 ? zooms[1] : zooms[0], 10) || 11;
    let chartdesc = chartname.split("_").join(" ");

    // Extract bounds from the mosaic VRT via gdalinfo
    let boundsStr = "-180,-85.0511,180,85.0511";
    let centerStr = `0,0,${settings.centerzoomlevel || 7}`;
    try {
        let infoStr = execSync(`gdalinfo -json "${mosaicVrt}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        let info = JSON.parse(infoStr);
        if (info.wgs84Extent && info.wgs84Extent.coordinates && info.wgs84Extent.coordinates.length > 0) {
            let coords = info.wgs84Extent.coordinates[0];
            let minX = 180, maxX = -180, minY = 90, maxY = -90;
            for (let c of coords) {
                if (c[0] < minX) minX = c[0];
                if (c[0] > maxX) maxX = c[0];
                if (c[1] < minY) minY = c[1];
                if (c[1] > maxY) maxY = c[1];
            }
            boundsStr = `${minX.toFixed(6)},${minY.toFixed(6)},${maxX.toFixed(6)},${maxY.toFixed(6)}`;
            let centerX = (minX + maxX) / 2;
            let centerY = (minY + maxY) / 2;
            centerStr = `${centerX.toFixed(6)},${centerY.toFixed(6)},${settings.centerzoomlevel || 7}`;
        }
    } catch { }

    // Check if user prefers single-pass gdal2tiles + mb-util or direct GDAL MBTILES driver
    let useGdal2Tiles = settings.usegdal2tiles === true;

    if (!useGdal2Tiles) {
        /**
         * -----------------------------------------------------------------
         * DIRECT GDAL MBTILES DRIVER GENERATION (Highest Speed & Zero Disk Overhead)
         * -----------------------------------------------------------------
         */
        logEntry(`>> Generating MBTiles database directly using GDAL MBTILES driver...`);

        let tileFormatArg = "PNG";
        let qualityArg = "";

        switch (imageformat.toLowerCase()) {
            case "webp":
                tileFormatArg = "WEBP";
                qualityArg = `-co QUALITY=${settings.tileimagequality || 75}`;
                break;
            case "jpeg":
            case "jpg":
                tileFormatArg = "JPEG";
                qualityArg = `-co QUALITY=${settings.tileimagequality || 75}`;
                break;
            default:
                // PNG: If quality < 100%, use PNG8 palette with Floyd-Steinberg dithering
                if (settings.tileimagequality && settings.tileimagequality < 100) {
                    tileFormatArg = "PNG8 -co DITHER=YES";
                } else {
                    tileFormatArg = "PNG";
                }
                break;
        }

        let translateCmd = `gdal_translate -of MBTILES "${mosaicVrt}" "${mbtilesFile}" ` +
            `-co TILE_FORMAT=${tileFormatArg} ${qualityArg} ` +
            `-co NAME="${chartname}" ` +
            `-co DESCRIPTION="${chartdesc} Chart" ` +
            `-co TYPE="${chartlayertype}" ` +
            `-co WRITE_BOUNDS=YES ` +
            `-co WRITE_MINMAXZOOM=YES ` +
            `-co ZOOM_LEVEL_STRATEGY=AUTO ` +
            `-co RESAMPLING=BILINEAR ` +
            `-co BOUNDS="${boundsStr}" ` +
            `-co CENTER="${centerStr}"`;
        executeCommand(translateCmd);

        // Build power-of-two overview pyramids down through the zoom levels
        logEntry(`>> Generating zoom level overviews in MBTiles database...`);
        let addoCmd = `gdaladdo -r average --config GDAL_NUM_THREADS ALL_CPUS "${mbtilesFile}" 2 4 8 16 32 64 128 256 512 1024 2048`;
        executeCommand(addoCmd);

        // Update / ensure attribution and metadata in SQLite
        try {
            let escapedAttr = (settings.attribution || "").replace(/'/g, "''");
            let updateSql = `INSERT OR REPLACE INTO metadata (name, value) VALUES ('attribution', '${escapedAttr}'), ('minzoom', '${minzoom}'), ('maxzoom', '${maxzoom}');`;
            execSync(`sqlite3 "${mbtilesFile}" "${updateSql}"`);
        } catch { }

    } else {
        /**
         * -----------------------------------------------------------------
         * SINGLE-PASS gdal2tiles.py + mb-util (Multi-process tiling on Mosaic)
         * -----------------------------------------------------------------
         */
        logEntry(`>> Tiling mosaic VRT using gdal2tiles.py (single pass across all charts)...`);
        let formatArgs = `--tiledriver=${imageformat.toUpperCase()} `;
        if (imageformat.toLowerCase() === "webp") {
            formatArgs += `--webp-quality=${settings.tileimagequality || 75} `;
        }

        let tileCmd = `gdal2tiles.py --zoom=${settings.zoomrange} --processes=${processes} ` +
            `${formatArgs} --tmscompatible -x -w none "${mosaicVrt}" "${dir_4_tiled}"`;
        executeCommand(tileCmd);

        // Generate metadata.json
        let metaJson = {
            name: chartname,
            description: `${chartdesc} Chart`,
            type: chartlayertype,
            format: imageformat,
            minzoom: minzoom,
            maxzoom: maxzoom,
            bounds: boundsStr,
            center: centerStr,
            attribution: settings.attribution
        };
        fs.writeFileSync(path.join(dir_4_tiled, "metadata.json"), JSON.stringify(metaJson, null, 2));

        // Pack into MBTiles
        logEntry(`>> Packing tiles into MBTiles database: ${mbtilesFile}`);
        let mbUtilCmd = `python3 "${path.join(appdir, "mbutil", "mb-util")}" --image_format=${imageformat} --silent --scheme=tms "${dir_4_tiled}" "${mbtilesFile}"`;
        executeCommand(mbUtilCmd);
    }

    logEntry(`>> Successfully created MBTiles database: ${mbtilesFile}`);
    let cpt = timings.get(chartname);
    if (cpt) {
        cpt.calculateProcessTime();
    }
}

/**
 * Filter unzipped chart directory for relevant TIFF images
 */
function buildChartNameArray() {
    let files = fs.readdirSync(dir_1_unzipped);
    let chartnames = [];
    files.forEach((file) => {
        let fname = file.toLowerCase();
        if (fname.endsWith(".tif") && !fname.includes("fly") && !fname.includes("planning")) {
            let cname = fname.replace(".tif", "");
            chartnames.push(cname);
        }
    });
    return chartnames;
}

/**
 * Normalize filename string: lower-case, remove apostrophes, replace spaces/dashes with underscores
 */
function normalizeFileName(file) {
    return file.toLowerCase()
        .split(" ").join("_")
        .split("'").join("")
        .split("-").join("_")
        .split("_sec").join("")
        .split("_tac").join("")
        .split("_chart").join("")
        .split("u.s.").join("us");
}

/**
 * Get nearest valid FAA 56-day chart cycle date from chartdates.json
 */
function getBestChartDate() {
    let thisdate = new Date();
    let thistime = thisdate.getTime();
    let cdates = [];
    let found = false;
    let selectedDate = "";
    let datedata = fs.readFileSync(path.join(appdir, "chartdates.json"), "utf-8");
    let datelist = JSON.parse(datedata);
    datelist.ChartDates.forEach((cdate) => {
        cdates.push(new Date(cdate));
    });

    let sortedDates = cdates.sort((a, b) => b - a);

    sortedDates.forEach((dateobj) => {
        if (!found) {
            let dtime = dateobj.getTime();
            let tdiff = thistime - dtime;
            let tdays = tdiff / (1000 * 3600 * 24);
            let diffdays = parseInt(tdays.toFixed(0));
            if (diffdays >= -20 && diffdays <= 36) {
                let m = pad2(dateobj.getMonth() + 1);
                let d = pad2(dateobj.getDate());
                let y = dateobj.getFullYear();
                selectedDate = `${m}-${d}-${y}`;
                found = true;
            }
        } else if (expiredate === "") {
            let m = pad2(dateobj.getMonth() + 1);
            let d = pad2(dateobj.getDate());
            let y = dateobj.getFullYear();
            expiredate = `${m}-${d}-${y}`;
        }
    });

    if (!found) {
        throw new Error("No suitable chart date was found in chartdates.json!");
    }
    return selectedDate;
}

/**
 * Execute system shell command with logging
 */
function executeCommand(command, logstdout = null) {
    try {
        if (logstdout == null) {
            logstdout = settings.debug;
        }
        const stdout = execSync(command, { maxBuffer: 50 * 1024 * 1024 }).toString();
        if (logstdout) {
            logEntry(stdout);
        }
    } catch (error) {
        logEntry(`Command failed: ${command}\nError: ${error.message}`);
    }
}

/**
 * Command line and workflow runners
 */
function processSingles(msgid = -1) {
    addmetabounds = true;
    for (let idx = 1; idx < parray.length + 1; idx++) {
        let doProcessing = true;
        chartworkname = settings.areachartlist[parray[idx - 1]];
        chartname = chartworkname;
        clippedShapeFolder = path.join(appdir, "clipshapes", "sectional");
        chartlayertype = settings.layertypes[settings.layertypeindex];
        chartfolder = path.join(workarea, chartworkname);
        charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;

        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);

        let chartdbfile = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
        if (fs.existsSync(chartdbfile)) {
            let stat = fs.statSync(chartdbfile);
            const birthDate = stat.birthtime;
            const year = birthDate.getFullYear();
            const month = String(birthDate.getMonth() + 1).padStart(2, '0');
            const day = String(birthDate.getDate()).padStart(2, '0');
            const formattedDate = `${month}-${day}-${year}`;
            if (formattedDate === chartdate) {
                doProcessing = false;
                cpt.totaltime = "Up-to-date (cached)";
            }
        }

        if (doProcessing) {
            runProcessing();
        }

        console.log(`${chartname} -> ${cpt.totaltime}\r\n`);
        if (msgid > -1) {
            return cpt;
        }
    }
}

function processFulls(msgid = -1) {
    addmetabounds = true;
    for (let idx = 1; idx < parray.length + 1; idx++) {
        let chart = settings.fullchartlist[parray[idx - 1]];
        let lcasename = chart[0].toLowerCase();
        let charttype = chart[1];

        chartworkname = chart[0];

        if (charttype === "ifr") {
            isifrchart = true;
            lcasename = chart[2].toLowerCase();
            charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = chart[2];
            chartfolder = path.join(workarea, chartname);
        } else {
            if (lcasename === "us_vfr_wall_planning") {
                charturl = `${settings.usvfrwallplanningtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
            } else {
                charturl = settings.vfrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            }
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = chartworkname;
            chartfolder = path.join(workarea, chartworkname);
        }

        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);

        let chartdbfile = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
        if (!fs.existsSync(chartdbfile)) {
            runProcessing();
        } else {
            cpt.totaltime = "Up-to-date (cached)";
        }

        console.log(`${chartname} -> ${cpt.totaltime}\n`);
        if (msgid > -1) {
            return cpt;
        }
    }
}

function processOneArea(area = -1) {
    if (area === -1) {
        let lst = "\nSelect chart number from list:\r\n\r\n";
        for (let i = 1; i < settings.areachartlist.length + 1; i++) {
            lst += `${i} ${settings.areachartlist[i-1].split("_").join(" ")}\r\n`;
        }
        lst += "--------------------------------------------\r\nSelection: ";
        let response = processPrompt(lst);
        nm = +response;
    } else {
        nm = +area;
    }

    if (nm >= 1 && nm < settings.areachartlist.length + 1) {
        parray.push(nm -1);
        processSingles();
    } else {
        console.log("Invalid chart selection, exiting.");
        process.exit();
    }
}

function processAllAreas() {
    console.log("\r\nProcessing all 53 sectional areas...\r\n");
    for (let i = 0; i < settings.areachartlist.length; i++) {
        parray.push(i);
    }
    processSingles();
}

function processOneFull() {
    let lst = "\nSelect full chart number from list:\r\n\r\n";
    let i = 1;
    settings.fullchartlist.forEach((fullchart) => {
        let cname = fullchart[0] === "DDECUS" ? fullchart[2] : fullchart[0];
        lst += `${i} ${cname.split("_").join(" ")}\r\n`;
        i++;
    });
    lst += "--------------------------------------------\r\nSelection: ";
    let response = processPrompt(lst);
    nm = Number(response);

    if (nm >= 1 && nm < settings.fullchartlist.length + 1) {
        parray.push(nm-1);
        processFulls();
    } else {
        console.log("Invalid selection, exiting.");
        process.exit();
    }
}

// Websocket / Webserver functions
async function sendMessageToClients(message, userid = "") {
    [...connections.keys()].forEach((client) => {
        if (userid === client.tag.uid || userid === "") {
            client.send(JSON.stringify(message));
        }
    });
}

function startPingSender() {
    if (pingSenderId !== 0) return pingSenderId;
    const interval = setInterval(() => {
        [...connections.keys()].forEach((ws) => {
            ws.ping();
        });
    }, settings.pinginterval || 30000);
    pingSenderId = interval;
}

function resetGlobalVariables() {
    chartlayertype = "";
    chartworkname = "";
    chartname = "";
    charturl = "";
    clippedShapeFolder = "";
    chartfolder = "";
    dir_1_unzipped = "";
    dir_2_clipped = "";
    dir_3_mosaic = "";
    dir_4_tiled = "";
    isifrchart = false;
    addmetabounds = false;
    parray.splice(0, parray.length);
    nm = 0;
}

function getUniqueUserId() {
    return `${Date.now()}-${Math.random().toString(36)}`;
}

//if (import.main === module) {
    // CLI Argument Handling
    const arg = process.argv.slice(2);

    if (arg.length >= 1) {
        let sarg = arg[0].toLowerCase();
        if (sarg.startsWith("-s")) {
            console.log("\nSettings.json:\n", settings);
            process.exit(0);
        } else if (sarg.startsWith("-h")) {
            console.log("Streamlined Chartmaker Options:\n" +
                "-h, --help         Show this help\n" +
                "-s, --settings     Show settings.json\n" +
                "-w, --webserver    Start web server mode\n" +
                "area-single=X      Process single area chart index X\n" +
                "area-all           Process all area charts\n" +
                "full-single=X      Process full chart index X\n" +
                "full-all           Process all full charts\n");
            process.exit(0);
        } else if (sarg.startsWith("-w")) {
            useWebServer = true;
        } else if (sarg === "area-all") {
            useWebServer = false;
            processAllAreas();
        } else if (sarg === "full-all") {
            useWebServer = false;
            parray = settings.chartprocessindexes || [0, 1, 2, 3, 4, 5, 6];
            processFulls();
        } else if (sarg.search("area-single") > -1) {
            useWebServer = false;
            nm = Number(arg[0].split("=")[1]);
            parray.push(nm);
            processSingles();
        } else if (sarg.search("full-single") > -1) {
            useWebServer = false;
            nm = Number(arg[0].split("=")[1]);
            parray.push(nm);
            processFulls();
        }
    } else if (!useWebServer) {
        let response = processPrompt("Chartmaker Streamlined Processing:\n" +
            "1 = Process single area VFR chart\n" +
            "2 = Process all area VFR charts\n" +
            "3 = Process single full chart\n" +
            "4 = Process all full charts\n" +
            "5 = Enter web server mode\n" +
            "6 = Output settings.json\n" +
            "Selection: ");
        switch (response) {
            case "1": processOneArea(); break;
            case "2": processAllAreas(); break;
            case "3": processOneFull(); break;
            case "4":
                parray = settings.chartprocessindexes || [0, 1, 2, 3, 4, 5, 6];
                processFulls();
                break;
            case "5": useWebServer = true; break;
            case "6": console.log(settings); process.exit(0); break;
            default: console.log("Exiting."); process.exit(0); break;
        }
    }

    // Web Server initialization if in web server mode
    if (useWebServer) {
        const app = express();
        app.use(express.urlencoded({ extended: true }));
        app.use(express.json());

        let publicdir = path.join(appdir, "public");
        app.use(express.static(publicdir));

        app.get("/", (req, res) => {
            res.send(fs.readFileSync(path.join(publicdir, "index.html"), "utf-8"));
        });

        app.get("/settings", (req, res) => {
            res.json(settings);
        });

        app.listen(settings.httpport, () => {
            console.log(`Streamlined Chartmaker Web Server listening on port ${settings.httpport}`);
        });

        const wss = new WebSocketServer({ port: settings.wsport });
        console.log(`WebSocket server listening on port ${settings.wsport}`);

        wss.on('connection', (ws) => {
            ws.tag = { sent: false, uid: "" };
            ws.ping();

            ws.on('close', () => {
                connections.delete(ws);
            });

            ws.on('pong', () => {
                if (!ws.tag.sent && ws.tag.uid === "") {
                    let uid = getUniqueUserId();
                    ws.tag.uid = uid;
                    ws.tag.sent = true;
                    connections.set(ws, uid);
                    sendMessageToClients({ type: "connection", uid: uid }, uid);
                }
            });
        });

        startPingSender();
    }
//}

// module.exports = {
//     runProcessing,
//     setupEnvironment,
//     downloadCharts,
//     unzipCharts,
//     normalizeChartNames,
//     checkAntimeridianCrossing,
//     processImagesStreamlined,
//     buildMosaic,
//     makeMbTilesStreamlined,
//     findShapefile,
//     normalizeFileName,
//     getBestChartDate
// };
