'use strict';

const fs = require("fs");
const shell = require('shelljs')
const { program } = require('commander');

let cmd = "";
let zoomrange = "4-11"; //default
let chartdate = "";
let workarea = __dirname + "/workarea/";

// make all the working directories
let dir_0_download      = workarea + "0_download";
let dir_1_unzipped      = workarea + "1_unzipped";
let dir_2_normalized    = workarea + "2_normalized";
let dir_3_expanded      = workarea + "3_expanded";
let dir_4_clipped       = workarea + "4_clipped";
let dir_5_warped        = workarea + "5_warped";
let dir_6_translated    = workarea + "6_translated";
let dir_7_tiled         = workarea + "7_tiled";
let dir_8_merged        = workarea + "8_merged";
let dir_9_mbtiled       = workarea + "9_mbtiled";

// get the commandline arguments
program
  .requiredOption('-d, --dateofchart <mm-dd-YYYY>', 'enter a valid date in the format mm-dd-YYYY')
  .option('-z, --zoomrange <range>', 'enter a hyphen-seperated zoom range or a single zoom level', '4-11');
program.showSuggestionAfterError();
program.parse(process.argv);

// execute each step in sequence
processArguments(program.opts());
makeWorkingFolders();
downloadCharts();
unzipAndNormalize();
expandToRgb();
clipAndWarp();
tileCharts();
mergeTiles();
makeMbTiles();

console.log("Chart processing completed!");
process.exit(0);


function processArguments(options) {
    let chdt = options.dateofchart.replace(" ", "");
    let zrng = options.zoomrange.replace(" ", "");

    // if user specified a range, validate number(s)
    let rngerror = false;
    if (zrng.search("-") > -1) {
        
        let rgs = zrng.split("-");
        if (isNaN(rgs[0]) || isNaN(rgs[1])) {
            rngerror = true;
        }
    }
    else {
        if (isNaN(zrng)) {
            rngerror = true;
        }
    }

    if (rngerror) {
        console.log("ERROR PARSING RANGE! Use n-n or just n where n is a number");
        process.exit(1);
    }
    else {
        zoomrange = zrng;
    }
    
    let mdy = [];

    if (chdt.search("/") > -1) {
        mdy = chdt.split("/");
    }
    else if (chdt.search("-") > -1) {
        mdy = chdt.split("-");
    }
    
    chartdate = `${mdy[0]}-${mdy[1]}-${mdy[2]}`;
    
    if (Date.parse(chartdate) == NaN) {
        console.log("INVALID DATE FORMAT! Use mm-dd-yyyy or mm/dd/yyyy");
        process.exit(1);
    }

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
    if (!fs.existsSync(dir_9_mbtiled)) fs.mkdirSync(dir_9_mbtiled);
}

function downloadCharts() {
    let rawdata = fs.readFileSync(__dirname + '/chartlist.json');
    let list = JSON.parse(rawdata);
    
    let charturl = list.charturl.replace("<chartdate>", chartdate);
    let areas = list.areas;

    areas.forEach(area => {
        let serverfile = charturl.replace("<chartname>", area);
        let localfile = area.replace("-", "_");
        localfile = localfile.replace(" ", "_");
        let filename = dir_0_download + "/" + localfile + ".zip"
        cmd = "wget " + serverfile + ` --output-document=${filename}`;

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
    
    console.log("deleting all of the htm files");
    fs.rm(dir_1_unzipped + "/*.htm");
    
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
            let chartfile = dir_1_unzipped + "/" + file;
            let normfile = dir_2_normalized + "/" + file;
            
            // Does this file have georeference info?
            if (getGdalInfo(chartfile, "PROJCRS")) {
                cmd = "mv --update --verbose " + chartfile + " " + normfile;
                executeCommand(cmd);
            }
        }
    }); 
}

function expandToRgb(){
    let files = fs.readdirSync(dir_2_normalized);

    files.forEach((file) => { 
        if (file.endsWith(".tif")) {
            console.log("*** Expand --- gdal_translate " + file);
            
            let sourceChartName = dir_2_normalized + "/" + file;
            let expandedfile = dir_3_expanded + "/" + file.replace(".tif", ".vrt");
            
            // Expand this file to RGBA if it has a color table
            if (getGdalInfo(sourceChartName, "Color Table")){

                console.log(`***  ${sourceChartName} has color table, need to expand to RGB:`);            
                
                cmd = "gdal_translate" + 
                        " -expand rgb" +         
                        " -strict" +              
                        " -of VRT" +             
                        ` -co "TILED=YES"` +       
                        ` -co "COMPRESS=LZW"` +    
                        " " + sourceChartName + 
                        " " + expandedfile;
            }
            else {
                console.log(`***  ${sourceChartName} does not have color table, do not need to expand to RGB`);
                
                cmd = "gdal_translate" +          
                        " -strict" +
                        " -of VRT" +
                        ` -co "TILED=YES"` +
                        ` -co "COMPRESS=LZW"` +
                        " " + sourceChartName
                        " " + expandedfile;
            }

            executeCommand(cmd);
        }
    });
}

