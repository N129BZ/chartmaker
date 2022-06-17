'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

let settings;
let cmd = "";
let chartdate = "";
let charturl = ""; 
let charttype = "";
let chartlayertype = "";
let zipfile = "";
let chartareas = [];
let workarea = ""; 
let chartfolder = "";
let chartworkname = "";
let dir_0_download = "";
let dir_1_unzipped = "";       
let dir_2_normalized = "";     
let dir_3_expanded = "";       
let dir_4_clipped = "";        
let dir_5_warped = "";         
let dir_6_translated = "";     
let dir_7_tiled = "";          
let dir_8_merged = "";         
let dir_8_quantized = "";      
let dir_9_dbtiles = "";

const runChartProcessing = function(runsettings) {
    settings = runsettings;
    let tmp = fs.readFileSync(`${__dirname}/charttypes.json`);
    let obj = JSON.parse(tmp.toString());
    charttype = obj.ChartTypes[settings.ChartIndex][0];
    chartlayertype = obj.ChartTypes[settings.ChartIndex][1];
    if (charttype.search("Grand_Canyon") !== -1) {
        chartworkname = "Grand_Canyon";
    }
    else {
        chartworkname = charttype;
    }
    tmp = null;
    obj = null;
    workarea             = `${__dirname}/workarea`;
    chartfolder          = `${workarea}/${chartworkname}`;
    dir_0_download       = `${chartfolder}/0_download`;
    dir_1_unzipped       = `${chartfolder}/1_unzipped`;
    dir_2_normalized     = `${chartfolder}/2_normalized`;
    dir_3_expanded       = `${chartfolder}/3_expanded`;
    dir_4_clipped        = `${chartfolder}/4_clipped`;
    dir_5_warped         = `${chartfolder}/5_warped`;
    dir_6_translated     = `${chartfolder}/6_translated`;
    dir_7_tiled          = `${chartfolder}/7_tiled`;
    dir_8_merged         = `${chartfolder}/8_merged`;
    dir_8_quantized      = `${chartfolder}/8_quantized`;
    dir_9_dbtiles        = `${chartfolder}/9_dbtiles`;
    
    chartdate = getBestChartDate();
    charturl = settings.ChartUrlTemplate.replace("<chartdate>", chartdate);
    charturl = charturl.replace("<charttype>", chartworkname);
    runProcessingSteps();
}
module.exports = runChartProcessing;

function runProcessingSteps() {
    makeWorkingFolders();
    downloadCharts();
    unzipCharts();
    normalizeChartNames();
    processImages();
    mergeTiles();
    quantizePngImages();
    makeMbTiles();
}

function makeWorkingFolders() {
    console.log("Creating working area folders");
    if (!fs.existsSync(workarea)) fs.mkdirSync(workarea);
    if (!fs.existsSync(chartfolder)) fs.mkdirSync(chartfolder);
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
    console.log(`Downloading ${chartworkname}.zip`);
    let chartzip = `${dir_0_download}/${chartworkname}.zip`;
    cmd = `wget ${charturl} --output-document=${chartzip}`;
    executeCommand(cmd);
}

function unzipCharts() {
    let chartzip = `${dir_0_download}/${chartworkname}.zip`;
    cmd = `unzip -o ${chartzip} -x '*.htm' -d ${dir_1_unzipped}`;
    executeCommand(cmd);
}

function normalizeChartNames() {
    let tifname = "";
    let tfwname = "";
    let files = fs.readdirSync(dir_1_unzipped);
    
    files.forEach((file) => {
        if (file.endsWith(".tif") && file.search("FLY") === -1) {
            let testname = normalizeFileName(file);
            let basename = testname.replace(".tif", "");
            tifname = `${dir_2_normalized}/${basename}.tif`;
            tfwname = `${dir_2_normalized}/${basename}.tfw`;
            fs.copyFileSync(`${dir_1_unzipped}/${file}`, tifname);
            fs.copyFileSync(`${dir_1_unzipped}/${file.replace(".tfw", ".tif")}`, tfwname);

            if (basename.search("Grand_Canyon") > -1) {
                if (basename !== charttype) {
                    fs.rmSync(tifname);
                    fs.rmSync(tfwname);
                }
            }
        }
    });
}

