'use strict';

const fs = require("fs");
const shell = require('shelljs')

let cmd = "";
let hasargs = false;
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

// execute each step in sequence
makeDirectories();
normalizeClipFiles();
processArguments();
downloadCharts();
unzipAndNormalize();
expandToRgb();
clipAndWarp();
tileCharts();
mergeTiles();
makeMbTiles();

console.log("Chart processing completed!");
process.exit(0);

function makeDirectories() {
    makeDirectory(workarea);
    makeDirectory(dir_0_download);
    makeDirectory(dir_1_unzipped);
    makeDirectory(dir_2_normalized);
    makeDirectory(dir_3_expanded);
    makeDirectory(dir_4_clipped);
    makeDirectory(dir_5_warped);
    makeDirectory(dir_6_translated);
    makeDirectory(dir_7_tiled);
    makeDirectory(dir_8_merged);
    makeDirectory(dir_9_mbtiled);
}


function normalizeClipFiles() {
    let clipdir = __dirname + "/clipshapes/";
    let files = fs.readdirSync(clipdir);
    files.forEach((file) => {
        let oldname = clipdir + file;
        let newname = clipdir + file.replace("_SEC.", ".");
        cmd = `mv ${oldname} ${newname}`;
        executeCommand(cmd);
    });
}

function processArguments() {

    let args = process.argv.slice(2);
    let mdy = [];

    if (args.length == 0) {
        console.log("NO DATE ARGUMENT, use either mm-dd-yyyy or mm/dd/yyyy date format");
        process.exit(1);
    }

    if (args[0].search("/") > -1) {
        mdy = args[0].split("/");
        hasargs = true;
    }
    else if (args[0].search("-") > -1) {
        mdy = args[0].split("-");
        hasargs = true;
    }

    if (!hasargs) {
        console.log("NO DATE OR INVALID DATE ARGUMENT, Use mm-dd-yyyy or mm/dd/yyyy");
        process.exit(1);
    }
    
    chartdate = `${mdy[0]}-${mdy[1]}-${mdy[2]}`;
    
    if (Date.parse(chartdate) == NaN) {
        "INVALID DATE FORMAT! Use mm-dd-yyyy or mm/dd/yyyy"
        process.exit(1);
    }
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
            if (getGrepResult(chartfile, "PROJCRS")) {
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
            
            console.log(`Expanding to ${expandedfile}`);
            cmd = "gdal_translate" + 
                    " -expand rgb" +         
                    " -strict" +              
                    " -of VRT" +      
                    " -co TILED=YES" +       
                    " -co COMPRESS=LZW" +
                    " " + sourceChartName + 
                    " " + expandedfile;
            executeCommand(cmd);
        }
    });
}

function clipAndWarp(){
    //--------------------------------------------------------------
    // 1) Clip the source file first then 
    // 2) warp to EPSG:3857 so that final output pixels are square
    // 3) tramslate to mbtiles file with base layer
    // 4) add zoom levels to mbtiles 
    //--------------------------------------------------------------
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
                        " -co ALPHA=YES" +           
                        " -co TILED=YES" +             
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
                        " -co TILED=YES" +
                        " --config GDAL_CACHEMAX 1024" +
                        " " + clippedfile +
                        " " + warpedfile;
            executeCommand(cmd);
            
            console.log(`***  Translate to tif --- gdal_translate ${basename}.vrt`);
            cmd = "gdal_translate" +
                        " -strict" +
                        " -co TILED=YES" +
                        " -co COMPRESS=DEFLATE" +
                        " -co PREDICTOR=1" +
                        " -co ZLEVEL=9" +
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
                            " --zoom=4-11" +             
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
        let pgm = "perl ./merge_tile_sets.pl";
        let cmd = pgm +
                " " + sourcedir +
                " " + destdir;
        executeCommand(cmd);
    });
}

function makeMbTiles() {
    let mbtiles = dir_9_mbtiled + "/usavfr.mbtiles";   
    let cmd = "./mbutil/mb-util.py" +
                " --scheme=tms" +              
                " " + dir_8_merged +
                " " + mbtilesfaa
}

function makeDirectory(dirname) {
    shell.exec("mkdir " + dirname, { silent: true });
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

function getGrepResult(file, searchtext) {
    let gdalresults = __dirname + "/gdal.txt"

    cmd = "gdalinfo " + file + " -noct > " + gdalresults; 
    console.log(cmd);

    let { stderr } = shell.exec(cmd, { silent: true })
    if (stderr) {
        console.log(stderr);
    }
    
    let gdaldata = fs.readFileSync(gdalresults, {encoding:'utf8', flag:'r'});         
    let retval = (gdaldata.toString().search(searchtext) > -1) 
    fs.rm(gdalresults);
    
    return retval;
}
