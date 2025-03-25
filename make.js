'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const readlineSync = require('readline-sync');
const path = require('path');

// set the base application folder, this will change if running in docker
let appdir = __dirname;

class ProcessTime {
    constructor(processName) {
        this.processname = processName;
        this.startdate = new Date(new Date().toLocaleString());
        this.totaltime = "";
    }

    calculateProcessTime() {
        let date2 = new Date(new Date().toLocaleString());

        // the following is to handle cases where the times are on the opposite side of
        // midnight e.g. when you want to get the difference between 9:00 PM and 5:00 AM

        if (date2 < this.startdate) {
            date2.setDate(date2.getDate() + 1);
        }

        let msec = date2 - this.startdate;
        let hh = Math.floor(msec / 1000 / 60 / 60);
        msec -= hh * 1000 * 60 * 60;
        let mm = Math.floor(msec / 1000 / 60);
        msec -= mm * 1000 * 60;
        let ss = Math.floor(msec / 1000);
        msec -= ss * 1000;

        this.totaltime = `${this.processname} processing time: ${hh}:${mm}:${ss}`;
    }
}

/**
 * Utility to see if we are in a docker container
 * @returns boolean
 */
let isdocker = isRunningInDocker();
function isRunningInDocker() {
    let indocker = false;
    try {
        let r = execSync(`cat /proc/1/cgroup`, {encoding: "utf8"});
        indocker = (r.search("/docker/") > -1);
    }
    catch {}
    if (indocker) {
        console.log("Running in docker!");
        appdir = "/chartmaker";
    }
    return indocker;
}

/**
 * Handle all prompting for input
 */
function processPrompt(message) {
    return readlineSync.question(message); 
}

const timings = new Map();
const settings = JSON.parse(fs.readFileSync(`${appdir}/settings.json`, "utf-8"));

/** 
 *  Set the time zone of this process to the value in settings if it exists.
 *  See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones for
 *  for an exhaustive list of valid timezone string values. 
 */ 
if (settings.timezone != "") {
    process.env.TZ = settings.timezone; 
}

/**
 * Get the number of available processes
 * @returns integer
 */
function getProcessCount() {
    let pc = 4; // default
    try {
        let r = execSync(`grep -c "^processor" /proc/cpuinfo`, { encoding: 'utf8'});
        pc = Number(r.replace('\n', ""));
        logEntry(`Processor count = ${pc}`)
    }
    catch {}
    return pc;
}

// logging
let logfd = 0;
const setupDebugLog = function(logfolder) {
    if (settings.logtofile) {
        logfd = fs.openSync(`${logfolder}/debug.log`, 'w', 0o666);
    }
}
const logEntry = function(entry) {
    if (settings.logtofile) {
        fs.writeSync(logfd, `${entry}\n`)
    }
    else {
        console.log(entry);
    }
}

// Get the current chart date from the chartdates.json file
let expiredate = "";
const chartdate = getBestChartDate();

// used for process timing
const startdate = new Date(new Date().toLocaleString());

// make sure these base level folders exist
let workarea = path.join(appdir, "workarea");
if (settings.renameworkarea) workarea += `_${chartdate}`;
if (!fs.existsSync(workarea)) fs.mkdirSync(workarea)

let chartcache = path.join(appdir, "chartcache");
if (!fs.existsSync(chartcache)) fs.mkdirSync(chartcache);

let dbfolder = path.join(appdir, "charts");
if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder)
    
if (isdocker) {
    //see if we have an external chart folder volume
    let extcharts = path.join(appdir, "externalcharts");
    if (fs.existsSync(extcharts)) {
        dbfolder = extcharts;
        return;
    }
}
else {
    let dbf = settings.externaldbfolder;
    if ((dbf.length > 0) && (fs.existsSync(dbf))) {
        dbfolder = dbf;
    }
}

let imageformat = settings.tiledrivers[settings.tiledriverindex];
let chartlayertype = "";
let chartworkname = "";
let chartname = "";
let charturl = "";
let clippedShapeFolder = "";
let cmd = "";
let chartfolder = "";
let dir_1_unzipped = "";
let dir_2_expanded = "";
let dir_3_clipped = "";
let dir_4_tiled = "";
let dir_5_merged = "";
let dir_6_quantized = "";
let isifrchart = false;
let wgsbounds = [];
let addmetabounds = false;

