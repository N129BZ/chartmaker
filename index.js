'use strict';

const fs = require("fs");
const shell = require('shelljs')
const Database = require("better-sqlite3");

let cmd = "";
let hasargs = false;
let chartdate = "";
let workarea = __dirname + "/workarea/";

// make all the working directories
let dir_0_download      = workarea + "0_download/";
let dir_1_unzipped      = workarea + "1_unzipped/"
let dir_2_normalized    = workarea + "2_normalized/"
let dir_3_expanded      = workarea + "3_expanded/"
let dir_4_clipped       = workarea + "4_clipped/"
let dir_5_warped        = workarea + "5_warped/"
let dir_6_translated    = workarea + "6_translated/"
let dir_7_mbtiled       = workarea + "7_mbtiled/"
let dir_8_mastermbtiles = workarea + "8_mastermbtiles/";

makeDirectory(workarea);
makeDirectory(dir_0_download);
makeDirectory(dir_1_unzipped);
makeDirectory(dir_2_normalized);
makeDirectory(dir_3_expanded);
makeDirectory(dir_4_clipped);
makeDirectory(dir_5_warped);
makeDirectory(dir_6_translated);
makeDirectory(dir_7_mbtiled);
makeDirectory(dir_8_mastermbtiles);

// execute each step in sequence
processArguments();
copyMasterMbtiles();
downloadCharts();
unzipAndNormalize();
expandToRgb();
clipAndWarp();
makeMbTiles();
mergeAllMbtiles();

console.log("Chart processing completed!");
process.exit(0);


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

function copyMasterMbtiles() {
    let sourcedb = __dirname + "/vfrsectional.mbtiles";
    let destdb = dir_8_mastermbtiles + "vfrsectional.mbtiles";
    fs.copyFileSync(sourcedb, destdb);
}

function downloadCharts() {
    let rawdata = fs.readFileSync(__dirname + '/chartlist.json');
    let list = JSON.parse(rawdata);
    
    let faaurl = list.faaurl.replace("<chartdate>", chartdate);
    let areas = list.areas;

    areas.forEach(area => {
        let serverfile = faaurl.replace("<chartname>", area);
        let localfile = area.replace("-", "_");
        localfile = localfile.replace(" ", "_");
        let filename = dir_0_download + localfile + ".zip"
        cmd = "wget " + serverfile + ` --output-document=${filename}`;
        if (executeCommand(cmd) != "") {
            console.log("NO CHARTS FOUND, make sure you enter a valid FAA sectional chart release date.");
            process.exit(1);
        }
    });
}

