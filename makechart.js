'use strict';

const fs = require("fs");
const shell = require('shelljs')
const { program } = require('commander');

// global editable variables
let cmd = "";
let zoomrange; 
let chartdate = "";
let workarea = `${__dirname}/workarea`;

// working directory constants
const dir_0_download      = `${workarea}/0_download`;
const dir_1_unzipped      = `${workarea}/1_unzipped`;
const dir_2_normalized    = `${workarea}/2_normalized`;
const dir_3_expanded      = `${workarea}/3_expanded`;
const dir_4_clipped       = `${workarea}/4_clipped`;
const dir_5_warped        = `${workarea}/5_warped`;
const dir_6_translated    = `${workarea}/6_translated`;
const dir_7_tiled         = `${workarea}/7_tiled`;
const dir_8_merged        = `${workarea}/8_merged`;
const dir_8_quantized     = `${workarea}/8_quantized`;
const dir_9_dbtiles       = `${workarea}/9_dbtiles`;

// get the commandline arguments
program
    .option('-d, --dateofchart <mm-dd-YYYY>', 'enter a valid date in the format mm-dd-YYYY');
program.showSuggestionAfterError();
program.parse(process.argv);

let settings; 
let charturl; 
let areas; 
let tiledbname;
let cleanMerge = false;
let tiledImageQuality = 90;
let stepsCompleted = 0;
let renameWorkArea = true;

processArguments(program.opts());

makeWorkingFolders();
downloadCharts();
unzipAndNormalize();
processImages();
mergeTiles(); 
quantizePngImages();
makeMbTiles();

// if we got here, if all steps completed and the user settings
// indicate, re-name the working folder as the chart date
if (stepsCompleted === 9 && renameWorkArea) {
    fs.renameSync(workarea, `${__dirname}/chart_process_${chartdate}`);
}

console.log("Chart processing completed!");
process.exit(0);


function makeWorkingFolders() {
    // make the processing directories if they don't exist.
    if (!fs.existsSync(workarea)) fs.mkdirSync(workarea);
    if (!fs.existsSync(dir_0_download)) fs.mkdirSync(dir_0_download);
    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped);
    if (!fs.existsSync(dir_2_normalized)) fs.mkdirSync(dir_2_normalized);
    if (!fs.existsSync(dir_3_expanded)) fs.mkdirSync(dir_3_expanded);
    if (!fs.existsSync(dir_4_clipped)) fs.mkdirSync(dir_4_clipped);
    if (!fs.existsSync(dir_5_warped)) fs.mkdirSync(dir_5_warped);
    if (!fs.existsSync(dir_6_translated)) fs.mkdirSync(dir_6_translated);
    if (!fs.existsSync(dir_7_tiled)) fs.mkdirSync(dir_7_tiled);
    if (!fs.existsSync(dir_8_merged)) fs.mkdirSync(dir_8_merged);
    if (!fs.existsSync(dir_8_quantized)) fs.mkdirSync(dir_8_quantized);
    if (!fs.existsSync(dir_9_dbtiles)) fs.mkdirSync(dir_9_dbtiles);
}

class dateObject {
    constructor(date) {
        this.date = new Date(date);
    }
};

function downloadCharts() {
    areas.forEach(area => {
        let serverfile = charturl.replace("<chartname>", area);
        let localfile = area.replace("-", "_");
        localfile = localfile.replace(" ", "_");
        let filename = `${dir_0_download}/${localfile}.zip`;
        cmd = `wget ${serverfile} --output-document=${filename}`;

        if (executeCommand(cmd) != 0) {
            console.log("NO CHARTS FOUND, make sure you enter a valid FAA sectional chart release date.");
            process.exit(1);
        }
    });
}

function unzipAndNormalize() {
    let files = fs.readdirSync(dir_0_download);

    console.log("unzipping all of the chart zip files");
    files.forEach((file) => {
        cmd = `unzip -u -o ${dir_0_download}/${file} -d ${dir_1_unzipped}`;
        executeCommand(cmd);
    });
    
    files = fs.readdirSync(dir_1_unzipped);
    
    files.forEach((file) => {
        let escapedname = replaceAll(file, " ", "\\ ");
        let newname = replaceAll(file, " ", "_");
        newname = replaceAll(newname, "-", "_");
        newname = newname.replace("_SEC", "");
        
        cmd = `mv ${dir_1_unzipped}/${escapedname} ${dir_1_unzipped}/${newname}`;
        executeCommand(cmd);
    });

    console.log("normalizing and copying");
    
    files = fs.readdirSync(dir_1_unzipped); 
    files.forEach((file) => {
        if (file.endsWith(".tif")) {
            let chartfile = `${dir_1_unzipped}/${file}`;
            let normfile = `${dir_2_normalized}/${file}`;
            
            // Does this file have georeference info?
            if (getGdalInfo(chartfile, "PROJCRS")) {
                cmd = `mv --update --verbose ${chartfile} ${normfile}`;
                executeCommand(cmd);
            }
        }
    }); 
}