function clipAndWarp(){
    /*--------------------------------------------------------------
     1) clip the source file with it's clipping shape file 
     2) warp to EPSG:3857 so that final output pixels are square
     3) tramslate the vrt to a Georeferenced tif file
     4) add overlay pyramid to tif 
    --------------------------------------------------------------*/
    let clippedShapesDir = __dirname + "/clipshapes";
    
    let files = fs.readdirSync(dir_3_expanded);
    files.forEach((file) => {
        if (file.endsWith(".vrt")) {
            // Get the file name without extension
            let basename = file.substring(0, file.length - 4);
            let shapedfile = clippedShapesDir + "/" + basename + ".shp";
            let expandedfile = dir_3_expanded + "/" + basename + ".vrt";
            let clippedfile = dir_4_clipped + "/" + basename + ".vrt";
            let warpedfile = dir_5_warped + "/" + basename + ".vrt";
            let translatedfile = dir_6_translated + "/" + basename + ".tif";

            // Clip the file it to its clipping shape
            console.log(`*** Clip to vrt --- gdalwarp ${file}`);
            cmd = "gdalwarp" +
                        " -of vrt" +
                        " -overwrite" + 
                        ` -cutline "${shapedfile}"` + 
                        " -crop_to_cutline" +
                        " -cblend 10" +
                        " -r lanczos" +                  
                        " -dstalpha" +                  
                        ` -co "ALPHA=YES"` +           
                        ` -co "TILED=YES"` +             
                        " -multi" +                     
                        " -wo NUM_THREADS=ALL_CPUS" +   
                        " -wm 1024" +                   
                        " --config GDAL_CACHEMAX 1024" +
                        " " + expandedfile +
                        " " + clippedfile; 
            executeCommand(cmd);

            console.log(`*** Warp to vrt --- gdalwarp ${file}`);
            cmd = "gdalwarp" +
                        " -of vrt" +
                        " -t_srs EPSG:3857" + 
                        " -r lanczos" +
                        " -overwrite" +
                        " -multi" +
                        " -wo NUM_THREADS=ALL_CPUS" +
                        " -wm 1024" +
                        ` -co "TILED=YES"` +
                        " --config GDAL_CACHEMAX 1024" +
                        " " + clippedfile +
                        " " + warpedfile;
            executeCommand(cmd);
            
            console.log(`***  Translate to tif --- gdal_translate ${basename}.vrt`);
            cmd = "gdal_translate" +
                        " -strict" +
                        ` -co "TILED=YES"` +
                        ` -co "COMPRESS=DEFLATE"` +
                        ` -co "PREDICTOR=1"` +
                        ` -co "ZLEVEL=9"` +
                        " --config GDAL_CACHEMAX 1024" +
                        " " + warpedfile + 
                        " " + translatedfile;
            executeCommand(cmd);
            
            console.log(`***  Add zoom layers to tif --- gdaladdo ${basename}.tif`);
            cmd = "gdaladdo" + 
                    " -ro" +
                    " -r average" + 
                    " --config INTERLEAVE_OVERVIEW PIXEL" + 
                    " --config COMPRESS_OVERVIEW JPEG" +
                    " --config BIGTIFF_OVERVIEW IF_NEEDED" +
                    " " + translatedfile + 
                    " 2 4 8 16 32 64" 
            executeCommand(cmd);
        }
    });
}

function tileCharts() {
    let files = fs.readdirSync(dir_6_translated);
    
    files.forEach((file) => {
        if (file.endsWith(".tif")) {        
            let sourcechart = dir_6_translated + "/" + file;
            let tiledir = dir_7_tiled + "/" + file.replace(".tif", "");
            
            console.log(`--------Tiling ${file}------------`);
            
            // Create tiles from the source raster
            let cmd = "gdal2tiles.py" +
                            ` --zoom=${zoomrange}` +             
                            " " + sourcechart + 
                            " " + tiledir;
            executeCommand(cmd);
        }
    });
}

function mergeTiles() {
    let files = fs.readdirSync(dir_7_tiled);
    files.forEach((file) => {
        // Merge the individual charts into an overall chart
        let sourcedir = dir_7_tiled + "/" + file;
        let destdir = dir_8_merged;
        let cmd = `perl ./mergetiles.pl ${sourcedir} ${destdir}`;
        executeCommand(cmd);
    });
}

function makeMbTiles() {
    let zooms = zoomrange.split("-");
    let minzoom = zooms[0];
    let maxzoom = zooms[0];
    
    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }

    // create a metadata.json file in the root of the tiles directory,
    // mbutil will use this to generate a metadata table in the database.  
    let metajson = `{ 
        "name": "usavfr",
        "description": "VFR Sectional Charts",
        "version": "1",
        "type": "baselayer",
        "format": "png",
        "minzoom": "${minzoom}",
        "maxzoom": "${maxzoom}" 
    }`;
    let fpath = dir_8_merged + "/metadata.json"; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = dir_9_mbtiled + "/usavfr.mbtiles";   
    let cmd = "./mbutil/mb-util.py" +
                " --scheme=tms" +              
                " " + dir_8_merged +
                " " + mbtiles
    executeCommand(cmd);
}

function executeCommand(command) {
    console.log(command)
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
    let gdalresults = __dirname + "/gdal.txt"

    cmd = "gdalinfo " + file + " -noct > " + gdalresults; 
    console.log(cmd);

    let { stderr } = shell.exec(cmd, { silent: true })
    if (stderr) {
        console.log(stderr);
    }
    
    let gdaldata = fs.readFileSync(gdalresults, {encoding:'utf8', flag:'r'});         
    let retval = (gdaldata.toString().search(searchtext) > -1) 
    fs.rmSync(gdalresults);
    
    return retval;
}