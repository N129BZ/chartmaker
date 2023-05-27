'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Read the settings.json file into a json object
 */
let settings = JSON.parse(fs.readFileSync(`${__dirname}/settings.json`));

/**
 * Get the current chart for the indicated chart type in settings
 */
let chartdate = getBestChartDate();


let cmd = "";
let imageformat = ""; //settings.TileDrivers[settings.TileDriverIndex];
let urltemplate = "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip";
let charttype = ""; //settings.ChartTypes[settings.ChartTypeIndex];
let chartlayertype = ""; //settings.LayerTypes[settings.LayerTypeIndex];
let chartworkname = ""; //charttype.search("Grand_Canyon") != -1 ? "Grand_Canyon" : charttype;
let charturl = ""; //urltemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
let clippedShapeFolder = ""; //`${__dirname}/clipshapes/${chartworkname.toLowerCase()}`;

let workarea             = ""; //`${__dirname}/workarea`;
let chartcache           = ""; //`${__dirname}/chartcache`;
let chartfolder          = ""; //`${workarea}/${chartworkname}`;
let dir_1_unzipped       = ""; //`${chartfolder}/1_unzipped`;
let dir_2_expanded       = ""; //`${chartfolder}/2_expanded`;
let dir_3_clipped        = ""; //`${chartfolder}/3_clipped`;
let dir_4_tiled          = ""; //`${chartfolder}/4_tiled`;
let dir_5_merged         = ""; //`${chartfolder}/5_merged`;
let dir_6_quantized      = ""; //`${chartfolder}/6_quantized`;
let dir_7_mbtiles        = ""; //`${chartfolder}/7_mbtiles`;


let startdate = new Date(new Date().toLocaleString());
console.log(`Started processing: ${startdate}\r\n`);

/**
 * All chart processing begins here
 */
settings.ChartTypes.forEach((chtype) => {
    charttype = chtype;
    chartlayertype = settings.LayerTypes[settings.LayerTypeIndex];
    chartworkname = charttype.search("Grand_Canyon") != -1 ? "Grand_Canyon" : charttype;
    charturl = urltemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
    clippedShapeFolder = `${__dirname}/clipshapes/${chartworkname.toLowerCase()}`;
    chartcache = `${__dirname}/chartcache`;

    if (!fs.existsSync(`${chartcache}/.clipshapes_${charttype}`)) {
        normalizeClipNames();
        cmd = `touch ${chartcache}/.clipshapes_${charttype}`;
        executeCommand(cmd);
    }

    workarea             = `${__dirname}/workarea`;
    chartcache           = `${__dirname}/chartcache`;
    chartfolder          = `${workarea}/${chartworkname}`;
    dir_1_unzipped       = `${chartfolder}/1_unzipped`;
    dir_2_expanded       = `${chartfolder}/2_expanded`;
    dir_3_clipped        = `${chartfolder}/3_clipped`;
    dir_4_tiled          = `${chartfolder}/4_tiled`;
    dir_5_merged         = `${chartfolder}/5_merged`;
    dir_6_quantized      = `${chartfolder}/6_quantized`;
    dir_7_mbtiles        = `${chartfolder}/7_mbtiles`;

    makeWorkingFolders();
    downloadCharts();
    unzipCharts();
    normalizeChartNames();
    processImages();
    mergeTiles();
    makeMbTiles();
    reportProcessingTime();
});

return;

/**
 * Make sure all clipping files are lower-case
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
    catch(err) {
        console.log(err.message);
    }
}

/**
 * Generate all of the working folders for image processing
 */
function makeWorkingFolders() {
    console.log("Creating working area folders");
    if (!fs.existsSync(workarea)) fs.mkdirSync(workarea);
    if (!fs.existsSync(chartfolder)) fs.mkdirSync(chartfolder);
    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped);
    if (!fs.existsSync(dir_2_expanded)) fs.mkdirSync(dir_2_expanded);
    if (!fs.existsSync(dir_3_clipped)) fs.mkdirSync(dir_3_clipped);
    if (!fs.existsSync(dir_4_tiled)) fs.mkdirSync(dir_4_tiled);
    if (!fs.existsSync(dir_5_merged)) fs.mkdirSync(dir_5_merged);
    if (!fs.existsSync(dir_6_quantized)) fs.mkdirSync(dir_6_quantized);
    if (!fs.existsSync(dir_7_mbtiles)) fs.mkdirSync(dir_7_mbtiles);
}

