'use strict';

const fs = require('fs');
const { execSync, exec } = require('child_process');
const prompt = require('prompt-sync')({sigint: true});

class ChartProcessTime {
    constructor(chartname) {
        this.chartname = chartname;
        this.startdate = new Date(new Date().toLocaleString());
        this.totaltime = "";
    }

    calculateProcessingTime() {
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

        this.totaltime = `${chartname} processing time: ${hh}:${mm}:${ss}`;
    }
}

/**
 * Utility to see if we are in a docker container
 */
function isRunningInDocker() {
    let dkresults = `${__dirname}/isdocker.txt`;
    let dcmd = `cat /proc/1/cgroup > ${dkresults}`;
    
    execSync(dcmd);

    let txtresult = fs.readFileSync(dkresults, { encoding: 'utf8', flag: 'r' });
    let isdocker = (txtresult.toString().search("/docker/") > -1)
    fs.rmSync(dkresults);

    return isdocker;
}

// set the application folder
let appdir = __dirname;
if (isRunningInDocker()) { 
    console.log("Running in docker!");
    appdir = "/chartmaker";
}

// load settings
const settings = JSON.parse(fs.readFileSync(`${appdir}/settings.json`));


let timings = new Map();

// logging
let logfd = undefined;
const setupDebugLog = function(logfolder) {
    if (settings.logtofile) {
        logfd = fs.openSync(`${logfolder}/debug.log`, 'w', 0o666);
    }
}
const logEntry = function(entry) {
    settings.logtofile ? fs.writeSync(logfd, `${entry}\n`) : console.log(entry);
}

// Get the current chart date from the chartdates.json file
const chartdate = getBestChartDate();

// used for process timing
const startdate = new Date(new Date().toLocaleString());

// make sure these base level folders exist
let workarea = `${appdir}/workarea`;
if (settings.renameworkarea) workarea += `_${chartdate}`;
if (!fs.existsSync(workarea)) fs.mkdirSync(workarea)

let chartcache = `${appdir}/chartcache`;
if (!fs.existsSync(chartcache)) fs.mkdirSync(chartcache);

let dbfolder = settings.dbfolder;
if (dbfolder.length === 0) {
    dbfolder = `${appdir}/charts`;
    if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder);
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

/**
 * Chart processing starts here
 */
let resp = "";
let parray = [];
let jsonarray = settings.vfrindividualcharts;
let nm = 0;

let arg = process.argv.slice(2);

if (arg.length >= 1) {
    let sarg = arg[0].toUpperCase();
    if (sarg === "ALL") {
       processAll();
    }
    else if (sarg === "FULL") {
        processFull();
    }
    else if (sarg.search("SINGLE") > -1) {
        try {
            nm = Number(arg[0].split("=")[1]);
            console.log(`Processing chart number ${nm}`);
            parray.push(nm);
            passedarg = true;
            processSingles(parray);
        }
        catch(error) {
            console.log("Error in numeric argument, format is: SINGLE=X where X is a valid vfr chart index number (see settings.json.) Exiting chartmaker!");
            process.exit();
        }
    }
}
else {
    resp = prompt("Enter 0 to process all 53 area charts individually, Enter 1 to process a single VFR chart, or Press 2 to process all of the full charts in the chartprocessindexes array: "); 
    switch (resp) {
        case "0":
            processAll();
            break;
        case "1":
            processOne();
            break;
        case "2":
            processFull();
            break;
    }
}


function processAll() {    
    console.log("\nProcessing all 53 chart areas...\n");
    for (var i = 0; i < 53; i++) {
        parray.push(i);
    }
    processSingles(parray);
}

function processOne() {
    let lst = "\nSelect the chart number you want to process from this list\n\n";
    for (var i = 0; i <  53; i++) {
        lst += `${i} ${jsonarray[i][1]}\n`; 
    }
    lst += "\n";
    resp = prompt(lst);
    nm = Number(resp); 

    if (nm >= 0 && nm < 53) {
        parray.push(nm);
        processSingles(parray);
    }
    else {
        prompt("Invalid response, exiting!");
        process.exit();
    }
}

function processSingles(parray) {
    for (var x = 0; x < parray.length; x++) {
        chartworkname = jsonarray[parray[x]][1];
        chartname = chartworkname;
        clippedShapeFolder = `${appdir}/clipshapes/sectional`;
        chartlayertype = settings.layertypes[settings.layertypeindex];
        chartfolder = `${workarea}/${chartworkname}`;
        charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
        console.log(charturl);
        let cpt = new ChartProcessTime(chartname);
        timings.set(chartname, cpt);
        runProcessing();
        console.log(`${cpt.totaltime}\n`);
    }
}