function processImages(){
    /*--------------------------------------------------------------
     1) clip the source image to VRT with the associated shape file 
     2) warp to EPSG:3857 so that final output pixels are squareettings.ChartType
     3) tramslate the VRT back into a GTIFF file
     4) add zoom overlays to the GTIFF 
    --------------------------------------------------------------*/
    
    let clippedShapesDir = `${__dirname}/clipshapes/${chartworkname}`;

    buildChartNameArray();

    chartareas.forEach((area) => {
        
        console.log(`************** Processing chart: ${area} **************`);
        
        let shapefile = `${clippedShapesDir}/${area}.shp`;
        let normalizedfile = `${dir_2_normalized}/${area}.tif`;
        let expandedfile = `${dir_3_expanded}/${area}.vrt`;
        let clippedfile = `${dir_4_clipped}/${area}.vrt`;
        let warpedfile = `${dir_5_warped}/${area}.vrt`;
        let translatedfile = `${dir_6_translated}/${area}.tif`;
        let tiledir = `${dir_7_tiled}/${area}`;
        
        console.log(`*** Expand color table to RGBA GTiff ***`);
        cmd = `gdal_translate -strict -of vrt -expand rgba ${normalizedfile} ${expandedfile}`;
        executeCommand(cmd);
        
        console.log(`*** Clip border off of virtual image ***`);
        cmd = `gdalwarp -of vrt -multi -cutline "${shapefile}" -crop_to_cutline -cblend 10 -dstalpha -co ALPHA=YES ${expandedfile} ${clippedfile}`; 
        executeCommand(cmd);
    
        console.log(`*** Warp virtual image to EPSG:3857 ***`);
        cmd = `gdalwarp -of vrt -t_srs EPSG:3857 -r lanczos -multi  ${clippedfile} ${warpedfile}`;
        executeCommand(cmd);
        
        console.log(`*** Translate virtual image back to GTiff ***`);
        cmd = `gdal_translate -co TILED=YES -co NUM_THREADS=ALL_CPUS ${warpedfile} ${translatedfile}`;
        executeCommand(cmd);
        
        console.log(`*** Add gdaladdo overviews ***`);
        cmd = `gdaladdo -r average --config GDAL_NUM_THREADS ALL_CPUS ${translatedfile}`;
        executeCommand(cmd); 
        
        console.log(`*** Tile ${area} images in TMS format ***`);
        cmd = `gdal2tiles.py --zoom=${settings.ZoomRange} --processes=4 --tmscompatible --webviewer=openlayers ${translatedfile} ${tiledir}`;
        executeCommand(cmd);
    });
}
    
function mergeTiles() {
    buildChartNameArray();
    chartareas.forEach((area) => {
        let mergesource = `${dir_7_tiled}/${area}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_8_merged}`;
        console.log(`*** Merging ${area} tiles`);
        executeCommand(cmd);
    });
}
    
function quantizePngImages() {
    let interimct = 0;
    let i;
    let cmds = buildCommandArray();

    console.log(`*** Quantizing ${cmds.length} png images at ${settings.TiledImageQuality}%`);

    for (i=0; i < cmds.length; i++) {
        if (interimct === 500) {
            console.log(`  * processed image count = ${i} of ${cmds.length}`);
            interimct = 0;
        }
        interimct++;
        console.log(cmds[i]);
        executeCommand(cmds[i]);
    }
    console.log(`  * Processed image count = ${i} of ${cmds.length}`);
}

function makeMbTiles() {            
    console.log(`  * Making MBTILES database`);
    let zooms = settings.ZoomRange.split("-");
    let minzoom = zooms[0];
    let maxzoom = zooms[0];
    
    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }
    // create a metadata.json file in the root of the tiles directory,
    // mbutil will use this to generate a metadata table in the database.  
    let chtype = charttype.replaceAll("_", " ");
    let metajson = `{ 
        "name": "${chtype}",
        "description": "${chtype} Charts",
        "version": "1.1",
        "type": "${chartlayertype}",
        "format": "png",
        "minzoom": "${minzoom}", 
        "maxzoom": "${maxzoom}", 
        "pngquality": "${settings.TiledImageQuality}"
    }`;
    let fpath = `${dir_8_quantized}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_9_dbtiles}/${chtype}.mbtiles`;   
    let cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_8_quantized} ${mbtiles}`;
    executeCommand(cmd);
}

function buildChartNameArray() {
    let normfiles = fs.readdirSync(dir_2_normalized);
    normfiles.forEach((file) => {
        if (file.endsWith(".tif") && file.search("_FLY") == -1) {
            chartareas.push(file.replace(".tif", ""));
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

function normalizeFileName(file) {
    let newname = "";
    newname = replaceAll(file, " ", "_");
    newname = newname.replace("_SEC", "");
    newname = newname.replace("_TAC", "");
    return newname;
}

function getBestChartDate() {
    let thisdate = new  Date();
    let thistime = thisdate.getTime();
    let cdates = [];
    let found = false;
    let selectedDate = "";
    let datedata = fs.readFileSync(`${__dirname}/chartdates.json`);
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
                console.log(diffdays);
                let m = pad2(dateobj.getMonth()+1); // months (0-11)
                let d = pad2(dateobj.getDate());    // day (1-31)
                let y= dateobj.getFullYear();
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

function executeCommand(command) {
    let retcode = 0;
    try {
        execSync(command, { stdio: 'inherit' }); 
    }
    catch(error) {
        console.error(error)
        retcode = -1
    }
    return retcode;
}

// helper functions
function replaceAll(string, search, replace) {
    return string.split(search).join(replace);
}

function getGdalInfo(file, searchtext) {
    let gdalresults = `${__dirname}/gdal.txt`;

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