/**
 * Get the desired chart zip file from the FAA's digital sources URL
 */
function downloadCharts() {
    let chartzip = `${chartcache}/${chartworkname}-${chartdate}.zip`;
    if (!fs.existsSync(chartzip)) {
        console.log(`Downloading ${chartzip}`);
        cmd = `wget ${charturl} --output-document=${chartzip}`;
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
}

/** 
 * Clean up chart tif names by converting spaces and dashes to underscores
 */
function normalizeChartNames() {
    let tifname = "";
    let tfwname = "";
    let files = fs.readdirSync(dir_1_unzipped);
    
    files.forEach((file) => {
        let fname = file.toLowerCase();
        if ((fname.endsWith(".tif")) && 
            (fname.search("fly") == -1) && 
            (fname.search("planning") == -1)) {
           
            let tfwfile = file.replace(".tif", ".tfw");
            let basename = normalizeFileName(fname).replace("_tac", "").replace(".tif", "");

            tifname = `${dir_1_unzipped}/${basename}.tif`;
            tfwname = `${dir_1_unzipped}/${basename}.tfw`;
            
            fs.renameSync(`${dir_1_unzipped}/${file}`, tifname);
            fs.renameSync(`${dir_1_unzipped}/${tfwfile}`, tfwname);   
            
            if (basename.search("Grand_Canyon") > -1) {
                if (basename != charttype) {
                    fs.rmSync(tifname);
                    fs.rmSync(tfwname);
                }
            }
        }
    });
}

/**
 * Perform GDAL operations on all the unzipped charts 
 */
function processImages(){
    /*-----------------------------------------------------------------------
     1) GDAL_TRANSLATE: Expand color table to RGBA
     2) GDALWARP: Warp chart to EPSG:4326 and clip off the borders and legend
     3) GDALADDO: Generate overviews of the VRT for all zoom levels 
     4) GDAL2TILES: Convert overviews into tiled PNG images
    -------------------------------------------------------------------------*/
    
    let chartareas = buildChartNameArray();

    chartareas.forEach((area) => {
        
        console.log(`\r\n************** Processing chart: ${area} **************`);
        
        let shapefile = `${clippedShapeFolder}/${area}.shp`;
        let sourcetif = `${dir_1_unzipped}/${area}.tif`;
        let expanded = `${dir_2_expanded}/${area}.vrt`;
        let clipped = `${dir_3_clipped}/${area}.vrt`;
        let tiled = `${dir_4_tiled}/${area}` 

        console.log(`* Expand ${area} to RGBA`);
        cmd = `gdal_translate -strict -of vrt -co TILED=YES -expand rgba ${sourcetif} ${expanded}`;
        executeCommand(cmd);

        console.log(`* Clip off border & legend`);
        cmd = `gdalwarp -t_srs EPSG:4326 -dstalpha -cblend 6 -cutline "${shapefile}" -crop_to_cutline ${expanded} ${clipped}`; 
        executeCommand(cmd);
    
        console.log(`* Add overviews for each zoom level`);
        cmd = `gdaladdo --config GDAL_NUM_THREADS ALL_CPUS ${clipped}`;
        executeCommand(cmd); 

        let formatargs = "--tiledriver=PNG"; 
        if (imageformat == "webp") {
            formatargs = `--tiledriver=WEBP --webp-quality=${settings.TiledImageQuality}`
        }
        console.log(`* Generate ${area} tile images`);
        cmd = `gdal2tiles.py --zoom=${settings.ZoomRange} --processes=4 ${formatargs} --tmscompatible --webviewer=leaflet ${clipped} ${tiled}`;
        executeCommand(cmd);

    });
}

/**
 * Merge all of the individual chart zoom folders into a single master chart folder 
 */
function mergeTiles() {
    let areas = fs.readdirSync(dir_4_tiled);
    areas.forEach((area) => {
        let mergesource = `${dir_4_tiled}/${area}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_5_merged}`;
        executeCommand(cmd);

        if (settings.CleanMergeFolder) {
            cmd = `rm -r -f ${mergesource}`;
            executeCommand(cmd);
        }
    });

    // Only quantize png images, webp images are quantized via tiling option...
    if (imageformat == "png") {
        quantizePngImages();
    } 
}

/**
 * Perform quantization of all .png images if that was the processed image type
 */
function quantizePngImages() {
    let interimct = 0;
    let i;
    let qcmd = "";
    let cmds = buildQuantizingCommandArray();
    let quantcmd = `pngquant --quality ${settings.TiledImageQuality}`; 
    console.log(`*** Quantizing ${cmds.length} png images at ${settings.TiledImageQuality}%`);

    for (i=0; i < cmds.length; i++) {
        qcmd = `${quantcmd} ${cmds[i][0]} --output ${cmds[i][1]}`;
        try {    
            execSync(qcmd, { stdio: 'inherit' }); 
        }
        catch(error) { 
            // if there is a error quantizing, just copy the original image
            let file0 = cmds[i][0];
            let file1 = cmds[i][1];
            qcmd = `cp -f ${file0} ${file1}`;
            executeCommand(qcmd);
        }
        interimct ++;
        if (interimct >= 1000){
            console.log(`${i + 1} of ${cmds.length} images processed`);
            interimct = 0;
        }
    }
    console.log(`  * Total processed image count = ${cmds.length}`);
}

/**
 * Create the .mbtiles chart database 
 */
function makeMbTiles() {            
    console.log(`  * Making MBTILES database`);
    let zooms = settings.ZoomRange.split("-");
    let minzoom = zooms[0];
    let maxzoom = zooms[0];
    let sourcefolder = imageformat == "webp" ? dir_5_merged : dir_6_quantized;

    if (zooms.length === 2) {
        maxzoom = zooms[1];
    }
    // create a metadata.json file in the root of the tile directory,
    // mbutil will use this to generate a metadata table in the database.  
    let chtype = charttype.replaceAll("_", " ");
    let metajson = `{ 
        "name": "${chtype}",
        "description": "${chtype} Charts",
        "version": "1.1",
        "type": "${chartlayertype}",
        "format": "${imageformat}",
        "quality": ${settings.TiledImageQuality},
        "minzoom": "${minzoom}", 
        "maxzoom": "${maxzoom}"
    }`;
    let fpath = `${sourcefolder}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_7_mbtiles}/${chtype}.mbtiles`;   
    cmd = `python3 ./mbutil/mb-util --image_format=${imageformat} --scheme=tms ${sourcefolder} ${mbtiles}`;
    executeCommand(cmd);

    cmd = `ls -l ${mbtiles}`;
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
        let fname = file.toLowerCase();
        if ((fname.endsWith(".tif")) && 
            (fname.search("fly") == -1) && 
            (fname.search("planning")== -1)) {
            chartnames.push(fname.replace(".tif", ""));
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
    let newname = replaceAll(file, " ", "_");
    newname = newname.replace("-", "_").replace("_sec", "").toLowerCase();
    return newname;
}

/**
 * Iterate through the chartdates.json file that contains chart publication dates
 * @returns the closest date of currently available FAA published charts 
 */
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

/**
 * Execute the passed in command and return success or failure code
 * @param {string} command 
 * @returns the return code of a processing command
 */
function executeCommand(command) {
    let retcode = 0;
    let retry = false;
    
    try {
        execSync(command, { stdio: 'inherit' }); 
    }
    catch(error) {
        retry = true;
    }

    if (retry) {
        try {
            execSync(command, {stdio: 'inherit'});
        }
        catch(error) {
            console.log(error.message);
            retcode = -1
        }
    }
    
    return retcode;
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
    console.log(`\r\nStart time: ${startdate}\r\nEnd time: ${date2}\r\nTotal processing time: ${hh}:${mm}:${ss}`);
}

/**
 * Replace 1-n instances of the search string with the replace string and return array of substrings
 * @param {string} original 
 * @param {string} search 
 * @param {string} replace 
 * @returns array of substrings
 */
function replaceAll(original, search, replace) {
    return original.split(search).join(replace);
}

/**
 * Utility to scan a tif and return the desired information 
 * @param {string} file 
 * @param {string} searchtext 
 * @returns 
 */
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

/**
 * Utility to left-pad zeros for numbers under 10
 * @param {string} n 
 * @returns left zero padded numeric string 
 */
function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}
