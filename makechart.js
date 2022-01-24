'use strict';

const fs = require("fs");
const shell = require('shelljs')
const { program } = require('commander');
const Canvas = require('canvas');

let cmd = "";
let zoomrange = "5-11"; //default
let chartdate = "";
let workarea = `${__dirname}/workarea`;

// make all the working directories
let dir_0_download      = `${workarea}/0_download`;
let dir_1_unzipped      = `${workarea}/1_unzipped`;
let dir_2_normalized    = `${workarea}/2_normalized`;
let dir_3_expanded      = `${workarea}/3_expanded`;
let dir_4_clipped       = `${workarea}/4_clipped`;
let dir_5_warped        = `${workarea}/5_warped`;
let dir_6_translated    = `${workarea}/6_translated`;
let dir_7_tiled         = `${workarea}/7_tiled`;
let dir_8_merged        = `${workarea}/8_merged`;
let dir_9_dbtiles       = `${workarea}/9_dbtiles`;

// get the commandline arguments
program
  .requiredOption('-d, --dateofchart <mm-dd-YYYY>', 'enter a valid date in the format mm-dd-YYYY')
  .option('-z, --zoomrange <range>', 'enter a hyphen-seperated zoom range or a single zoom level', '4-11');
program.showSuggestionAfterError();
program.parse(process.argv);

let rawdata; 
let list; 
let charturl; 
let areas; 
let tiledbname; 

// execute each step in sequence
processArguments(program.opts());
makeWorkingFolders();
downloadCharts();
unzipAndNormalize();
processImages();
mergeTiles(); 
makeMbTiles();
convertPngToJpeg();
addOverviewsToMbtiles();

console.log("Chart processing completed!");
process.exit(0);


function processArguments(options) {
    let chdate = options.dateofchart.replace(" ", "");
    let zrange = options.zoomrange.replace(" ", "");
    let error = false;

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
        console.log("ERROR PARSING RANGE! Use n-n or just n where n is a number");
        process.exit(1);
    }
    else {
        zoomrange = zrange;
    }
    
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

    rawdata = fs.readFileSync(`${__dirname}/chartlist.json`);
    list = JSON.parse(rawdata);
    charturl = list.charturl.replace("<chartdate>", chartdate);
    areas = list.areas;
    tiledbname = list.tiledbname;
    console.log(`Arguments processed: ${chartdate}, ${zoomrange}`);
}

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
    if (!fs.existsSync(dir_9_dbtiles)) fs.mkdirSync(dir_9_dbtiles);
}

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
            
            if (getGdalInfo(normalizedfile, "Color Table")){
                console.log(`  * Translate color table to RGB GTiff`);
                cmd = `gdal_translate -strict -of vrt -expand rgb ${normalizedfile} ${expandedfile}`;
            }
            else {
                console.log(`  * No color table expansion needed`)
                cmd = `gdal_translate -strict -of ${normalizedfile} ${expandedfile}`;
            }
            executeCommand(cmd);

            console.log(`  * Clip border off of virtual image`);
            cmd = `gdalwarp -of vrt -r lanczos -multi -cutline "${shapefile}" -crop_to_cutline -cblend 10 -dstalpha -co ALPHA=YES -wo NUM_THREADS=ALL_CPUS -wm 1024 --config GDAL_CACHEMAX 1024 ${expandedfile} ${clippedfile}`; 
            executeCommand(cmd);

            console.log(`  * Warp virtual image to EPSG:3857`);
            cmd = `gdalwarp -of vrt -t_srs EPSG:3857 -r lanczos -multi -wo NUM_THREADS=ALL_CPUS -wm 1024 --config GDAL_CACHEMAX 1024 ${clippedfile} ${warpedfile}`;
            executeCommand(cmd);
            
            console.log(`  * Translate clipped & warped virtual image back into GTiff`);
            cmd = `gdal_translate -co TILED=YES -co COMPRESS=JPEG -co JPEG_QUALITY=90 -co INTERLEAVE=PIXEL -co NUM_THREADS=ALL_CPUS ${warpedfile} ${translatedfile}`;
            executeCommand(cmd);
            
            console.log(`  * Tile GTIFF`);
            cmd = `gdal2tiles.py --zoom=11 --processes=4 -x ${translatedfile} ${tiledir}`;
            executeCommand(cmd);
        }
    });
}

function mergeTiles() {
    let files = fs.readdirSync(dir_7_tiled);
    files.forEach((file) => {
        // Merge the individual area tiles into one overall tileset
        let sourcedir = `${dir_7_tiled}/${file}`;
        console.log(`  * Merging ${sourcedir} tiles`);
        let cmd = `perl ./mergetiles.pl ${sourcedir} ${dir_8_merged}`;
        executeCommand(cmd);
    });
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
        "name": "temp",
        "description": "VFR Sectional Charts",
        "version": "1.0",
        "type": "baselayer",
        "format": "png",
        "minzoom": "${maxzoom}", 
        "maxzoom": "${maxzoom}" 
    }`;
    let fpath = `${dir_8_merged}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_9_dbtiles}/temp.mbtiles`;   
    let cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_8_merged} ${mbtiles}`;
    executeCommand(cmd);
}

function convertPngToJpeg() {
    console.log(`  * Converting mbtiles to JPEG format`);
    let mbtilespng = `${dir_9_dbtiles}/temp.mbtiles`;
    let mbtilesjpg = `${dir_9_dbtiles}/${tiledbname}`;
    let cmd = `gdal_translate -co TILE_FORMAT=JPEG -co COMPRESS=JPEG -co JPEG_QUALITY=90 -co INTERLEAVE=PIXEL -co PHOTOMETRIC=YCBCR -co NUM_THREADS=ALL_CPUS --config GDAL_CACHEMAX 1024 -of MBTILES ${mbtilespng} ${mbtilesjpg}`;
    executeCommand(cmd);
}

function addOverviewsToMbtiles() {
    let mbtilesfile = `${dir_9_dbtiles}/${tiledbname}`;
    console.log(`  * Add zoom overlays to MBTILES`);
    cmd = `gdaladdo -r average --config INTERLEAVE_OVERVIEW PIXEL --config PHOTOMETRIC_OVERVIEW YCBCR --config COMPRESS_OVERVIEW JPEG --config JPEG_QUALITY_OVERVIEW 90 --config GDAL_NUM_THREADS ALL_CPUS ${mbtilesfile} 2 4 8 16 32 64`;
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

function isTransparentImage(imagepath) {
    let retval = 0;
    let imagedata = fs.readFileSync(imagepath);
    let img = new Canvas.Image(); 
    img.src = imagedata;
    let canvas = new Canvas.Canvas(img.width, img.height); 
    let ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    let data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opacity = 0;
    for (let i = 0; i < data.length; i += 4) {
        opacity += data[i + 3];
    }
    retval = (opacity / 255) / (data.length / 4);
    return (retval === 0);
}