function processImages(){
    /*--------------------------------------------------------------
     1) clip the source image to VRT with the associat-co "COMPRESS=DEFLATE" -co "PREd shape file 
     2) warp to EPSG:3857 so that final output pixels are square
     3) tramslate the VRT back into a GTIFF file
     4) add zoom overlays to the GTIFF 
    --------------------------------------------------------------*/
    let clippedShapesDir = `${__dirname}/clipshapes`;
    
    let files = fs.readdirSync(dir_2_normalized);
    files.forEach((file) => {
        console.log(file);
        if (file.endsWith(".tif")) {
            
            let basename = file.replace(".tif", "");

            console.log(`************** Processing chart: ${basename} **************`);
            
            let shapefile = `${clippedShapesDir}/${basename}.shp`;
            let normalizedfile = `${dir_2_normalized}/${basename}.tif`;
            let expandedfile = `${dir_3_expanded}/${basename}.vrt`;
            let clippedfile = `${dir_4_clipped}/${basename}.vrt`;
            let warpedfile = `${dir_5_warped}/${basename}.vrt`;
            let translatedfile = `${dir_6_translated}/${basename}.tif`;
            let tiledir = `${dir_7_tiled}/${basename}`;
            
            console.log(`*** Translate color table to RGBA GTiff ***`);
            cmd = `gdal_translate -strict -of vrt -expand rgba ${normalizedfile} ${expandedfile}`;
            executeCommand(cmd);
            
            console.log(`*** Clip border off of virtual image ***`);
            cmd = `gdalwarp -of vrt -r lanczos -multi -cutline "${shapefile}" -crop_to_cutline -cblend 10 -dstalpha -co ALPHA=YES -wo NUM_THREADS=ALL_CPUS -wm 1024 --config GDAL_CACHEMAX 1024 ${expandedfile} ${clippedfile}`; 
            executeCommand(cmd);
            
            console.log(`*** Warp virtual image to EPSG:3857 ***`);
            cmd = `gdalwarp -of vrt -t_srs EPSG:3857 -r lanczos -multi -wo NUM_THREADS=ALL_CPUS -wm 1024 --config GDAL_CACHEMAX 1024 ${clippedfile} ${warpedfile}`;
            executeCommand(cmd);
            
            console.log(`*** Translate virtual image back to GTiff ***`);
            cmd = `gdal_translate -co TILED=YES -co NUM_THREADS=ALL_CPUS ${warpedfile} ${translatedfile}`;
            executeCommand(cmd);
            
            console.log(`*** Add gdaladdo overviews ***`);
            cmd = `gdaladdo -r average --config GDAL_NUM_THREADS ALL_CPUS ${translatedfile}`;
            executeCommand(cmd); 
            
            console.log(`*** Tile images in TMS format ***`);
            cmd = `gdal2tiles.py --zoom=${zoomrange} --processes=4 --tmscompatible --webviewer=openlayers ${translatedfile} ${tiledir}`;
            executeCommand(cmd);
        }
    });
    stepsCompleted += 6;
}

function mergeTiles() {
    let chartfolders = fs.readdirSync(dir_7_tiled);
    chartfolders.forEach((chart) => {
        let mergesource = `${dir_7_tiled}/${chart}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_8_merged}`;
        console.log(`*** Merging ${chart} tiles`);
        executeCommand(cmd);
    });
    stepsCompleted++;
}

function quantizePngImages() {
    let mergefolder = fs.readdirSync(dir_8_merged);
    let imgcount = 0;
    mergefolder.forEach((zoomlevel) => {
        let zoomfolder = `${dir_8_merged}/${zoomlevel}`;
        if (fs.statSync(zoomfolder).isDirectory()) {    
            let quantzoomfolder = `${dir_8_quantized}/${zoomlevel}`;
            if (!fs.existsSync(quantzoomfolder)) {
                fs.mkdirSync(quantzoomfolder);
            }
            let xfolders = fs.readdirSync(zoomfolder);
            xfolders.forEach((xfolder) => {
                let yfolders = `${zoomfolder}/${xfolder}`;
                let quantyfolders = `${quantzoomfolder}/${xfolder}`;
                if (!fs.existsSync(quantyfolders)) {
                    fs.mkdirSync(quantyfolders);
                }
                let images = fs.readdirSync(yfolders);
                images.forEach((image) => {
                    imgcount ++;
                    let imgpath = `${yfolders}/${image}`;
                    let outpath = `${quantyfolders}/${image}`;
                    console.log(`*** quantizing image # ${imgcount}: ${zoomlevel}/${xfolder}/${image}`);
                    cmd = `pngquant --quality ${tiledImageQuality} ${imgpath} --output ${outpath}`;
                    executeCommand(cmd);
                    if (cleanMerge) {
                        fs.rmSync(imgpath);
                    }
                });
            });
        }
    });
    stepsCompleted++;
}

