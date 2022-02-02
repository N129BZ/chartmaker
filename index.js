'use strict';

// TODO: Fix Houston shapefiles

const fs = require("fs");
const shell = require('shelljs')
const { program } = require('commander');

// global editable variables
let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
let settings = JSON.parse(rawdata);
let cmd = "";
let chartdate = "";
let charturl = ""; 
let chartareas = [];
let workarea = `${__dirname}/workarea/${settings.ChartType}`;

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
processArguments(program.opts());
makeWorkingFolders();


downloadCharts();
unzipDownloadedCharts(); 
normalizeChartNames();
processImages();
mergeTiles();
quantizePngImages();
makeMbTiles();

if (settings.CleanMergeFolder) {
    console.log("  \r\n* Removing merge folder")
    fs.rmdirSync(dir_8_merged, true);
}

// if we got here, if all steps completed and the user settings
// indicate, re-name the working folder as the chart date
if (settings.RenameWorkArea) {
    //fs.renameSync(workarea, `${__dirname}/chart_process_${chartdate}`);
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

function downloadCharts() {
    let chartzip = `${dir_0_download}/${settings.ChartType}.zip`;
    cmd = `wget ${charturl} --output-document=${chartzip}`;
    executeCommand(cmd);
}
function unzipDownloadedCharts() {
    let chartzip = `${dir_0_download}/${settings.ChartType}.zip`;
    console.log("\r\n* Unzipping chart zip files\r\n");
    cmd = `unzip -o ${chartzip} -x '*.htm' -d ${dir_1_unzipped}`;
    executeCommand(cmd);
    
}

function normalizeChartNames() {
    let files = fs.readdirSync(dir_1_unzipped);
    let tifname = "";
    let tfwname = "";
    files.forEach((file) => {
        if (file.endsWith(".tif") && file.search(" TAC") != -1) {
            let testname = normalizeFileName(file);
            let basename = testname.replace(".tif", "");
            tifname = `${dir_2_normalized}/${basename}.tif`;
            tfwname = `${dir_2_normalized}/${basename}.tfw`;
            fs.copyFileSync(`${dir_1_unzipped}/${file}`, tifname);
            fs.copyFileSync(`${dir_1_unzipped}/${file.replace(".tfw", ".tif")}`, tfwname);
        }buildChartAreaArray();
        
    });
}

function processImages(){
    /*--------------------------------------------------------------
     1) clip the source image to VRT with the associat-co "COMPRESS=DEFLATE" -co "PREd shape file 
     2) warp to EPSG:3857 so that final output pixels are square
     3) tramslate the VRT back into a GTIFF file
     4) add zoom overlays to the GTIFF 
    --------------------------------------------------------------*/
    let clippedShapesDir = `${__dirname}/clipshapes/${settings.ChartType}`;

    buildChartNameArray();

    chartareas.forEach((area) => {
        
        console.log(`\r\n\r\n************** Processing chart: ${area} **************`);
        
        let shapefile = `${clippedShapesDir}/${area}.shp`;
        let normalizedfile = `${dir_2_normalized}/${area}.tif`;
        let expandedfile = `${dir_3_expanded}/${area}.vrt`;
        let clippedfile = `${dir_4_clipped}/${area}.vrt`;
        let warpedfile = `${dir_5_warped}/${area}.vrt`;
        let translatedfile = `${dir_6_translated}/${area}.tif`;
        let tiledir = `${dir_7_tiled}/${area}`;
        
        console.log(`\r\n*** Expand color table to RGBA GTiff ***`);
        cmd = `gdal_translate -strict -of vrt -expand rgba ${normalizedfile} ${expandedfile}`;
        executeCommand(cmd);
        
        console.log(`\r\n*** Clip border off of virtual image ***`);
        cmd = `gdalwarp -of vrt -multi -cutline "${shapefile}" -crop_to_cutline -cblend 10 -dstalpha -co ALPHA=YES ${expandedfile} ${clippedfile}`; 
        executeCommand(cmd);
        
        console.log(`\r\n*** Warp virtual image to EPSG:3857 ***`);
        cmd = `gdalwarp -of vrt -t_srs EPSG:3857 -r lanczos -multi  ${clippedfile} ${warpedfile}settings.T`;
        executeCommand(cmd);
        
        console.log(`\r\n*** Translate virtual image back to GTiff ***`);
        cmd = `gdal_translate -co TILED=YES -co NUM_THREADS=ALL_CPUS ${warpedfile} ${translatedfile}`;
        executeCommand(cmd);
        
        console.log(`\r\n*** Add gdaladdo overviews ***`);
        cmd = `gdaladdo -r average --config GDAL_NUM_THREADS ALL_CPUS ${translatedfile}`;
        executeCommand(cmd); 
        
        console.log(`\r\n*** Tile images in TMS format ***`);
        cmd = `gdal2tiles.py --zoom=${settings.ZoomRange} --processes=4 --tmscompatible --webviewer=openlayers ${translatedfile} ${tiledir}`;
        executeCommand(cmd);
    });
}

function mergeTiles() {
    buildChartNameArray();
    chartareas.forEach((area) => {
        let mergesource = `${dir_7_tiled}/${area}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_8_merged}`;
        console.log(`\r\n*** Merging ${area} tiles`);
        executeCommand(cmd);
    });
}
    
function quantizePngImages() {
    let interimct = 0;
    let cmds = buildCommandArray();
    let i = 0;
    console.log(`\r\n*** Quantizing ${cmds.length} png images at ${settings.TiledImageQuality}%`);
    for (i=0; i < cmds.length; i++) {
        if (interimct === 500) {
            console.log(`  * processed image count = ${i} of ${cmds.length}`);
            interimct = 0;
        }
        interimct++;
        executeCommand(cmds[i]);
    }
    console.log(`  * processed image count = ${i} of ${cmds.length}`);
}

function buildChartNameArray() {
    let normfiles = fs.readdirSync(dir_2_normalized);
    normfiles.forEach((file) => {
        if (file.endsWith(".tif")) {
            chartareas.push(file.replace(".tif", ""));// build an array of chart names
    
        }
    });
}

function buildCommandArray() {
    let mergefolder = fs.readdirSync(dir_8_merged);
    let cmdarray = [];

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
                images.forEach((image) => {// build an array of chart names
    
                    let imgpath = `${yfolders}/${image}`;
                    let outpath = `${quantyfolders}/${image}`;
                    cmd = `pngquant --quality ${settings.TiledImageQuality} ${imgpath} --output ${outpath}`;
                    cmdarray.push(cmd);
                });
            });
        }
    });
    return cmdarray;
}