function processFull() {
    settings.chartprocessindexes.forEach((index) => {
        chartworkname = settings.faachartnames[index][0];
        chartlayertype = settings.layertypes[settings.layertypeindex];
        let ctype = settings.faachartnames[index][1];
        if (ctype === "ifr") {
            charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = `${appdir}/clipshapes/${settings.faachartnames[index][2].toLowerCase()}`;
            chartname = settings.faachartnames[index][2]; // use alias value for IFR
            chartfolder = `${workarea}/${chartname}`;
        }
        else { // vfr
            charturl = settings.vfrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
            clippedShapeFolder = `${appdir}/clipshapes/${chartworkname.toLowerCase()}`;
            chartname = chartworkname;
            chartfolder = `${workarea}/${chartworkname}`;
        }
        
        let cpt = new ChartProcessTime(chartname);
        timings.set(chartname, cpt);
        runProcessing();
        console.log(`${cpt.totaltime}\n`);
    });
}

function runProcessing() {
    dir_1_unzipped = `${chartfolder}/1_unzipped`;
    dir_2_expanded = `${chartfolder}/2_expanded`;
    dir_3_clipped = `${chartfolder}/3_clipped`;
    dir_4_tiled = `${chartfolder}/4_tiled`;
    dir_5_merged = `${chartfolder}/5_merged`;
    dir_6_quantized = `${chartfolder}/6_quantized`;
    
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
    if (!fs.existsSync(chartfolder)) fs.mkdirSync(chartfolder);
    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped);
    if (!fs.existsSync(dir_2_expanded)) fs.mkdirSync(dir_2_expanded);
    if (!fs.existsSync(dir_3_clipped)) fs.mkdirSync(dir_3_clipped);
    if (!fs.existsSync(dir_4_tiled)) fs.mkdirSync(dir_4_tiled);
    if (!fs.existsSync(dir_5_merged)) fs.mkdirSync(dir_5_merged);
    if (!fs.existsSync(dir_6_quantized)) fs.mkdirSync(dir_6_quantized);
    if (settings.logtofile) setupDebugLog(chartfolder);
    logEntry("Created working area subfolders");
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
}

/** 
 * Clean up chart tif names by converting spaces and dashes to underscores
 */
