'use strict';

const fs = require("fs");
const shell = require('shelljs')
const sqlite3 = require("sqlite3").verbose();
const { program } = require('commander');

let cmd = "";
let zoomrange = "5-11"; //default
let chartdate = "";
let workarea = `${__dirname}/workarea`;

// all of the processing directory names
let dir_0_download      = `${workarea}/0_download`;
let dir_1_unzipped      = `${workarea}/1_unzipped`;
let dir_2_normalized    = `${workarea}/2_normalized`;
let dir_3_expanded      = `${workarea}/3_expanded`;
let dir_4_clipped       = `${workarea}/4_clipped`;
let dir_5_warped        = `${workarea}/5_warped`;
let dir_6_translated    = `${workarea}/6_translated`;
let dir_7_tiled         = `${workarea}/7_tiled`;
let dir_8_merged        = `${workarea}/8_merged`;
let dir_9_mbtiled       = `${workarea}/9_mbtiled`;

// make the processing directories
fs.mkdirSync(workarea);
fs.mkdirSync(dir_0_download);
fs.mkdirSync(dir_1_unzipped);
fs.mkdirSync(dir_2_normalized);
fs.mkdirSync(dir_3_expanded);
fs.mkdirSync(dir_4_clipped);
fs.mkdirSync(dir_5_warped);
fs.mkdirSync(dir_6_translated);
fs.mkdirSync(dir_7_tiled);
fs.mkdirSync(dir_8_merged);
fs.mkdirSync(dir_9_mbtiled);

// get the commandline arguments
program
  .requiredOption('-d, --dateofchart <mm-dd-YYYY>', 'enter a valid date in the format mm-dd-YYYY')
  .option('-z, --zoomrange <range>', 'enter a hyphen-seperated zoom range or a single zoom level', '5-11');
program.showSuggestionAfterError();
program.parse(process.argv);

// execute each step in sequence
processArguments(program.opts());

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
    zoomrange = options.zoomrange.replace(" ", "");
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

function downloadCharts() {
    let rawdata = fs.readFileSync(`${__dirname}/chartlist.json`);
    let list = JSON.parse(rawdata);
    
    let charturl = list.charturl.replace("<chartdate>", chartdate);
    let areas = list.areas;

    areas.forEach(area => {
        let serverfile = charturl.replace("<chartname>", area);
        let localfile = area.replace("-", "_");
        localfile = localfile.replace(" ", "_");
        let filename = `${dir_0_download}/${localfile}.zip`
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
    
    console.log("deleting all of the htm files");
    fs.rm(`${dir_1_unzipped}/*.htm`);
    
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
            let tfwfile = file.replace(".tif", ".tfw");
            let chartfile = `${dir_1_unzipped}/${file}`;
            let normfile = `${dir_2_normalized}/${file}`;
            let tfwsrcfile = `${dir_1_unzipped}/${tfwfile}`;
            let tfwdst2file = `${dir_2_normalized}/${tfwfile}`;
            let tfwdst3file = `${dir_3_expanded}/${tfwfile}`;
            let tfwdst4file = `${dir_4_clipped}/${tfwfile}`;

            // Does this file have georeference info?
            if (getGdalInfo(chartfile, "PROJCRS")) {
                cmd = `mv --update --verbose ${chartfile} ${normfile}`;
                executeCommand(cmd);
            }

            // copy the associated .tfw files into the processing directories
            fs.copyFileSync(tfwsrcfile, tfwdst2file);
            fs.copyFileSync(tfwsrcfile, tfwdst3file);
            fs.copyFileSync(tfwsrcfile, tfwdst4file);
        }
    }); 
}

function expandToRgb(){
    let files = fs.readdirSync(dir_2_normalized);

    files.forEach((file) => { 
        if (file.endsWith(".tif")) {
            console.log("*** Expand --- gdal_translate " + file);
            
            let sourceChartName = `${dir_2_normalized}/${file}`;
            let expandedfile = `${dir_3_expanded}/${file.replace(".tif", ".vrt")}`;
            
            console.log(`Expanding to ${expandedfile}`);
            cmd = "gdal_translate" + 
                    " -expand rgb" +         
                    " -strict" +              
                    " -of VRT" +      
                    " -co TILED=YES" +       
                    " -co COMPRESS=LZW" +
                    ` ${sourceChartName} ${expandedfile}`;
            executeCommand(cmd);
        }
    });
}