function makeMbTiles() {            
    console.log(`\r\n  * Making MBTILES database`);
    let zooms = settings.ZoomRange.split("-");settings.T
    let minzoom = zooms[0];
    let maxzoom = zooms[0];
    
    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }settings.T

    // create a metadata.json file in the root of the tiles directory,
    // mbutil will use this to generate a metadata table in the database.  
    let tiledbname = settings.ChartType;
    let metajson = `{ 
        "name": "${tiledbname}",
        "description": "${tildbname} Charts",
        "version": "1.1",
        "type": "overlay",
        "format": "png",
        "minzoom": "${minzoom}", 
        "maxzoom": "${maxzoom}", 
        "pngquality": "${settings.TiledImageQuality}"
    }`;
    let fpath = `${dir_8_quantized}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_9_dbtiles}/${tiledbname}.mbtiles`;   
    let cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_8_quantized} ${mbtiles}`;
    executeCommand(cmd);
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

function normalizeFileName(file) {
    let newname = "";
    newname = replaceAll(file, " ", "_");
    newname = newname.replace("_SEC", "");
    newname = newname.replace("_TAC", "");
    return newname;
}

function processArguments(options) {
    let error = false;
    let zrange = settings.ZoomRange;

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
    
    if (error) {
        console.log(`Error parsing zoom range: ${zrange}, exiting!`);
        process.exit(1);
    }

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
            console.log("Error, invalid date format! Use mm-dd-yyyy or mm/dd/yyyy");
            process.exit(1);
        }
    }

    charturl = settings.ChartUrlTemplate.replace("<chartdate>", chartdate);
    charturl = charturl.replace("<charttype>", settings.ChartType);
}

function loadBestChartDate() {
    let thisdate = new  Date();
    let thistime = thisdate.getTime();
    let cdates = [];
    let found = false;
    settings.ChartDates.forEach((cdate) => {
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