function normalizeChartNames() {
    let files = fs.readdirSync(dir_1_unzipped);
    files.forEach((file) => {
        let newfile = file;
        if (newfile.endsWith(".tif") || newfile.endsWith(".tfw") || newfile.endsWith(".tfwx")) {
            newfile = normalizeFileName(newfile);
            fs.renameSync(`${dir_1_unzipped}/${file}`, `${dir_1_unzipped}/${newfile}`);
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

    chartareas.forEach((area) => {

        logEntry(`* chart ${area}`);
        let shapefile = `${clippedShapeFolder}/${area}.shp`;
        let sourcetif = `${dir_1_unzipped}/${area}.tif`;
        let expanded = `${dir_2_expanded}/${area}.vrt`;
        let clipped = `${dir_3_clipped}/${area}.vrt`;
        let tiled = `${dir_4_tiled}/${area}`
        let expandopt = "";

        // determine if RGB expansion is required
        cmd = `gdalinfo -json "${sourcetif}"`;
        let infojson = JSON.parse(execSync(cmd));
        if (infojson.bands.length === 1) {
            expandopt = "-expand rgb";
        }

        logEntry(`>> gdal_translate ${sourcetif}`);
        cmd = `gdal_translate -strict -of vrt -ovr NONE -co "COMPRESS=LZW" -co "predictor=2" -co "TILED=YES" ${expandopt} ${sourcetif} ${expanded}`;
        executeCommand(cmd);

        logEntry(`>> gdalwarp warping ${clipped} using shapefile ${shapefile}`);
        cmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 256 -co SKIP_NOSOURCE=YES -multi -wo NUM_THREADS=ALL_CPUS -cblend 6 -cutline "${shapefile}" -crop_to_cutline ${expanded} ${clipped}`;
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

        logEntry(`>> gdaladdo adding overviews to ${clipped}`);
        cmd = `gdaladdo ${configargs} --config GDAL_NUM_THREADS ALL_CPUS ${clipped}`;
        executeCommand(cmd)

        logEntry(`>> gdal2tiles tiling ${clipped} into ${tiled}`);
        cmd = `gdal2tiles.py --zoom=${settings.zoomrange} --processes=4 ${formatargs} --tmscompatible --webviewer=leaflet ${clipped} ${tiled}`;
        executeCommand(cmd);
    });
}

/**
 * Merge all of the individual chart zoom folders into a single master chart folder 
 */
function mergeAndQuantize() {
    let areas = fs.readdirSync(dir_4_tiled);
    areas.forEach((area) => {
        let mergesource = `${dir_4_tiled}/${area}`;
        logEntry(`>> perl merging images from ${mergesource} into dir_5_merged`);
        let cmd = `perl ${appdir}/mergetiles.pl ${mergesource} ${dir_5_merged}`;
        executeCommand(cmd);
    });

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
    
    let chartdesc = chartname.replaceAll("_", " "); // normalize description
    let metajson = `{ 
        "name": "${chartname}",
        "description": "${chartdesc} Charts",
        "version": "1.1",
        "type": "${chartlayertype}",
        "format": "${imageformat}",
        "quality": ${settings.tileimagequality},
        "minzoom": "${minzoom}", 
        "maxzoom": "${maxzoom}",
        "attribution": "${settings.attribution}" 
    }`;
    let fpath = `${sourcefolder}/metadata.json`;
    let fd = fs.openSync(fpath, 'w'); 
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dbfolder}/${chartname}.db`;
    fs.rmSync(mbtiles, { force: true });  
    
    logEntry(`>> creating database: ${mbtiles}`);
    cmd = `python3 ${appdir}/mbutil/mb-util --image_format=${imageformat} --scheme=tms ${sourcefolder} ${mbtiles}`;
    executeCommand(cmd);

    let cpt = timings.get(chartname);
    cpt.calculateProcessingTime();
}

/**
 * Called by processImages() so it can iterate through all unzipped chart names
 * @returns array containing all of the chart names to be processed
 */
function buildChartNameArray() {
    let files = fs.readdirSync(dir_1_unzipped);
    let chartnames = [];
    files.forEach((file) => {
        let fname = file.toLowerCase();
        if ((fname.endsWith(".tif")) &&
            (fname.search("fly") == -1) &&
            (fname.search("planning") == -1)) {
                let cname = fname.replace(".tif", "");
                chartnames.push(cname);
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
    let subarray = [];
    mergedfolders.forEach((zoomlevel) => {
        let zoomfolder = `${dir_5_merged}/${zoomlevel}`;
        if (fs.statSync(zoomfolder).isDirectory()) {
            let quantzoomfolder = `${dir_6_quantized}/${zoomlevel}`;
            if (!fs.existsSync(quantzoomfolder)) {
                fs.mkdirSync(quantzoomfolder);
            }
            let xfolders = fs.readdirSync(zoomfolder);
            xfolders.forEach((x) => {
                let y = `${zoomfolder}/${x}`;
                let quantizedfolders = `${quantzoomfolder}/${x}`;
                if (!fs.existsSync(quantizedfolders)) {
                    fs.mkdirSync(quantizedfolders);
                }
                let images = fs.readdirSync(y);

                // build an array of chart names
                images.forEach((image) => {
                    let imgpath = `${y}/${image}`;
                    let outpath = `${quantizedfolders}/${image}`;
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
               .replaceAll(" ", "_")
               .replaceAll("'", "")
               .replaceAll("-", "_")
               .replaceAll("_sec", "")
               .replaceAll("_tac", "")
               .replaceAll("u.s.", "us");
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
    let datedata = fs.readFileSync(`${appdir}/chartdates.json`);
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
function executeCommand(command) {
    try {
        execSync(command, { stdio: 'ignore' });
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
 * @param {string} n 
 * @returns left zero padded numeric string 
 */
function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

/**
 * Utility to make sure clipping files are all lower-case
 */
function normalizeClipNames() {
    let files = fs.readdirSync(clippedShapeFolder);
    try {
        files.forEach((file) => {
            let oldname = `${clippedShapeFolder}/${file}`;
            let newname = oldname.toLowerCase();
            fs.renameSync(oldname, newname);
        });
    }
    catch (err) {
        logEntry(err.message);
    }
}