/**
 * Chart processing starts here
 */
let parray = [];
let jsonarray = settings.individualchartlist;
let nm = 0;
let processes = getProcessCount();

let arg = process.argv.slice(2);

if (settings.usecommandline) {
    if (arg.length >= 1) {
        let chart = "";
        let sarg = arg[0].toLowerCase();
        if (sarg === "-s") {
            // output settings.json
            
            console.log("\r\n\r\n----------------------------------------------------------------------------------\r\n" +
                        "Settings.json\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
            console.log(settings);
            console.log("\r\n\r\n\r\n");
            process.exit();
        }
        else if (sarg === "-h") {
            console.log("Command line options:\r\n" +
                        "----------------------------------------------------------------------------------\r\n" +
                        "-h, --help      Show this help\r\n" +
                        "-s, --settings  Show all values in settings.json\r\n" +
                        "----------------------------------------------------------------------------------\r\n" +
                        "area-single=X   Process one area chart where X is the index in the area chart list\r\n" +
                        "area-all        Process all 53 area VFR charts individually\r\n" +
                        "full-single=X   Process one full chart where X is an index in the full chart list\r\n" +
                        "full-all        Process all of the full charts in the full chart list\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
                        process.exit();
        }
        else if (sarg === "area-all") {
            processAllAreas();
        }
        else if (sarg === "full-all") {
            processAllFull();
        }
        else if (sarg.search("area-single") > -1) {
            try {
                nm = Number(arg[0].split("=")[1]);
                chart = settings.individualchartlist[nm][1].replace("_", " ");
                console.log(`Processing area chart: ${chart}`);
                parray.push(nm);
                processSingles(parray);
            }
            catch {
                console.log("Index error in argument, format is: area-single=X where X is a valid vfr chart index number (see settings.json.) Exiting chartmaker!");
                process.exit();
            }
        }
        else if (sarg.search("full-single") > -1) {
            try {
                nm = Number(arg[0].split("=")[1]);
                chart = settings.fullchartlist[nm][0].replace("_", " ");
                if (chart === "DDECUS") chart = settings.fullchartlist[nm][2].replace("_", " ");
                console.log(`Processing full chart: ${chart}`);
                parray.push(nm);
                processFulls(parray);
            }
            catch {
                console.log("Index error in argument, format is: full-single=X where X is a valid full chart index number (see settings.json.) Exiting chartmaker!");
                process.exit();
            }
        }
    }
    else {
        let response = processPrompt("Select:\r\n" +
                                    "----------------------------------------------------------------\r\n" +
                                    "1 = Process a single area VFR chart\r\n" +
                                    "2 = Process all 53 area VFR charts individually\r\n" +
                                    "3 = Process a single full chart from the full chart list\r\n" +
                                    "4 = Process all of the full charts in the full chart list\r\n" +
                                    "5 = Generate a GeoTIFF from a mbtiles database\r\n" +
                                    "----------------------------------------------------------------\r\n" +
                                    "Your selection: "); 
        switch (response) {
            case "1":
                processOneArea();
                break;
            case "2":
                processAllAreas();
                break;
            case "3":
                processOneFull();
                break;
            case "4":
                parray = settings.chartprocessindexes;
                processFulls(parray);
                break;
            case "5":
                generateGeoTIFF();
                break;
            default:
                console.log("Invalid response - exiting chartmaker!");
                break;
        }
    }
}
else {
    parray = settings.chartprocessindexes;
    processFulls(parray);
}

function processOneArea() {
    let lst = "\nSelect the chart number you want to process from this list\r\n\r\n";
    for (var i = 0; i <  jsonarray.length; i++) {
        lst += `${i} ${jsonarray[i][1].split("_").join(" ")}\r\n`; 
    }
    lst += "--------------------------------------------\r\nYour selection: ";
    let response = processPrompt(lst);
    nm = Number(response);

    if (nm >= 0 && nm < jsonarray.length) {
        parray.push(nm);
        processSingles(parray);
    }
    else {
        console.log("Invalid response, exiting chartmaker!");
        process.exit();
    }
}

function processAllAreas() {    
    console.log("\r\nProcessing all 53 chart areas...\r\n");
    for (var i = 0; i < 53; i++) {
        parray.push(i);
    }
    processSingles(parray);
}

function processSingles(parray) {
    addmetabounds = true;   
    for (var x = 0; x < parray.length; x++) {
        chartworkname = jsonarray[parray[x]][1];
        chartname = chartworkname;
        clippedShapeFolder = path.join(appdir, "clipshapes", "sectional");
        chartlayertype = settings.layertypes[settings.layertypeindex];
        chartfolder = `${workarea}/${chartworkname}`;
        charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
        console.log(charturl);
        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);
        runProcessing();
        console.log(`${cpt.totaltime}\r\n`);
    }
}

function processOneFull() {
    let lst = "\nSelect the full chart number you want to process from this list\r\n\r\n";
    let i = 0;
    settings.fullchartlist.forEach((fullchart) => {
        let cname = fullchart[0] === "DDECUS" ? fullchart[2] : fullchart[0];
        lst += `${i} ${cname.split("_").join(" ")}\r\n`;
        i++;
    });
    lst += "--------------------------------------------\r\nYour selection: ";
    let response = processPrompt(lst);
    nm = Number(response); 

    if (nm >= 0 && nm < settings.fullchartlist.length) {
        parray.push(nm);
    }
    else {
        console.log("Invalid response, exiting!");
        process.exit();
    }
    processFulls(parray);
}

function processFulls() {
    parray.forEach((index) => {
        let chart = settings.fullchartlist[index]; 
        let lcasename = chart[0].toLowerCase();
        let charttype = chart[1];

        chartworkname = chart[0]; 
        chartlayertype = settings.layertypes[settings.layertypeindex];

        if (charttype === "ifr") {
            isifrchart = true;
            lcasename = chart[2].toLowerCase();
            charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = settings.fullchartlist[index][2]; // use alias value for IFR
            chartfolder = path.join(workarea, chartname);
        }
        else { // vfr
            if (lcasename === "us_vfr_wall_planning") {
                charturl = `${settings.usvfrwallplanningtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
            }
            else {
                charturl = settings.vfrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            }
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = chartworkname;
            chartfolder = `${workarea}/${chartworkname}`;
        }
        
        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);
        runProcessing();
        console.log(`${cpt.totaltime}\n`);
    });
}

function generateGeoTIFF() {
    let question = "Enter the full path and filename of your mbtiles file: ";
    let mbtilesfile = processPrompt(question);
    if (fs.existsSync(mbtilesfile)) {
        question = "Enter the full path and filename of the geoTIFF that will be created: "
        let geotiff = processPrompt(question);
        cmd = `gdal_translate -of GTiff -co BIGTIFF=YES ${mbtilesfile} ${geotiff}`;
        executeCommand(cmd);
    }
    else {
        console.log("ERROR: The specified mbtiles file does not exist, exiting chartmaker!");
    }
}

function runProcessing() {
    dir_1_unzipped = path.join(chartfolder, "1_unzipped");
    dir_2_expanded = path.join(chartfolder, "2_expanded");
    dir_3_clipped = path.join(chartfolder, "3_clipped");
    dir_4_tiled = path.join(chartfolder, "4_tiled");
    dir_5_merged = path.join(chartfolder, "5_merged");
    dir_6_quantized = path.join(chartfolder, "6_quantized");
    
    setupEnvironment();
    downloadCharts();
    unzipCharts();
    normalizeChartNames();
    processImages();
    mergeAndQuantize();
    makeMbTiles();
}

if (settings.cleanprocessfolders) {
    let workfiles = fs.readdirSync(workarea)
    workfiles.forEach(file => {
        if (!file.endsWith(".db")) {
            cmd = `rm -r -f ${workarea}/${file}`;
            executeCommand(cmd);
        }
    });    
}

reportProcessingTime();
process.exit();

/**
 * Generate all of the working folders for image processing
 */
function setupEnvironment() {
    // make sure the working folder for this chart is cleared out
    fs.rmSync(chartfolder, { recursive: true, force: true });
    
    // OK, now create all of the workarea folders
    fs.mkdirSync(chartfolder);
    
    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped);
    if (!fs.existsSync(dir_2_expanded)) fs.mkdirSync(dir_2_expanded);
    if (!fs.existsSync(dir_3_clipped)) fs.mkdirSync(dir_3_clipped);
    if (!fs.existsSync(dir_4_tiled)) fs.mkdirSync(dir_4_tiled);
    if (!fs.existsSync(dir_5_merged)) fs.mkdirSync(dir_5_merged);
    if (!fs.existsSync(dir_6_quantized)) fs.mkdirSync(dir_6_quantized);
    if (settings.logtofile) setupDebugLog(chartfolder);
    logEntry("Created all workarea subfolders");
}

/**
 * Get the desired chart zip file from the FAA's digital sources URL
 */
function downloadCharts() {
    let chartzip = `${chartcache}/${chartworkname}-${chartdate}.zip`;
    if (fs.existsSync(chartzip)) {
        logEntry(`Using cached ${chartzip}`);
        return;
    }
    else {
        let oldfiles = fs.readdirSync(chartcache);
        for (var i = 0; i < oldfiles.length; i++) {
            if (oldfiles[i].startsWith(chartworkname)) {
                fs.rmSync(`${chartcache}/${oldfiles[i]}`);
                break;
            }
        }
        logEntry(`Downloading ${chartzip}`);
        cmd = `curl ${charturl} -o ${chartzip}`;
        executeCommand(cmd);
    }
}

/**
 * Unzip chart file
 */
function unzipCharts() {
    let chartzip = `${chartcache}/${chartworkname}-${chartdate}.zip`;
    cmd = `unzip -o ${chartzip} -x '*.htm' -d ${dir_1_unzipped}`;
    executeCommand(cmd);

    if (isifrchart) { // we now have a work area full of IFR zip files
        let zipfiles = fs.readdirSync(dir_1_unzipped);
        zipfiles.forEach(zipfile => {
            let srchstr = chartname === "Enroute_High" ? "ENR_H" : "ENR_L" // only unzip the indicated type
            if (zipfile.search(srchstr) > -1) {
                cmd = `unzip -o ${dir_1_unzipped}/${zipfile} -d ${dir_1_unzipped}`;
                executeCommand(cmd);
            }
        });
    }

    // now clean out all of the irrelevant files...
    cmd = `rm -r -f ${dir_1_unzipped}/*.pdf`;
    executeCommand(cmd);

    cmd = `rm -r -f ${dir_1_unzipped}/*.htm`;
    executeCommand(cmd);

    cmd = `rm -r -f ${dir_1_unzipped}/*.zip`;
    executeCommand(cmd);

    // This chart is a recent addition to the zip file from the FAA.
    // It does not have a processing option, but as it is included 
    // in the .zip file, it has no matching .tfw file with wsgbounds 
    // and crashes the process, so we will just eliminate it.
    // Maybe in the future it could be added as a separate option.
    cmd = `rm -r -f "${dir_1_unzipped}/Caribbean Planning Chart.tif"`;
    executeCommand(cmd);
}

/** 
 * Clean up chart tif names by converting spaces and dashes to underscores
 */
function normalizeChartNames() {
    let files = fs.readdirSync(dir_1_unzipped);
    files.forEach((file) => {
        if (file.endsWith(".tif") || file.endsWith(".tfw") || file.endsWith(".tfwx")) {
            let newfile = normalizeFileName(file);
            fs.renameSync(path.join(dir_1_unzipped, file), path.join(dir_1_unzipped, newfile));
        }
    });
}

/**
 * Perform GDAL operations on all the unzipped chart tif images 
 */
function processImages() {
    /*-----------------------------------------------------------------------
     1) GDAL_TRANSLATE: Expand color table to RGBA
     2) GDALWARP: Warp chart to EPSG:4326 and clip off the borders and legend
     3) GDALADDO: Generate overviews of the VRT for all zoom levels 
     4) GDAL2TILES: Convert overviews into tiled PNG images
    -------------------------------------------------------------------------*/

    let chartareas = buildChartNameArray();
    let cblend = settings.blendpixels;

    chartareas.forEach((area) => {
        logEntry(`* chart ${area}`);
        let shapefile = `${clippedShapeFolder}/${area}.shp`;
        let clipped = `${dir_3_clipped}/${area}.vrt`;
        let sourcetif = `${dir_1_unzipped}/${area}.tif`;
        let expanded = `${dir_2_expanded}/${area}.vrt`
        let tiled = `${dir_4_tiled}/${area}`
        let expandopt = "";

        // determine if RGB expansion is required
        cmd = `gdalinfo -json "${sourcetif}"`;
        let infojson = JSON.parse(execSync(cmd));
        if (infojson.bands.length === 1) {
            expandopt = "-expand rgb";
        }

        wgsbounds = infojson.wgs84Extent.coordinates[0];

        logEntry(`>> gdal_translate ${sourcetif}`);
        cmd = `gdal_translate -strict -of vrt -ovr NONE ${expandopt} ${sourcetif} ${expanded}`;
        executeCommand(cmd);

        logEntry(`>> gdalwarp warping and clipping ${clipped} using shapefile ${shapefile}`);
        cmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 256 -multi -cblend ${cblend} -cutline ${shapefile} -crop_to_cutline ${expanded} ${clipped}`;
        executeCommand(cmd);

        // setup formatting arguments for overviews        
        let formatargs = `--tiledriver=${imageformat.toUpperCase()} `;
        let configargs = "";
        switch (imageformat) {
            case "webp":
                configargs = `--config WEBP_LOSSLESS_OVERVIEW YES --config WEBP_LEVEL_OVERVIEW ${settings.tileimagequality}`;
                formatargs += `--webp-quality=${settings.tileimagequality} --webp-lossless`;
                break;
            case "jpeg":
                configargs = `--config JPEG_QUALITY_OVERVIEW ${settings.tileimagequality}`;
                break;     
            default:
                // no adjustments for PNG images
                break;
        }

        if (settings.addoverviews) {
            logEntry(`>> gdaladdo adding overviews to ${clipped}`);
            cmd = `gdaladdo ${configargs} --config GDAL_NUM_THREADS ALL_CPUS ${clipped}`;
            executeCommand(cmd)
        }

        logEntry(`>> gdal2tiles tiling ${clipped} into ${tiled}`);
        cmd = `gdal2tiles.py --zoom=${settings.zoomrange} --processes=${processes} ${formatargs} --tmscompatible --webviewer=openlayers ${clipped} ${tiled}`;
        executeCommand(cmd);
    });
}

/**
 * Merge all of the individual chart zoom folders into a single master chart folder 
 */
function mergeAndQuantize() {
    let ptm = new ProcessTime("mergetiles.py");
    logEntry(`Executing mergetiles.py Python script to merge tiles into ${dir_5_merged}\n`);

    cmd = `python3 ${appdir}/mergetiles.py ${processes} ${dir_4_tiled} ${dir_5_merged}`;

    executeCommand(cmd);

    ptm.calculateProcessTime();
    logEntry(`${ptm.totaltime}\n`);

    // Only quantize png images, webp images are quantized via tiling option...
    if (imageformat === "png" && settings.tileimagequality < 100) {
        quantizePngImages();
    }
}

/**
 * Perform quantization of all .png images
 */
function quantizePngImages() {
    let interimct = 0;
    let i;
    let qcmd = "";
    let cmds = buildQuantizingCommandArray();
    let quantcmd = `pngquant --strip --skip-if-larger --force --quality ${settings.tileimagequality}`;
    logEntry(`quantizing ${cmds.length} png images at ${settings.tileimagequality}% --------------`);

    for (i = 0; i < cmds.length; i++) {
        qcmd = `${quantcmd} ${cmds[i][0]} --output ${cmds[i][1]}`;
        try {
            execSync(qcmd, { stdio: 'inherit' });
        }
        catch (error) {
            // if there is a error quantizing, just copy the original image
            let file0 = cmds[i][0];
            let file1 = cmds[i][1];
            qcmd = `cp -f ${file0} ${file1}`;
            executeCommand(qcmd);
        }
        interimct++;
        if (interimct >= 1000) {
            logEntry(`${i + 1} of ${cmds.length} images processed`);
            interimct = 0;
        }
    }
    logEntry(`>> Total processed image count = ${cmds.length}`);
}

/**
 * Create the mbtiles database 
 */
function makeMbTiles() {

    logEntry(`>> generating metadata json for ${chartname} database`);
    let sourcefolder = dir_5_merged;
    let zooms = settings.zoomrange.split("-");
    let minzoom = zooms[0];   
    let maxzoom = zooms.length > 1 ? zooms[1] : zooms[0];
    
    // if png and any quality below 100%, use the quantized workarea folder
    if (imageformat === "png" && settings.tileimagequality < 100) {
        sourcefolder = dir_6_quantized;
    }
    
    let chartdesc = chartname.split("_").join(" "); // normalize description

    let addedbounds = "";
    if (addmetabounds) {
        let metabounds = calculateBounds();
        addedbounds = `"bounds": "${metabounds[0]},${metabounds[1]},${metabounds[2]},${metabounds[3]}",` +
                      `"center": "${metabounds[4][0]},${metabounds[4][1]},${settings.centerzoomlevel}",`
    }
    let metajson = `{
        "name": "${chartname}",
        "description": "${chartdesc} Chart",
        "version": "1.1",
        ${addedbounds}
        "type": "${chartlayertype}",
        "format": "${imageformat}",
        "quality": ${settings.tileimagequality},
        "minzoom": ${minzoom},
        "maxzoom": ${maxzoom},
        "attribution": "${settings.attribution}",
        "scheme": "tms",
        "valid": "${chartdate}",
        "expires": "${expiredate}"
    }`;
    
    let fpath = path.join(sourcefolder, "metadata.json");
    let fd = fs.openSync(fpath, 'w'); 
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dbfolder}/${chartname}.${settings.dbextension}`;
    fs.rmSync(mbtiles, { force: true });  
    
    logEntry(`>> creating database: ${mbtiles}`);
    
    cmd = `python3 ${appdir}/mbutil/mb-util --image_format=${imageformat} --silent --scheme=tms ${sourcefolder} ${mbtiles}`;
    executeCommand(cmd, false);

    let cpt = timings.get(chartname);
    cpt.calculateProcessTime();
}

/**
 * Get the bounds of the processed GEOTIFF for database metadata
 */
function calculateBounds() {
    let lngdiff = (Math.abs(wgsbounds[0][0]) - Math.abs(wgsbounds[2][0])) / 2;
    let latdiff = (Math.abs(wgsbounds[0][1]) - Math.abs(wgsbounds[2][1])) / 2;
    let center = [wgsbounds[0][0] + lngdiff, wgsbounds[0][1] - latdiff];
    return [`${wgsbounds[0][0]}`, `${wgsbounds[0][1]}`, `${wgsbounds[2][0]}`, `${wgsbounds[2][1]}`, `${center}`];
}

/**
 * Called by processImages() so it can iterate through all unzipped chart names
 * @returns array containing all of the chart names to be processed
 */
function buildChartNameArray() {
    let files = fs.readdirSync(dir_1_unzipped);
    let chartnames = [];
    files.forEach((file) => {
        if (file.search("new_york_vfr_plannings_.tif") === -1) {
            let fname = file.toLowerCase();
            if ((fname.endsWith(".tif")) &&
                (fname.search("fly") === -1)) {
                    let cname = fname.replace(".tif", "");
                    chartnames.push(cname);
            }
        }
    });
    return chartnames;
}

/**
 * Called by quantizePngImages() to build processing commands for the pngquant utility
 * @returns array containing all pngquant commands
 */
function buildQuantizingCommandArray() {
    let mergedfolders = fs.readdirSync(dir_5_merged);
    let cmdarray = [];
    mergedfolders.forEach((zoomlevel) => {
        let zoomfolder = path.join(dir_5_merged, zoomlevel);
        if (fs.statSync(zoomfolder).isDirectory()) {
            let quantzoomfolder = path.join(dir_6_quantized, zoomlevel);
            if (!fs.existsSync(quantzoomfolder)) {
                fs.mkdirSync(quantzoomfolder);
            }
            let xfolders = fs.readdirSync(zoomfolder);
            xfolders.forEach((x) => {
                let y = path.join(zoomfolder, x);
                let quantizedfolders = path.join(quantzoomfolder, x);
                if (!fs.existsSync(quantizedfolders)) {
                    fs.mkdirSync(quantizedfolders);
                }

                // build an array of chart names
                let images = fs.readdirSync(y);
                images.forEach((image) => {
                    let imgpath = path.join(y, image);
                    let outpath = path.join(quantizedfolders, image);
                    let subarray = new Array(imgpath, outpath);
                    cmdarray.push(subarray);
                });
            });
        }
    });
    return cmdarray;
}

/**
 * Get rid of spaces and dashes in chart names and "normalize" with underscores
 * @param {string} file 
 * @returns string with underscores instead of spaces or dashes
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
 * Iterate through the chartdates.json file that contains chart publication dates
 * @returns the closest date of currently available FAA published charts 
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
        cdates.push(new Date(cdate))
    });

    let sortedDates = cdates.sort((a, b) => b.date - a.date);

    sortedDates.forEach((dateobj) => {
        if (!found) {
            let dtime = new Date(dateobj).getTime();
            let tdiff = thistime - dtime;
            let tdays = tdiff / (1000 * 3600 * 24);
            let diffdays = parseInt(tdays.toFixed(0));
            if (diffdays >= -20 && diffdays <= 36) {
                let m = pad2(dateobj.getMonth() + 1); // months (0-11)
                let d = pad2(dateobj.getDate());    // day (1-31)
                let y = dateobj.getFullYear();
                selectedDate = `${m}-${d}-${y}`;
                found = true;
            }
        }
        else {
            if (expiredate === "") {
                let m = pad2(dateobj.getMonth() + 1); // months (0-11)
                let d = pad2(dateobj.getDate());    // day (1-31)
                let y = dateobj.getFullYear();
                expiredate = `${m}-${d}-${y}`;
            }
        }
    });

    if (!found) {
        throw new Error("No suitable chart date was found!");
    }
    else {
        return selectedDate;
    }
}

/**
 * Execute the passed in command and log the result
 * @param {string} command 
 */
function executeCommand(command, logstdout = null) {
    try {
        if (logstdout == null) {
            logstdout = settings.debug;
        }
        const stdout = execSync(command).toString();
        if (logstdout) {
            logEntry(stdout);
        }
    }
    catch (error) {
        logEntry(error.message);
    }
}

/**
 * Generate console comment with start, end, and total time of processing run 
 */
function reportProcessingTime() {

    let date2 = new Date(new Date().toLocaleString());

    // the following is to handle cases where the times are on the opposite side of
    // midnight e.g. when you want to get the difference between 9:00 PM and 5:00 AM

    if (date2 < startdate) {
        date2.setDate(date2.getDate() + 1);
    }

    let msec = date2 - startdate;
    let hh = Math.floor(msec / 1000 / 60 / 60);
    msec -= hh * 1000 * 60 * 60;
    let mm = Math.floor(msec / 1000 / 60);
    msec -= mm * 1000 * 60;
    let ss = Math.floor(msec / 1000);
    msec -= ss * 1000;
    // diff = 28800000 => hh = 8, mm = 0, ss = 0, msec = 0
    logEntry(`Start time: ${startdate}\r\nEnd time: ${date2}\r\nTotal processing time: ${hh}:${mm}:${ss}`);
}

 /**
  * Utility to left-pad zeros for numbers under 10
  * @param {number} n 
  * @returns {string}
  */
 function pad2(n) {
    let nn = `${n}`;
    if (n < 10)
        nn = `0${nn}`;
    else
        nn = `${n}`;
    return nn;
}
/**
 * Utility to make sure clipping files are all lower-case
 */
function normalizeClipNames() {
    let files = fs.readdirSync(clippedShapeFolder);
    try {
        files.forEach((file) => {
            let oldname = path.join(clippedShapeFolder, file);
            let newname = oldname.toLowerCase();
            fs.renameSync(oldname, newname);
        });
    }
    catch (err) {
        logEntry(err.message);
    }
}
