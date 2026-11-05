
import fs from 'node:fs';
import http from 'node:http';
import { execSync, spawn } from 'node:child_process';
import readlineSync from 'readline-sync';
import path from 'node:path';
import express from 'express';
import { cwd } from 'node:process';
import { WebSocketServer } from 'ws';

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
const connections = new Map();
let inMakeLoop = false;
let pingSenderId = 0;

// set the base application folder, this will change if running in docker
let appdir = cwd();

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
    if (!indocker) {
        indocker = fs.existsSync("/.dockerenv") || process.env.DOCKER === "true";
    }
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
let useWebServer = settings.webservermode;
let timings = new Map();

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

let chartsfolder = path.join(appdir, "public", "charts");
if (!fs.existsSync(chartsfolder)) fs.mkdirSync(chartsfolder)

let dbfolder = path.join(chartsfolder, chartdate);
if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder)
    
if (isdocker) {
    //see if we have an external chart folder volume
    let extcharts = path.join(appdir, "externalcharts");
    if (fs.existsSync(extcharts)) {
        dbfolder = extcharts;
    }
}

let imageformat = settings.tiledrivers[settings.tiledriverindex];
let chartworkname = "";
let chartname = "";
let charturl = "";
let clippedShapeFolder = "";
let cmd = "";
let chartfolder = "";
let dir_1_unzipped = "";
let dir_2_expanded = "";
let dir_3_clipped = "";
let dir_4_mbtiles = "";
let isifrchart = false;
let metadataDescription = "";
let chartlayertype = "";

/**
 * Chart processing starts here
 */
let parray = [];
let nm = 0;

const processes = getProcessCount();
const arg = process.argv.slice(2);

if (useWebServer === false) {
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
                        "-h, --help         Show this help\r\n" +
                        "-s, --settings     Show all values in settings.json\r\n" +
                        "-w, --webserver    Start the web server\r\n" +
                        "----------------------------------------------------------------------------------\r\n" +
                        "area-single=X   Process one area chart where X is the index in the area chart list\r\n" +
                        "area-all        Process all 53 area VFR charts individually\r\n" +
                        "full-single=X   Process one full chart where X is an index in the full chart list\r\n" +
                        "full-all        Process all of the full charts in the full chart list\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
                        process.exit();
        }
        else if (sarg.startsWith("-w")) {
            enterWebserverMode();
        }
        else if (sarg === "area-all") {
            processAllAreas();
        }
        else if (sarg === "full-all") {
            processFulls();
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
        let response = processPrompt("Select:\r\n" +
                                "--------------------------------------------------------------------\r\n" +
                                "1 = Process a single area VFR chart\r\n" +
                                "2 = Process all 53 area VFR charts individually\r\n" +
                                "3 = Process a single full chart from the full chart list\r\n" +
                                "4 = Process all of the full charts in the full chart list\r\n" +
                                "5 = Put chartmaker into webserver mode (new feature)\r\n" +
                                "6 = Output the settings.json file to the console\r\n" +
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
                processAllFulls();
                break;
            case "5":
                enterWebserverMode();
                break;
            case "6":
                console.log(settings);
                console.log("\r\n\r\n\r\n");
                process.exit();
            default:
                console.log("Exiting chartmaker!");
                break;
        }
    }
}

