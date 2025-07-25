'use strict';

const fs = require('fs');
const { execSync, spawn } = require('child_process');
const readlineSync = require('readline-sync');
const path = require('path');
const express = require('express');
const favicon = require('serve-favicon');
const WebSocket = require('ws');
const archiver = require ('archiver');

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
    constructor(command, chart, rowindex, chartname) {
        this.command = command;
        this.chart = chart;
        this.rowindex = rowindex;
        this.chartname = chartname;
    }
}

class ProcessTime {
    constructor(processName) {
        this.processname = processName.replaceAll("_", " ");
        this.startdate = new Date(new Date().toLocaleString());
        this.totaltime = "";
        this.logtime = "";
    }

    calculateProcessTime() {
        let pt = ProcessTime.reportProcessingTime(this.startdate);
        this.totaltime = `time: ${pt}`;
    }

    static reportProcessingTime(startdate) {
        let date2 = new Date(new Date().toLocaleString());
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

        let phh = pad2(hh);
        let pmm = pad2(mm);
        let pss = pad2(ss);
        let ttime = `${phh}:${pmm}:${pss}`;
        logEntry(`Start time: ${startdate}, End time: ${date2}, Total time: ${ttime}`);
        return ttime;
    }
};

// create websocket variables
var connections = new Map();
var inMakeLoop = false;
var pingSenderId = 0;

// set the base application folder, this will change if running in docker
let appdir = __dirname;

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

const settings = JSON.parse(fs.readFileSync(path.join(appdir, "settings.json"), "utf-8")).settings;
var useWebServer = settings.webservermode;
var timings = new Map();

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
        logfd = fs.openSync(path.join(logfolder, "debug.log"), 'w', 0o666);
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

function pad2(n) {
    let nn = `${n}`;
    if (n < 10) {
        nn = `0${nn}`;
    }
    return nn;
}

// Get the current chart date from the chartdates.json file
let expiredate = "";
const chartdate = getBestChartDate();
const remotemenu = JSON.parse(fs.readFileSync(path.join(appdir, "remotemenu.json"), "utf-8"));
const users = JSON.parse(fs.readFileSync(path.join(appdir, "users.json"), "utf-8")).users;
const zipfilename = settings.zipfilename;
const zipfilepath = path.join(appdir, "public", "charts", chartdate, zipfilename); 

// used for process timing
const startdate = new Date(new Date().toLocaleString());

// make sure these base level folders exist
let workarea = path.join(appdir, "workarea");
if (settings.renameworkarea) workarea += `_${chartdate}`;
if (!fs.existsSync(workarea)) fs.mkdirSync(workarea)

let chartcache = path.join(appdir, "chartcache");
if (!fs.existsSync(chartcache)) fs.mkdirSync(chartcache);

let dbfolder = path.join(appdir, "public", "charts", chartdate);
if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder)
    