// unzip and normalize here
function unzipAndNormalize() {
    let files = fs.readdirSync(dir_0_download);

    console.log("unzipping all of the chart zip files");
    files.forEach((file) => {
        cmd = `unzip -u -o ${dir_0_download}${file} -d ${dir_1_unzipped}`;
        executeCommand(cmd);
    });
    
    console.log("deleting all of the tfw files");
    fs.rm(dir_1_unzipped + "*.tfw");
    
    console.log("deleting all of the htm files");
    fs.rm(dir_1_unzipped + "*.htm");
    
    files = fs.readdirSync(dir_1_unzipped);
    
    files.forEach((file) => {
        let escapedname = replaceAll(file, " ", "\\ ");
        let newname = replaceAll(file, " ", "_");
        newname = replaceAll(newname, "-", "_");
        newname = newname.replace("_SEC", "");
    
        cmd = `mv ${dir_1_unzipped}${escapedname} ${dir_1_unzipped}${newname}`;
        executeCommand(cmd);
    });

    console.log("normalizing and copying");
    
    files = fs.readdirSync(dir_1_unzipped); 
    files.forEach((file) => {
        if (file.endsWith(".tif")) {
            let chartfile = dir_1_unzipped + file;
            let normfile = dir_2_normalized + file;
            
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
    
        console.log("*** Expand --- gdal_translate " + file);

        let vrt_name = dir_3_expanded + file.replace(".tif", ".vrt");
        let sourceChartName = dir_2_normalized + file;

        console.log(`Expanding to ${vrt_name}`);
        
        // Expand this file to RGBA if it has a color table
        if (getGrepResult(sourceChartName, "Color Table")){

            console.log(`***  ${sourceChartName} has color table, need to expand to RGB:`);            
            
            cmd = "gdal_translate" + 
                    " -expand rgb" +         
                    " -strict" +              
                    " -of VRT" +             
                    " -co TILED=YES" +       
                    " -co COMPRESS=LZW" +    
                    " " + sourceChartName + 
                    " " + vrt_name;
        }
        else {
            console.log(`***  ${sourceChartName} does not have color table, do not need to expand to RGB`);
            
            cmd = "gdal_translate" +          
                    " -strict"
                    " -of VRT"
                    " -co TILED=YES"
                    " -co COMPRESS=LZW"
                    " " + sourceChartName
                    " " + vrt_name;
        }

        executeCommand(cmd);
    });
}

function clipAndWarp(){
    //--------------------------------------------------------------
    // 1) Clip the source file first then 
    // 2) warp to EPSG:3857 so that final output pixels are square
    // 3) tramslate to mbtiles file with base layer
    // 4) add zoom levels to mbtiles 
    //--------------------------------------------------------------
    let clippedShapesDir = __dirname + "/clipshapes/";
    
    let files = fs.readdirSync(dir_3_expanded);
    files.forEach((file) => {
        
        // Get the file name without extension
        let basename = file.substring(0, file.length - 4);
        let shapedfilename = clippedShapesDir + basename + ".shp";
        let clippedsourcefile = dir_3_expanded + basename + ".vrt";
        let clippeddestfile = dir_4_clipped + basename + ".vrt";

        // Clip the file it to its clipping shape
        console.log(`*** Clip to vrt --- gdalwarp ${file}`);
        
        cmd = "gdalwarp" +
                    " -of vrt" +
                    " -overwrite" + 
                    " -cutline " + shapedfilename +
                    " -crop_to_cutline" +
                    " -t_srs EPSG:3857" + 
                    " -cblend 10" +
                    " -r lanczos" +
                    " -dstalpha" +
                    " -co ALPHA=YES" +
                    " -co TILED=YES" +
                    " -multi" +
                    " -wo NUM_THREADS=ALL_CPUS" + 
                    " -wm 1024" +
                    " --config GDAL_CACHEMAX 1024" + " " +
                    clippedsourcefile + " " +
                    clippeddestfile;
        executeCommand(cmd);
        
        // Warp the expanded file
        let warpedfile = dir_5_warped + basename + ".vrt";
        console.log(`*** Warp to tif --- gdalwarp ${file}`);
        console.log(`clipped source: ${clippeddestfile}`);
        console.log(`warped destination: ${warpedfile}`);
        
        cmd = "gdalwarp" + 
                    " -of vrt" + 
                    " -t_srs EPSG:3857" + 
                    " -r lanczos" +
                    " -overwrite" +
                    " -multi" +
                    " -wo NUM_THREADS=ALL_CPUS" +
                    " -wm 1024" +
                    " --config GDAL_CACHEMAX 1024" +
                    " -co TILED=YES " +  
                    clippeddestfile + " " +
                    warpedfile;
        executeCommand(cmd);
        
        console.log(`***  Translate to tif --- gdal_translate ${basename}.vrt`);
        let tifname = dir_6_translated + basename + ".tif";
        
        // translate warped file to tif
        cmd = "gdal_translate" +
                    " -strict" +
                    " -co TILED=YES" +
                    " -co COMPRESS=DEFLATE" +
                    " -co PREDICTOR=1" +
                    " -co ZLEVEL=9" +
                    " --config GDAL_CACHEMAX 1024" +
                    " " + warpedfile + 
                    " " + tifname;
        executeCommand(cmd);
        
        // create image pyramid
        cmd = "gdaladdo" + 
                   " -r nearest" + 
                   " " + tifname + 
                   " 2 4 8 16 32 64"
        executeCommand(cmd);

        let mbtfile = dir_7_mbtiled + file.replace(".vrt", ".mbtiles");
        makeMbTiles(tifname, mbtfile);
    });
}

function makeMbTiles(tif, mbtfile) {
    // translate tif into a mbtiles database
    cmd = "gdal_translate " +
                " -of MBTILES" +  
                " " + tif + 
                " " + mbtfile;
    executeCommand(cmd);

    // add zoom levels
    cmd = "gdaladdo" + 
                " -r average" + 
                " " + mbtfile; 
    executeCommand(cmd);
}

function mergeAllMbtiles() {
    
    let mastermbtiles = dir_8_mastermbtiles + "vfrsectional.mbtiles";
    let masterdb = new Database(mastermbtiles, { verbose: console.log });
    let files = fs.readdirSync(dir_7_mbtiled);

    files.forEach((file) => {
        
        let tmpdbname = dir_7_mbtiled + file;
        
        let sql = "ATTACH DATABASE  '" + tmpdbname + "' AS secdb; ";      
        let stmt = masterdb.prepare(sql);
        stmt.run();

        sql = "INSERT INTO main.tiles SELECT * FROM secdb.tiles;";  
        stmt = masterdb.prepare(sql);
        stmt.run();

        sql = "DETACH DATABASE 'secdb';";
        stmt = masterdb.prepare(sql);
        stmt.run();
    });

    masterdb.close();
}

function makeDirectory(dirname) {
    shell.exec("mkdir " + dirname, { silent: true });
}

function executeCommand(command) {
    console.log(command)
    let { stderr } = shell.exec(command, { silent: true });
    if(stderr) {
        console.log(stderr);
        return stderr;
    }
    return "";
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