function clipAndWarp(){
    /*------------------------------------------------------------
     1) Clip the source file 
     2) warp to EPSG:3857 so that final output pixels are square
     3) translate from vrt to Georeferenced tif 
     4) add zoom levels to tif 
    --------------------------------------------------------------*/
    let clippedShapesDir = `${__dirname}/clipshapes`;
    
    let files = fs.readdirSync(dir_3_expanded);
    files.forEach((file) => {
        if (file.endsWith(".vrt")) {
            // Get the file name without extension
            let basename = file.substring(0, file.length - 4);
            let shapefile = `${clippedShapesDir}/${basename}.shp`;
            let expandedfile = `${dir_3_expanded}/${basename}.vrt`;
            let clippedfile = `${dir_4_clipped}/${basename}.vrt`;
            let warpedfile = `${dir_5_warped}/${basename}.vrt`;
            let translatedfile = `${dir_6_translated}/${basename}.tif`;

            // Clip the file using it's corresponding shape file
            console.log(`*** Clip to vrt --- gdalwarp ${file}`);
            cmd = "gdalwarp" +
                        " -of vrt" +
                        " -overwrite" + 
                        ` -cutline "${shapefile}"` + 
                        " -crop_to_cutline" +
                        " -cblend 10" +
                        " -r lanczos" +                  
                        " -co ALPHA=YES" +           
                        " -co TILED=YES" +             
                        " -multi" +                     
                        " -wo NUM_THREADS=ALL_CPUS" +   
                        " -wm 1024" +                   
                        " --config GDAL_CACHEMAX 1024" +
                        ` ${expandedfile} ${clippedfile}`; 
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
                        ` ${clippedfile} ${warpedfile}`;
            executeCommand(cmd);
            
            console.log(`***  Translate to tif --- gdal_translate ${basename}.vrt`);
            cmd = "gdal_translate" +
                        " -strict" +
                        " -co TILED=YES" +
                        " -co COMPRESS=DEFLATE" +
                        " -co PREDICTOR=1" +
                        " -co ZLEVEL=9" +
                        " --config GDAL_CACHEMAX 1024" +
                        ` ${warpedfile} ${translatedfile}`;
            executeCommand(cmd);
            
            console.log(`***  Add zoom layers to tif --- gdaladdo ${basename}.tif`);
            cmd = "gdaladdo" + 
                    " -ro" +
                    " -r average" + 
                    " --config INTERLEAVE_OVERVIEW PIXEL" + 
                    " --config COMPRESS_OVERVIEW JPEG" +
                    " --config BIGTIFF_OVERVIEW IF_NEEDED" +
                    ` ${translatedfile}` + 
                    " 2 4 8 16 32 64" 
            executeCommand(cmd);
        }
    });
}

function tileCharts() {
    let files = fs.readdirSync(dir_6_translated);
    files.forEach((file) => {
        if (file.endsWith(".tif")) {        
            let sourcechart = `${dir_6_translated}/${file}`;
            let tiledir = `${dir_7_tiled}/${file.replace(".tif", "")}`;
            
            console.log(`--------Tiling ${file}------------`);
            
            // Create tiles from the source raster
            let cmd = `gdal2tiles.py --zoom="${zoomrange}" ${sourcechart} ${tiledir}`;
            executeCommand(cmd);
        }
    });
}

function mergeTiles() {
    // loop through all of the area folders in dir_7_tiled
    let areas = fs.readdirSync(dir_7_tiled);
    areas.forEach((area) => {
        let sourcearea = `${dir_7_tiled}/${area}`;
        
        // now loop through all of the z folders in the area
        let zs = fs.readdirSync(sourcearea); 
        zs.forEach((z) => {
            let sourcez = `${sourcearea}/${z}`;
            let destz = `${dir_8_merged}/${z}`;
            if (fs.lstatSync(sourcez).isDirectory()) { 
            
                if (!fs.existsSync(destz)) {
                    fs.mkdirSync(destz);
                }
                
                // now loop through all of the y folders in the z folder 
                let ys = fs.readdirSync(sourcez);
                ys.forEach((y) => {
                    let sourcey = `${sourcez}/${y}`;
                    let desty = `${destz}/${y}`;
                    
                    if (!fs.existsSync(desty)) {
                        fs.mkdirSync(desty);
                    } 
                    
                    // finally, loop through all of the x images in the y folders
                    let xs = fs.readdirSync(sourcey);
                    xs.forEach((x) => {
                        let sourcex =`${sourcey}/${x}`;
                        let destx = `${desty}/${x}`;
                      
                        console.log(`merging ${sourcex} to ${destx}`);
                      
                        if (fs.existsSync(destx)) {
                            // the x image exists, so it needs to be composited using ImageMagick
                            console.log(`compositing ${sourcex} with ${destx}`);
                            let cmd = `convert ${sourcex} ${destx} -composite ${sourcex}`;
                            executeCommand(cmd); 
                        }
                        else {
                            // otherwise just copy the x image to the destination
                            fs.copyFileSync(sourcex, destx);
                        }
                    });
                });
            }
        });
    });    
}

function makeMbTiles() {
    let mbtiles = `${dir_9_mbtiled}/usavfr.mbtiles`;   
    
    let cmd = `./mbutil/mb-util.py --scheme=tms ${dir_8_merged} ${mbtiles}`;
    executeCommand(cmd);
    
    // now add the metadata        
    let tiledb = new sqlite3.Database(mbtiles, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            console.error(err);
            return;
        }
    });
    
    let zooms = zoomrange.split("-");
    let minzoom = zooms[0];
    let maxzoom = zooms[0];  

    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }
    
    let sql = "INSERT INTO metadata (name, value) VALUES (?, ?)";
    tiledb.run(sql, ["name", "usavfr"]);
    tiledb.run(sql, ["type", "baselayer"]);
    tiledb.run(sql, ["format", "png"]);
    tiledb.run(sql, ["minzoom", `${minzoom}`]);
    tiledb.run(sql, ["maxzoom", `${maxzoom}`]);
    tiledb.close();
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
    let gdalresults = `${__dirname}/gdal.txt`;

    cmd = `gdalinfo ${file} -noct > ${gdalresults}`; 
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