if (isdocker) {
    //see if we have an external chart folder volume
    let extcharts = path.join(appdir, "externalcharts");
    if (fs.existsSync(extcharts)) {
        dbfolder = extcharts;
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
let nm = 0;
let processes = getProcessCount();

let arg = process.argv.slice(2);

if (settings.usecommandline) {
    if (arg.length >= 1) {
        let chart = "";
        let sarg = arg[0].toLowerCase();
        if (sarg.startsWith("-s")) {
            // output settings.json
            
            console.log("\r\n\r\n----------------------------------------------------------------------------------\r\n" +
                        "Settings.json\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
            console.log(settings);
            console.log("\r\n\r\n\r\n");
            process.exit();
        }
        else if (sarg.startsWith("-h")) {
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
                chart = settings.areachartlist[nm][1].replace("_", " ");
                console.log(`Processing area chart: ${chart}`);
                parray.push(nm);
                processSingles();
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
                processFulls();
            }
            catch {
                console.log("Index error in argument, format is: full-single=X where X is a valid full chart index number (see settings.json.) Exiting chartmaker!");
                process.exit();
            }
        }
    }
    else {
        if (settings.webservermode) {
            enterWebserverMode();
        }
        else {
            let response = processPrompt("Select:\r\n" +
                                    "--------------------------------------------------------------------\r\n" +
                                    "1 = Process a single area VFR chart\r\n" +
                                    "2 = Process all 53 area VFR charts individually\r\n" +
                                    "3 = Process a single full chart from the full chart list\r\n" +
                                    "4 = Process all of the full charts in the full chart list\r\n" +
                                    "5 = Generate a GeoTIFF from a mbtiles database\r\n" +
                                    "6 = Put chartmaker into webserver mode (new feature)\r\n" +
                                    "7 = Output the settings.json file to the console\r\n" +
                                    "---------------------------------------------------------------------\r\n\r\n" +
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
                    processFulls();
                    break;
                case "5":
                    generateGeoTIFF();
                    break;
                case "6":
                    enterWebserverMode();
                    break;
                case "7":
                    console.log(settings);
                    console.log("\r\n\r\n\r\n");
                    process.exit();
                default:
                    console.log("Exiting chartmaker!");
                    break;
            }
        }
    }
}
else {
    parray = settings.chartprocessindexes;
    processFulls();
}

function processOneArea(area = -1) {
    if (area == -1) {
        let lst = "\nSelect the chart number you want to process from this list\r\n\r\n";
        for (var i = 0; i <  settings.areachartlist.length; i++) {
            lst += `${i} ${settings.areachartlist[i].split("_").join(" ")}\r\n`; 
        }
        lst += "--------------------------------------------\r\nYour selection: ";
        let response = processPrompt(lst);
        nm = +response;
    }
    else {
        nm = +area;
    }

    try {
        if (nm >= 0 && nm < settings.areachartlist.length) {
            parray.push(nm);
            processSingles();
        }
        else {
            console.log("Invalid response, exiting chartmaker!");
            process.exit();
        }
    }
    catch(err) {
        console.error(err);
    }
}

function processAllAreas() {    
    console.log("\r\nProcessing all 53 chart areas...\r\n");
    for (var i = 0; i < 53; i++) {
        parray.push(i);
    }
    processSingles();
}

function processSingles(msgid = -1) {
    addmetabounds = true;   
    for (let idx = 0; idx < parray.length; idx++) {
        let doProcessing = true;
        chartworkname = settings.areachartlist[parray[idx]];
        chartname = chartworkname;
        clippedShapeFolder = path.join(appdir, "clipshapes", "sectional");
        chartlayertype = settings.layertypes[settings.layertypeindex];
        chartfolder = path.join(workarea, chartworkname);
        charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
        console.log(charturl);
        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);
        let chartdbfile = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
        if (fs.existsSync(chartdbfile)) {
            let stat = fs.statSync(chartdbfile);    
            const birthDate = stat.birthtime;
            const year = birthDate.getFullYear();
            const month = String(birthDate.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
            const day = String(birthDate.getDate()).padStart(2, '0');
            const formattedDate = `${month}-${day}-${year}`;
            if (formattedDate === chartdate) {
                // Current version of this chart exists, no processing needed
                doProcessing = false;
                cpt.totaltime = "Download:";
            }
        }
        if (doProcessing) {
            runProcessing();
        }
        
        console.log(`${cpt.totaltime}\r\n`);
        
        // if this was a single chart process request,
        // return the resulting timing class object
        if (msgid > -1) {
            return cpt;
        }
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
    processFulls();
}

function processFulls(msgid = -1) {
    addmetabounds = true; 
    for (let idx = 0; idx < parray.length; idx++) { 
        let chart = settings.fullchartlist[parray[idx]]; 
        let lcasename = chart[0].toLowerCase();
        let charttype = chart[1];

        chartworkname = chart[0]; 
        chartlayertype = settings.layertypes[settings.layertypeindex];

        if (charttype === "ifr") {
            isifrchart = true;
            lcasename = chart[2].toLowerCase();
            charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = settings.fullchartlist[idx][2]; // use alias value for IFR
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
            chartfolder = path.join(workarea, chartworkname);
        }

        let cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);
        console.log(`${cpt.totaltime}\n`);

        let chartdbfile = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
        if (!fs.existsSync(chartdbfile)) {
            runProcessing();
        }
        
        if (msgid > -1) {
            return cpt;
        }
    };
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

    if (settings.cleanprocessfolders === true) {
        cmd = `rm -rf ${workarea}`
        executeCommand(cmd);

        cmd = `mkdir ${workarea}`
        executeCommand(cmd);
    }    
}

if (!settings.usecommandline) {
    ProcessTime.reportProcessingTime(startdate);
}

/**
 * Generate all of the working folders for image processing
 */
function setupEnvironment() {
    
    // make sure the working folder for this chart is cleared out
    if (fs.existsSync(chartfolder)) {
        fs.rmSync(chartfolder, { recursive: true, force: true });
    }

    // Create the base workarea chart folder
    fs.mkdirSync(chartfolder);

    // OK, now create all of the workarea sub folders
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
    let chartzip = path.join(chartcache, `${chartworkname}-${chartdate}.zip`);
    if (fs.existsSync(chartzip)) {
        logEntry(`Using cached ${chartzip}`);
        return;
    }
    else { 
        let oldfiles = fs.readdirSync(chartcache);
        for (var i = 0; i < oldfiles.length; i++) {
            if (oldfiles[i].startsWith(chartworkname)) {
                fs.rmSync(path.join(chartcache, oldfiles[i]));
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
    let chartzip = path.join(chartcache, `${chartworkname}-${chartdate}.zip`);
    cmd = `unzip -o ${chartzip} -x '*.htm' -d ${dir_1_unzipped}`;
    executeCommand(cmd);

    if (isifrchart) { // we now have a work area full of IFR zip files
        let zipfiles = fs.readdirSync(dir_1_unzipped);
        zipfiles.forEach(zipfile => {
            let srchstr = chartname === "Enroute_High" ? "ENR_H" : "ENR_L" // only unzip the indicated type
            if (zipfile.search(srchstr) > -1) {
                cmd = `unzip -o ${path.join(dir_1_unzipped, zipfile)} -d ${dir_1_unzipped}`;
                executeCommand(cmd);
            }
        });
    }

    // now clean out all of the irrelevant files...
    cmd = `rm -r -f ${path.join(dir_1_unzipped, "*.pdf")}`;
    executeCommand(cmd);

    cmd = `rm -r -f ${path.join(dir_1_unzipped, "*.htm")}`;
    executeCommand(cmd);

    cmd = `rm -r -f ${path.join(dir_1_unzipped, "*.zip")}`;
    executeCommand(cmd);

    // This chart is a recent addition to the zip file from the FAA.
    // It does not have a processing option, but as it is included 
    // in the .zip file, it has no matching .tfw file with wsgbounds 
    // and crashes the process, so we will just eliminate it.
    // Maybe in the future it could be added as a separate option.
    cmd = `rm -r -f "${path.join(dir_1_unzipped, 'Caribbean Planning Chart.tif')}"`;
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
        let shpfile = `${area}.shp`;
        let vrtfile = `${area}.vrt`;
        let srcfile = `${area}.tif`;
        let shapefile = path.join(clippedShapeFolder, shpfile);
        let clipped = path.join(dir_3_clipped, vrtfile);
        let sourcetif = path.join(dir_1_unzipped, srcfile);
        let expanded = path.join(dir_2_expanded, vrtfile);
        let tiled = path.join(dir_4_tiled, area);
        let expandopt = "";

        // determine if RGB expansion is required
        cmd = `gdalinfo -json "${sourcetif}"`;
        let infojson = JSON.parse(execSync(cmd));
        if (infojson.bands.length === 1) {
            if (settings.outputgrayscale) {
                expandopt = "-expand gray"; 
            }
            else {
                expandopt = "-expand rgb";
            }
        }

        wgsbounds = infojson.wgs84Extent.coordinates[0];

        logEntry(`>> gdal_translate ${sourcetif}`);
        cmd = `gdal_translate -strict -of vrt -ovr NONE ${expandopt} ${sourcetif} ${expanded}`;
        executeCommand(cmd);

        logEntry(`>> gdalwarp warping and clipping ${clipped} using shapefile ${shapefile}`);
        cmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 256 -multi -cblend ${cblend} -cutline ${shapefile} -crop_to_cutline ${expanded} ${clipped}`;
        executeCommand(cmd);

        // If user specified grayscale but left the imageformat as 
        // webp, then force the imageformat to a default of png.
        if (settings.outputgrayscale && imageformat === "webp") {
            imageformat = "png";
        }
        
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
    let ptm = new ProcessTime("mergetiles.pl");
    let loc = path.join(appdir, "mergetiles.pl");
    logEntry(`Executing mergetiles.pl Perl script to merge tiles into ${dir_5_merged}\n`);
    cmd = `perl ${loc} ${dir_4_tiled} ${dir_5_merged}`;
    executeCommand(cmd, true);
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

    let mbtiles = path.join(dbfolder, `${chartname}.${settings.dbextension}`);
    fs.rmSync(mbtiles, { force: true });  
    
    logEntry(`>> creating database: ${mbtiles}`);
    
    cmd = `python3 ${path.join(appdir, "mbutil", "mb-util")} --image_format=${imageformat} --silent --scheme=tms ${sourcefolder} ${mbtiles}`;
    executeCommand(cmd, false);

    let cpt = timings.get(chartname); 
    cpt.calculateProcessTime();
}

/**
 * Get the bounds of the processed GEOTIFF for database metadata
 */
function calculateBounds() {
    try {
        let lngdiff = (Math.abs(wgsbounds[0][0]) - Math.abs(wgsbounds[2][0])) / 2;
        let latdiff = (Math.abs(wgsbounds[0][1]) - Math.abs(wgsbounds[2][1])) / 2;
        let center = [wgsbounds[0][0] + lngdiff, wgsbounds[0][1] - latdiff];
        return [`${wgsbounds[0][0]}`, `${wgsbounds[0][1]}`, `${wgsbounds[2][0]}`, `${wgsbounds[2][1]}`, `${center}`];
    }
    catch(error) {
        console.log(error);
    }
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
                let d = pad2(dateobj.getDate());      // day (1-31)
                let y = dateobj.getFullYear();
                selectedDate = `${m}-${d}-${y}`;
                found = true;
            }
        }
        else {
            if (expiredate === "") {
                let m = pad2(dateobj.getMonth() + 1); // months (0-11)
                let d = pad2(dateobj.getDate());      // day (1-31)
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

/**
 * Set the global useWebServer flag 
 */
function enterWebserverMode() {
    useWebServer = true;
    console.log("entering websocket mode")
}

/**
 * Iterate through any/all connected clients and send data
 * @param {message} json message object 
 */
async function sendMessageToClients(message, userid = "") {
    [...connections.keys()].forEach((client) => {
        if (userid === client.tag.uid || userid === "") {
            client.send(JSON.stringify(message));
        }
    });
}

// Set up a periodic ping interval
function startPingSender() {
    if (pingSenderId !== 0) {
        return pingSenderId;
    }
    const interval = setInterval(() => {
        [...connections.keys()].forEach((ws) => {
            ws.ping();
         });
    }, settings.pinginterval); 
    pingSenderId = interval;
}

function getTimingJsonObject() {
    let ptimes = [];
    [...timings.keys()].forEach((key) => {
        let cpt = timings.get(key);
        ptimes.push({chart: cpt.processname, timing: cpt.totaltime});
    });
    let tjson = {processtimes: ptimes};
    return tjson;
};

/**
 * Handle app closure and log the results
 */
process.on('exit', (code) => {
    if (pingSenderId !== 0) {
        try {
            clearInterval(pingSenderId);
            console.log("clearInterval called on ping sender");
        } 
        finally {}
    }
    console.log(`\nAbout to exit with code: ${code}`);
});

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Cleaning up...');
    // Perform cleanup operations here
    process.exit(0); // Exit gracefully
});

/**
 * Parse a command JSON object and send jobs to the right place
 * 
 * 0 = Process a single area VFR chart
 * 1 = Process all 53 area VFR charts individually
 * 2 = Process a single full chart from the full chart list
 * 3 = Process all of the full charts in the full chart list
 * 4 = Return the settings.json file
 * @param {*} message JSON object message
 */
async function processMakeCommands(message) {
    let idx = -1;
    let opt = -1;
    let item = {};
    let list = message.commandlist;
    let userid = message.uid;

    try {
        if (!inMakeLoop) {
            let msgclist = processCommandMessage(message);
            let msg = new AppMessage(AppMessage.mtCommandResponse);
            msg.uid = userid;
            msg.payload = "success";
            sendMessageToClients(msg, userid);
            sendMessageToClients(msgclist, userid);
        }
        inMakeLoop = true;
        outerloop: for (let i = 0; i < list.length; i++) {
            resetGlobalVariables();
            item = list[i];
            idx = Number(item.command);
            opt = Number(item.chart);
            
            console.log(`command: ${idx}, chart: ${opt}`);
            switch (idx) {
                case 0:
                    if (opt >= 0 && opt <= 52) {
                        parray.push(opt);
                        let ridx = i; // + 1;
                        let rmt = new AppMessage(AppMessage.mtRunning); 
                        rmt.rowindex = ridx;
                        rmt.filename = item.chartname;
                        sendMessageToClients(rmt, userid);

                        let cpt = processSingles(i);

                        let cmt = new AppMessage(AppMessage.mtComplete); 
                        cmt.rowindex = ridx; 
                        cmt.payload = cpt.totaltime;
                        cmt.dbfilename = `${chartname}.${settings.dbextension}`;
                        sendMessageToClients(cmt, userid);
                    }
                    break;
                case 1:
                    // no sub command
                    processAllAreas();
                    break;
                case 2:
                    if (opt >= 0 && opt <= 7) {
                        let ridx = i + 1;
                        parray.push(opt);
                        let rmt = new AppMessage(AppMessage.mtRunning);
                        rmt.rowindex = ridx;

                        let chart = settings.fullchartlist[opt][0].replace("_", " ");
                        if (chart === "DDECUS") chart = settings.fullchartlist[opt][2].replace("_", " ");
                        console.log(`Processing full chart: ${chart}`);
                        rmt.dbfilename = `${chartname}.${settings.dbextension}`;
                        sendMessageToClients(rmt, userid);

                        let cpt = processFulls(i);

                        let cmt = new AppMessage(AppMessage.mtComplete);
                        cmt.rowindex = ridx;
                        cmt.payload = cpt.totaltime;
                        cmt.dbfilename = `${chartname}.${settings.dbextension}`;
                        sendMessageToClients(cmt, userid);
                    }
                    break;
                case 3:
                    // no subcommand
                    for (let i = 0; i <= 7; i++ ) {
                        parray.push(i);
                        processFulls();
                    }
                    break;  
                case 4:
                    sendSettings = true;
                    break outerloop;
            }
        }
        let payload = ProcessTime.reportProcessingTime(startdate); 
        let timemsg = new AppMessage(AppMessage.mtTiming); 
        timemsg.payload = payload;
        sendMessageToClients(timemsg, userid);
    }
    catch(err){
        console.debug();
    }

    timings = null;
    timings = new Map();
    inMakeLoop = false;
}

function resetGlobalVariables() {
    chartlayertype = "";
    chartworkname = "";
    chartname = "";
    charturl = "";
    clippedShapeFolder = "";
    cmd = "";
    chartfolder = "";
    dir_1_unzipped = "";
    dir_2_expanded = "";
    dir_3_clipped = "";
    dir_4_tiled = "";
    dir_5_merged = "";
    dir_6_quantized = "";
    isifrchart = false;
    wgsbounds = [];
    addmetabounds = false;
    parray.splice(0, parray.length);
    nm = 0;
}

function processCommandMessage(message) {
    let clist = new AppMessage(AppMessage.mtCommand);
    clist.payload = { commandlist: [] };
    clist.uid = message.uid;
    
    try {
        if (message.type === AppMessage.mtSettings) {
            console.log("Settings command received");
            return;
        }
        else if(message.type === AppMessage.mtDownload) {
            console.log("Download command received");
            return;
        }
        else {
            if (message.commandlist.length > 0) {
                for (let i = 0; i < message.commandlist.length; i++) {
                    let tclcmd = +message.commandlist[i].command;
                    let tclcht = +message.commandlist[i].chart;
                    let strcmd = remotemenu.menuitems[tclcmd];
                    let strcht = "";
                    switch (tclcmd) {
                        case 0:
                            strcht = settings.areachartlist[tclcht]
                            strcht = strcht.replaceAll("_", " ");
                            break;
                        case 2:
                            strcht = settings.fullchartlist[tclcht][0];
                            strcht = strcht.replaceAll("_", " ");
                            break;
                        default:
                            strcht = "N/A";
                            break;
                    }     
                    clist.payload.commandlist.push({ command: strcmd, chart: strcht })
                }
            }
        }
    }
    catch(error) {
        console.log(error)
    }

    return clist;
}

function getUniqueUserId(){
    return `${Date.now()}-${Math.random().toString(36)}`;
}

/**
 * Start the express web server and open a websocket server
 */
(() => {
    if (useWebServer || settings.webservermode) {
        const app = express();
        
        try {

            app.use(express.urlencoded({ extended: true }));
            app.listen(settings.httpport, () => { 
                console.log(`Web Server listening on port ${settings.httpport}`);
            });

            var options = {
                maxAge: 600000,
                dotfiles: 'ignore',
                etag: false,
                extensions: ['html'],
                index: false,
                redirect: false,
                setHeaders: function (res, path, stat) {
                    res.set('x-timestamp', Date.now());
                    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
                }
            };

            let publicdir = path.join(appdir, "public");
            app.use(express.static(publicdir, options));
            if (settings.useauthentication) {
                app.use(authentication);
            }
            app.use(express.json());
            app.use(favicon(path.join(publicdir, "img", "favicon.png")));
            
            app.get("/", (req, res) => {
                res.send(fs.readFileSync(path.join(publicdir, "index.html"), "utf-8"));
                res.end();
            });

            app.get("/settings", (req, res) => {
                res.send(JSON.stringify(settings));
                res.end();
            });
            
            app.get("/existingcount", async (req, res) => {
                let data = await getExistingCount();
                res.send(JSON.stringify({ existingcount: data }));
                res.end();
            });

            app.post("/sendexisting", async (req, res) => {
                let data = await sendExistingDatabases(req.body);
                res.send(data);
            });

            app.post("/make", async (req, res) => {
                await processMakeCommands(req.body);
            });

            app.post("/download", async (req, res) => {
                console.log("Download request posted!");
                await uploadArchiveFile(req.body, res);
            });

            const wss = new WebSocket.Server({ port: settings.wsport });
            console.log(`Websocket listening on port ${settings.wsport}`);
            let msg = {};

            wss.on('connection', (ws) => {
                ws.tag = { sent: false, uid: "" };
                ws.ping();
                
                ws.on('close', function() {
                    connections.delete(ws);
                    console.log(`Websocket closed, id: ${ws.tag}`);
                });

                ws.on('pong', () => {
                    if (ws.tag.sent === false && ws.tag.uid === "") {
                        let uid = getUniqueUserId();
                        ws.tag.uid = uid;
                        ws.tag.sent = true;
                        console.log(`Websocket connected, id: ${uid}`);
                        // Add the client ws to the connections dictionary
                        connections.set(ws, uid);   

                        // Send a confirmation message back to the client
                        let msg = { type: "connection", uid: uid }
                        sendMessageToClients(msg, uid);
                    }
                });

                ws.on('error', (error) => {
                    console.error("Websocket error:", error);
                    connections.delete(ws);
                });

                ws.onmessage = async(event) => {
                    let message = JSON.parse(event.data);
                    let msgclist = processCommandMessage(message);
                    if (!inMakeLoop) {
                        msg = messagetypes.commandresponse;
                        msg.uid = ws.tag.uid;
                        msg.payload = "success";
                        ws.send(JSON.stringify(msg));
                        ws.send(JSON.stringify(msgclist));
                        await processMakeCommands(message);
                    }
                };
            });

            startPingSender();

            if (settings.opendefaultbrowser && !isdocker) {
                spawn('open', [`http://localhost:${settings.httpport}`]);
            }
        }
        catch (err) {
            console.log(err);
        }
        
    }
})();

/**
 * Create and upload a ZIP archive with the user's selected charts
 * @param {*} message This is the controller message
 * @param {*} response Send the chart to the ZIP file via response
 */
async function uploadArchiveFile(message, response) { 
    const charts = message.charts;
    const uid = message.uid;

    let index = -1; // index to chart names

    // If a previous zip file exists, remove it...
    if (fs.existsSync(zipfilepath)) {
        fs.rmSync(zipfilepath);
    }

    const output = fs.createWriteStream(zipfilepath);
    const archive = archiver('zip', { zlib: { level: 9 }}); 

    output.on("close", function () {
        console.log(archive.pointer() + " total bytes");
        console.log("Archiver has been finalized and the output file descriptor has closed.");

        response.download(zipfilepath, zipfilename, (err) => { 
            if (err) {
                console.error('File download failed:', err);
            } 
            else {
                console.log('Archive file downloaded successfully.');
                let dlcmsg = new AppMessage(AppMessage.mtDownload);
                dlcmsg.completed = true;
                sendMessageToClients(dlcmsg, uid);
            }
        });
    });

    output.on("end", function () {
        console.log("Data has been drained");
    });
    
    // Catch warnings (ie stat failures and other non-blocking errors)
    archive.on("warning", function (err) {
        if (err.code === "ENOENT") {
            // log warning
        } 
        else {
            throw err;
        }
    });

    // Catch this error explicitly
    archive.on("error", function (err) {
        throw err;
    });

    archive.on("entry", function() {
        index ++;
        let msg = new AppMessage(AppMessage.mtDownload); 
        msg.uid = uid;
        let item = charts[index];
        msg.dbfilename = item.dbfilename; //charts[index];
        msg.rowindex = item.rowindex;
        msg.completed = false;
        sendMessageToClients(msg, uid);
        console.log("Archiver entry event fired!")
    })

    archive.pipe(output);

    // Add each chart to the new zip file
    charts.forEach(function(item) {
        let addfilepath = path.join(dbfolder, item.dbfilename);
        archive.append(fs.createReadStream(addfilepath), { name: item.dbfilename });
    });

    archive.finalize();
}

/**
 * Get the count of current pre-existing database files
 * @returns number
 */
async function getExistingCount() {
    try {
        const extensionsToOmit = ['.zip']; 
        const files = fs.readdirSync(dbfolder);
        const filteredfiles = files.filter(file => {
            const fileExtension = path.extname(file);
            return !extensionsToOmit.includes(fileExtension);
        });

        return filteredfiles.length;
    }
    catch(err) {
        console.log(err.message);
    }
    return 0;
}

/**
 * Send the existing database list to the requesting client browser
 * @param {'*'} message 
 * @returns an Appmessage.mtExistingDb message with a list of databases
 */
async function sendExistingDatabases(message) {
    const extensionsToOmit = ['.zip']; 
    const items = { existingdblist: [] };
    try {
        const files = fs.readdirSync(dbfolder);
        const filteredfiles = files.filter(file => {
            const fileExtension = path.extname(file);
            return !extensionsToOmit.includes(fileExtension);
        });
        var idx = -1;
        filteredfiles.forEach(file => {
            idx ++;
            let msg = new AppMessage(AppMessage.mtExistingDb);  
            const spl = file.split(".");
            msg.filename = spl[0];
            msg.filedate = chartdate;
            msg.dbfilename = file;
            msg.rowindex = idx;
            items.existingdblist.push(msg);
        });
        message.items = items;
        message.completed = true;
    }
    catch(err) {
        console.error(err.stack);
    }
    return message;
}

/**
 * Authenticate the browser user
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 * @returns 
 */
function authentication(req, res, next) {
    const authheader = req.headers.authorization;
    
    if (!authheader) {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err)
    }
    
    const b64data = authheader.split(' ')[1];
    let ufound = false;
    for (let i = 0; i < users.length; i++) {
        if (users[i] === b64data) {
            ufound = true;
            break;
        }
    }
    
    if (ufound) {
        return next();
    }
    else {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err);
    }
}