function makeMbTiles() {            
    console.log(`  * Making MBTILES database`);
    let zooms = zoomrange.split("-");
    let minzoom = zooms[0];
    let maxzoom = zooms[0];
    
    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }

    // create a metadata.json file in the root of the tiles directory,
    // mbutil will use this to generate a metadata table in the database.  
    let metajson = `{ 
        "name": "${tiledbname}",
        "description": "VFR Sectional Charts",
        "version": "1.1",
        "type": "overlay",
        "format": "png",
        "minzoom": "${minzoom}", 
        "maxzoom": "${maxzoom}" 
    }`;
    let fpath = `${dir_8_quantized}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_9_dbtiles}/${tiledbname}.mbtiles`;   
    let cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_8_quantized} ${mbtiles}`;
    executeCommand(cmd);

    stepsCompleted++;
}

function executeCommand(command) {
    try {
        const { stdout, stderr, code } = shell.exec(command, { silent: false });
        if(code != 0) {
            console.log(`stdout: ${stdout}, stderr: ${stderr}`);
            return code;
        }
        return 0;
    }
    catch(err) {
        console.log(err);
    }
}

function processArguments(options) {
    let error = false;
    let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
    
    settings = JSON.parse(rawdata);
    charturl = settings.charturltemplate.replace("<chartdate>", chartdate);
    areas = settings.areas;
    tiledbname = settings.tiledbname;
    cleanMerge = settings.cleanMergeFolderAtQuantize;
    tiledImageQuality = settings.tiledImageQuality;
    renameWorkArea = settings.renameWorkAreaOnCompletion;

    let zrange = settings.zoomRange;

    if (zrange.search("-") > -1) {
        let ranges = zrange.split("-");
        if (isNaN(ranges[0]) || isNaN(ranges[1])) {
            error = true;
        }
    }
    else {
        if (isNaN(zrange)) {
            error = true;
        }
    }
    zoomrange = zrange;

    if (options.dateofchart === undefined) {
        loadBestChartDate();
    }
    else {
        let chdate = options.dateofchart.replace(" ", "");
        let mdy = [];

        if (chdate.search("/") > -1) {
            mdy = chdate.split("/");
        }
        else if (chdate.search("-") > -1) {
            mdy = chdate.split("-");
        }
        
        chartdate = `${mdy[0]}-${mdy[1]}-${mdy[2]}`;
        
        if (Date.parse(chartdate) === NaN) {
            console.log("INVALID DATE FORMAT! Use mm-dd-yyyy or mm/dd/yyyy");
            process.exit(1);
        }
    }
    console.log(`Arguments processed: ${chartdate}, ${zoomrange}`);
}

function loadBestChartDate() {
    let thisdate = new  Date();
    let thistime = thisdate.getTime();
    let cdates = [];
    let found = false;
    settings.chartdates.forEach((cdate) => {
        cdates.push(new Date(cdate))
    });
    
    let sortedDates = cdates.sort((a, b) => b.date - a.date).reverse();
    cdates.forEach((obj) => {
        if (!found) {
            let dtime = obj.getTime();
            let tdiff = dtime - thistime;
            let tdays = tdiff / (1000 * 3600 * 24);
            if (Math.abs(tdays) <= 20) {
                let m = pad2(obj.getMonth()+1); // months (0-11)
                let d = pad2(obj.getDate());    // day (1-31)
                let y= obj.getFullYear();
                chartdate = `${m}-${d}-${y}`;
                found = true;
            }
        }
    })
}

// helper function(s)
function replaceAll(string, search, replace) {
    return string.split(search).join(replace);
}

function getGdalInfo(file, searchtext) {
    let gdalresults = `${__dirname}/gdal.txt`

    cmd = `gdalinfo ${file} -noct > ${gdalresults}`; 
    
    let { stderr } = shell.exec(cmd, { silent: true })
    if (stderr) {
        console.log(stderr);
    }
    
    let gdaldata = fs.readFileSync(gdalresults, {encoding:'utf8', flag:'r'});         
    let retval = (gdaldata.toString().search(searchtext) > -1) 
    fs.rmSync(gdalresults);
    
    return retval;
}

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}