function processOneArea(area = -1) {
    if (area == -1) {
        let lst = "\nSelect the chart number you want to process from this list\r\n\r\n";
        for (let i = 0; i <  settings.areachartlist.length; i++) {
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
    for (let i = 0; i < 53; i++) {
        parray.push(i);
    }
    processSingles();
}

function processSingles(msgid = -1) {
    for (let idx = 0; idx < parray.length; idx++) {
        const cpt = new ProcessTime(chartname);
        timings.set(chartname, cpt);
        console.log(`${cpt.startdate}\n`);
        let doProcessing = true;
        chartworkname = settings.areachartlist[parray[idx]];
        chartname = chartworkname;
        clippedShapeFolder = path.join(appdir, "clipshapes", "sectional");
        chartlayertype = settings.layertypes[settings.layertypeindex];
        chartfolder = path.join(workarea, chartworkname);
        charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
        console.log(charturl);

        let chartdbfile = path.join(dbfolder, `${chartname}.mbtiles`);
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
    let i = 1;
    settings.fullchartlist.forEach((fullchart) => {
        let cname = fullchart[0] === "DDECUS" ? fullchart[2] : fullchart[0];
        lst += `${i} ${cname.split("_").join(" ")}\r\n`;
        i++;
    });
    lst += "--------------------------------------------\r\nYour selection: ";
    let response = processPrompt(lst);
    nm = Number(response); 

    if (nm >= 1 && nm < settings.fullchartlist.length + 1) {
        parray.push(nm - 1);
    }
    else {
        console.log("Invalid response, exiting!");
        process.exit();
    }
	const cpt = new ProcessTime(chartname);
	timings.set(chartname, cpt);
    console.log(`${cpt.startdate}\n`);
    processFulls();
}

function processAllFulls() {
    settings.fullchartlist.forEach((fullchart) => {
        parray.push(settings.fullchartlist.indexOf(fullchart))
    });
    const cpt = new ProcessTime(chartname);
    timings.set(chartname, cpt);
    console.log(`${cpt.startdate}\n`);
    processFulls();
}

function processFulls(msgid = -1) {
    for (let idx = 0; idx < parray.length; idx++) { 
        const chart = settings.fullchartlist[parray[idx]];
        const charttype = chart[1];
        let lcasename = chart[0].toLowerCase();

        chartworkname = chart[0]; 
        
        if (charttype === "ifr") {
            isifrchart = true;
            lcasename = chart[2].toLowerCase();
            charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
            chartname = chart[2]; // use alias value for IFR
            chartfolder = path.join(workarea, chartname);
            updateMetadata = true;
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

        metadataDescription = chartname.replaceAll("_", " ");

        let chartdbfile = path.join(dbfolder, `${chartname}.mbtiles`);
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
    dir_4_mbtiles = path.join(chartfolder, "4_mbtiles");
    
    setupEnvironment();
    downloadCharts();
    unzipCharts();
    normalizeChartNames();
    processImages();
    
    if (settings.cleanprocessfolders === true) {
        cmd = `rm -rf ${workarea}`
        executeCommand(cmd);

        cmd = `mkdir ${workarea}`
        executeCommand(cmd);
    }   
    
    if (!useWebServer) {
        ProcessTime.reportProcessingTime(startdate);
    }
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
    if (!fs.existsSync(dir_4_mbtiles)) fs.mkdirSync(dir_4_mbtiles);
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
        for (let i = 0; i < oldfiles.length; i++) {
            if (oldfiles[i].startsWith(chartworkname)) {
                fs.rmSync(path.join(chartcache, oldfiles[i]));
                break;
            }
        }
        logEntry(`Downloading ${chartzip}`);
        cmd = `curl ${charturl} -v -o ${chartzip}`;
        executeCommand(cmd, true);
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
    const chartareas = buildChartNameArray();
    const cblend = settings.blendpixels;

    chartareas.forEach((area) => {
        logEntry(`* chart ${area}`);
        const shpfile = `${area}.shp`;
        const vrtfile = `${area}.vrt`;
        const srcfile = `${area}.tif`;
        const shapefile = path.join(clippedShapeFolder, shpfile);
        const sourcetif = path.join(dir_1_unzipped, srcfile);
        const expanded = path.join(dir_2_expanded, vrtfile);
        const clipped = path.join(dir_3_clipped, vrtfile);
        
        // determine if RGB expansion is required
        cmd = `gdalinfo -json "${sourcetif}"`;
        const infojson = JSON.parse(execSync(cmd));
        let expandopt = "";
        if (infojson.bands.length === 1) {
            if (settings.outputgrayscale) {
                expandopt = "-expand gray"; 
            } else {
                expandopt = "-expand rgb";
            }
        }
        
        logEntry(`>> gdal_translate ${sourcetif}`);
        cmd = `gdal_translate -strict -of vrt -ovr NONE ${expandopt} ${sourcetif} ${expanded}`;
        executeCommand(cmd);

        logEntry(`>> gdalwarp warping and clipping ${clipped} using shapefile ${shapefile}`);
        cmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 512 ` + 
              `-multi -cblend ${cblend} -cutline ${shapefile} -crop_to_cutline ${expanded} ${clipped}`;
        executeCommand(cmd);
    });

    // setup formatting arguments for overviews        
    let configargs = "";
    switch (imageformat) {
        case "webp":
            configargs = `--config WEBP_LOSSLESS_OVERVIEW NO --config WEBP_LEVEL_OVERVIEW ${settings.tileimagequality}`;
            break;
        case "jpeg":
            configargs = `--config JPEG_QUALITY_OVERVIEW ${settings.tileimagequality}`;
            break;     
        default:
            // no adjustments for PNG images
            break;
    }

    const imgfmt = imageformat.toUpperCase();
    const mbtiles = path.join(dir_4_mbtiles, chartname) + ".mbtiles";
    const bigvrt = path.join(dir_3_clipped, chartname) + ".vrt";
    const infiles =`${dir_3_clipped}/*.vrt`;
    logEntry(`>> Building single chart VRT file: ${bigvrt}`);
    cmd = `gdalbuildvrt ${bigvrt} ${infiles}`;
    executeCommand(cmd);

    logEntry(`>> Creating MBTILES database file at: ${mbtiles}`);
    cmd = `gdal_translate ${bigvrt} ${mbtiles} -of MBTILES -mo TILES_PRODUCER="N129BZ Chartmaker" ` + 
          `--config GDAL_CACHEMAX 4096 --config GDAL_MAX_DATASET_POOL_SIZE 500 ` +
          `--config OGR_SQLITE_JOURNALMODE MEMORY --config OGR_SQLITE_SYNCHRONOUS OFF ` +
          `-co TILE_FORMAT=${imgfmt} -co QUALITY=${settings.tileimagequality}`;
    executeCommand(cmd);

    logEntry(`>> Adding gdaladdo overviews to ${mbtiles}`);
    configargs =  `--config GDAL_CACHEMAX 4096 --config GDAL_NUM_THREADS ALL_CPUS`;
    cmd = `gdaladdo -r average ${configargs} ${mbtiles} ${settings.overviewrange}`;
    executeCommand(cmd)

    // Update the metadata table to remove underscore characters from chart name and description
    metadataDescription = chartname.replaceAll("_", " ");
    let sql = `UPDATE metadata SET value = '${metadataDescription}' ` + 
              `WHERE name IN ('name', 'description') RETURNING name, value`;
    const output = execSync(`sqlite3 -json ${mbtiles} "${sql}"`, { encoding: 'utf-8' });
    console.log(`UPDATE RESULT\n: ${output}`);

    // run post processing to move the new database
    let outputDbFolder = settings.mbtilesfolder;
    if (!fs.existsSync(settings.mbtilesfolder)) {
        // if the path doesnt exist, put it as a subfolder of the app path
        outputDbFolder = path.join(appdir, outputDbFolder);
        fs.mkdirSync(outputDbFolder, { recursive: true });
    }
    outputDbFolder = path.join(outputDbFolder, chartname) + ".mbtiles";
    cmd = `mv ${mbtiles} ${outputDbFolder}`;
    logEntry(`>> Executing post processing command: ${cmd}`);
    executeCommand(cmd);
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
    console.log("Entering web server mode")
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
            chartlayertype = item.layertype;

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
                        cmt.dbfilename = `${chartname}.mbtiles`;
                        sendMessageToClients(cmt, userid);
                    }
                    break;
                case 1:
                    // no sub command
                    processAllAreas();
                    break;
                case 2:
                    if (opt >= 0 && opt <= 7) {
                        let ridx = i;
                        parray.push(opt);
                        let rmt = new AppMessage(AppMessage.mtRunning);
                        rmt.rowindex = ridx;

                        let chart = settings.fullchartlist[opt][0].replace("_", " ");
                        if (chart === "DDECUS") chart = settings.fullchartlist[opt][2].replace("_", " ");
                        console.log(`Processing full chart: ${chart}`);
                        rmt.dbfilename = `${chartname}.mbtiles`;
                        sendMessageToClients(rmt, userid);

                        let cpt = processFulls(i);

                        let cmt = new AppMessage(AppMessage.mtComplete);
                        cmt.rowindex = ridx;
                        cmt.payload = cpt.totaltime;
                        cmt.dbfilename = `${chartname}.mbtiles`;
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
    dir_4_mbtiles = "";
    isifrchart = false;
    metadataDescription = "";
    wgsbounds = [];
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
    if (useWebServer) {
        const app = express();
        const server = http.createServer(app);
        
        try {

            app.use(express.urlencoded({ extended: true }));
            server.listen(settings.httpport, () => { 
                console.log(`Web Server listening on port ${settings.httpport}`);
            });

            let options = {
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
            
            app.get("/", (req, res) => {
                res.send(fs.readFileSync(path.join(publicdir, "index.html"), "utf-8"));
                res.end();
            });

            app.get("/settings", (req, res) => {
                res.send(JSON.stringify(settings));
                res.end();
            });
            
            app.get("/status", (req, res) => {
                res.json({
                    running: inMakeLoop,
                    chartdate: chartdate,
                    currentChart: chartname || ""
                });
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
                if (inMakeLoop) {
                    return res.status(409).json({ status: "busy", message: "Chart processing is already in progress" });
                }
                res.status(202).json({ status: "accepted", message: "Chart processing initiated" });
                try {
                    await processMakeCommands(req.body);
                } catch (err) {
                    console.error("Error during processMakeCommands:", err);
                }
            });

            app.post("/download", async (req, res) => {
                console.log("Download request posted!");
                await uploadArchiveFile(req.body, res);
            });

            // Unified single-port WebSocket server attached directly to the HTTP server
            const wss = new WebSocketServer({ server });
            console.log(`WebSocket server listening on port ${settings.httpport}`);
            let msg = {};

            wss.on('connection', (ws) => {
                ws.tag = { sent: false, uid: "" };
                ws.ping();
                
                ws.on('close', function() {
                    const id = connections.get(ws);
                    connections.delete(ws);
                    console.log(`Websocket closed, id: ${id}`);
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
                    try {
                        let message = JSON.parse(event.data);
                        let msgclist = processCommandMessage(message);
                        if (!inMakeLoop) {
                            let msg = new AppMessage(AppMessage.mtCommandResponse);
                            msg.uid = ws.tag.uid;
                            msg.payload = "success";
                            ws.send(JSON.stringify(msg));
                            ws.send(JSON.stringify(msgclist));
                            await processMakeCommands(message);
                        } else {
                            let busyMsg = new AppMessage(AppMessage.mtCommandResponse);
                            busyMsg.uid = ws.tag.uid;
                            busyMsg.payload = "busy";
                            ws.send(JSON.stringify(busyMsg));
                        }
                    } catch (err) {
                        console.error("Websocket onmessage error:", err);
                    }
                };
            });

            startPingSender();

            if (settings.opendefaultbrowser && !isdocker && process.env.DOCKER !== 'true') {
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
    const charts = message.charts || [];
    const uid = message.uid || "";

    if (!charts.length) {
        return response.status(400).json({ error: "No charts selected for download" });
    }

    const tmpZipName = `charts_${Date.now()}.zip`;
    const tmpZipPath = path.join(workarea, tmpZipName);

    // Collect valid file paths
    const filesToZip = [];
    charts.forEach((item, index) => {
        const filePath = path.join(dbfolder, item.dbfilename);
        if (fs.existsSync(filePath)) {
            filesToZip.push(filePath);
            let msg = new AppMessage(AppMessage.mtDownload);
            msg.uid = uid;
            msg.dbfilename = item.dbfilename;
            msg.rowindex = item.rowindex !== undefined ? item.rowindex : index;
            msg.completed = false;
            sendMessageToClients(msg, uid);
        }
    });

    if (filesToZip.length === 0) {
        return response.status(404).json({ error: "Selected chart databases not found on server" });
    }

    try {
        const quotedFiles = filesToZip.map(f => `"${f}"`).join(" ");
        execSync(`zip -j -1 "${tmpZipPath}" ${quotedFiles}`);

        response.download(tmpZipPath, settings.zipfilename || "Charts.zip", (err) => {
            try {
                if (fs.existsSync(tmpZipPath)) {
                    fs.unlinkSync(tmpZipPath);
                }
            } catch {}
            if (err) {
                console.error('File download failed:', err);
            } else {
                console.log('Archive file downloaded successfully.');
                let dlcmsg = new AppMessage(AppMessage.mtDownload);
                dlcmsg.completed = true;
                sendMessageToClients(dlcmsg, uid);
            }
        });
    } catch (err) {
        console.error("Failed to create zip archive:", err);
        if (fs.existsSync(tmpZipPath)) {
            try { fs.unlinkSync(tmpZipPath); } catch {}
        }
        if (!response.headersSent) {
            response.status(500).json({ error: "Failed to generate zip archive: " + err.message });
        }
    }
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
    const extensionsToOmit = ['.zip', '.txt']; 
    const items = { existingdblist: [] };
    try {
        const files = fs.readdirSync(dbfolder);
        const filteredfiles = files.filter(file => {
            const fileExtension = path.extname(file);
            return !extensionsToOmit.includes(fileExtension);
        });
        let idx = -1;
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
