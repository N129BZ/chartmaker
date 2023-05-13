'use strict';

const fs = require('fs');
const { execSync } = require('child_process');


let settings = JSON.parse(fs.readFileSync(`${__dirname}/settings.json`));
let chartdate = getBestChartDate();

let cmd = "";
let urltemplate = "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip";
let charttype = settings.ChartTypes[settings.ChartTypeIndex];
let chartlayertype = settings.LayerTypes[settings.LayerTypeIndex];
let chartworkname = charttype.search("Grand_Canyon") !== -1 ? "Grand_Canyon" : charttype;
let charturl = urltemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);

let workarea             = `${__dirname}/workarea`;
let chartfolder          = `${workarea}/${chartworkname}`;
let dir_0_download       = `${chartfolder}/0_download`;
let dir_1_unzipped       = `${chartfolder}/1_unzipped`;
let dir_2_expanded       = `${chartfolder}/3_expanded`;
let dir_3_clipped        = `${chartfolder}/4_clipped`;
let dir_4_tiled          = `${chartfolder}/5_tiled`;
let dir_5_merged         = `${chartfolder}/6_merged`;
let dir_6_quantized      = `${chartfolder}/7_quantized`;
let dir_7_mbtiles        = `${chartfolder}/8_mbtiles`;


makeWorkingFolders();
//downloadCharts();
unzipCharts();
normalizeChartNames();
processImages();
mergeTiles();
quantizePngImages();
makeMbTiles();

function normalizeClipFiles(chartType) {
    let clippedShapesDir = `${__dirname}/clipshapes/${chartType}`;
    let clips = fs.readdirSync(clippedShapesDir);
    let cmd = "";
    clips.forEach((clip) => {
        let newname = clip.replace("_SEC", "").replace("-", "_").toLowerCase();
        let cmd = `mv ${clippedShapesDir}/${clip} ${clippedShapesDir}/${newname}`;
        executeCommand(cmd);
    });
}

function makeWorkingFolders() {
    console.log("Creating working area folders");
    if (!fs.existsSync(workarea)) fs.mkdirSync(workarea);
    if (!fs.existsSync(chartfolder)) fs.mkdirSync(chartfolder);
    if (!fs.existsSync(dir_0_download)) fs.mkdirSync(dir_0_download);
    if (!fs.existsSync(dir_1_unzipped)) fs.mkdirSync(dir_1_unzipped);
    if (!fs.existsSync(dir_2_expanded)) fs.mkdirSync(dir_2_expanded);
    if (!fs.existsSync(dir_3_clipped)) fs.mkdirSync(dir_3_clipped);
    if (!fs.existsSync(dir_4_tiled)) fs.mkdirSync(dir_4_tiled);
    if (!fs.existsSync(dir_5_merged)) fs.mkdirSync(dir_5_merged);
    if (!fs.existsSync(dir_6_quantized)) fs.mkdirSync(dir_6_quantized);
    if (!fs.existsSync(dir_7_mbtiles)) fs.mkdirSync(dir_7_mbtiles);
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
            
            let tfwfile = file.replace(".tif", ".tfw");
            let basename = normalizeFileName(file).replace(".tif", "");

            tifname = `${dir_1_unzipped}/${basename}.tif`;
            tfwname = `${dir_1_unzipped}/${basename}.tfw`;
            
            fs.renameSync(`${dir_1_unzipped}/${file}`, tifname);
            fs.renameSync(`${dir_1_unzipped}/${tfwfile}`, tfwname);   
            
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
    /*--------------------------------------------------------------------------------------------------
     1) GDALWARP: Warp all area charts to EPSG:3857 (mercator) from EPSG:9802 (lambert conformal conic), 
                  clip off the borders and legend and make output pixels square
     2) GDAL_TRANSLATE: Expand the GTiff color table to RGBA and ouput a VRT file
     3) GDALADDO: Generate overviews of the VRT for all zoom levels 
     4) GDAL2TILES: Convert overviews into tiled PNG images
    ----------------------------------------------------------------------------------------------------*/
    
    let clippedShapesDir = `${__dirname}/clipshapes/${chartworkname.toLowerCase()}`;

    let chartareas = buildChartNameArray();

    chartareas.forEach((area) => {
        
        console.log(`************** Processing chart: ${area} **************`);
        
        let shapefile = `${clippedShapesDir}/${area}.shp`;
        let rawtiffile = `${dir_1_unzipped}/${area}.tif`;
        let expandedfile = `${dir_2_expanded}/${area}.vrt`;
        let clippedfile = `${dir_3_clipped}/${area}.vrt`;
        let tiledir = `${dir_4_tiled}/${area}` 

        console.log(`*** Expand color table to RGBA GTiff ***`);
        cmd = `gdal_translate -strict -of vrt -co TILED=YES -expand rgba ${rawtiffile} ${expandedfile}`;
        executeCommand(cmd);
        
        console.log(`*** Clip border off of virtual image ***`);
        cmd = `gdalwarp -of vrt -t_srs EPSG:3857 -multi -cutline "${shapefile}" -crop_to_cutline -cblend 10 -dstalpha -co ALPHA=YES ${expandedfile} ${clippedfile}`; 
        executeCommand(cmd);
    
        console.log(`*** Add gdaladdo overviews ***`);
        cmd = `gdaladdo -r average --config GDAL_NUM_THREADS ALL_CPUS ${clippedfile}`;
        executeCommand(cmd); 
        
        console.log(`*** Tile ${area} images in TMS format ***`);
        cmd = `gdal2tiles.py --zoom=${settings.ZoomRange} --processes=4 --tmscompatible --webviewer=leaflet ${clippedfile} ${tiledir}`;
        executeCommand(cmd);

        console.log(`*** Remove virtual processing vrt files ***`);
        cmd = `rm -r -f ${clippedfile}`;
        executeCommand(cmd);
        cmd = `rm -r -f ${expandedfile}*`;
        executeCommand(cmd);
    });
}

function mergeTiles() {
    let areas = fs.readdirSync(dir_4_tiled);
    areas.forEach((area) => {
        let mergesource = `${dir_4_tiled}/${area}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_5_merged}`;

        console.log(`*** Merging ${area} tiles`);
        executeCommand(cmd);

        console.log('*** Removing tile files (no longer needed) ***')
        cmd = `rm -r -f ${mergesource}`;
        executeCommand(cmd);
    });
}
    
function quantizePngImages() {
    let interimct = 0;
    let i;
    let cmds = buildCommandArray();

    console.log(`*** Quantizing ${cmds.length} png images at ${settings.TiledImageQuality}%`);

    for (i=0; i < cmds.length; i++) {
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
    let fpath = `${dir_6_quantized}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_7_mbtiles}/${chtype}.mbtiles`;   
    let cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_6_quantized} ${mbtiles}`;
    executeCommand(cmd);
}

function buildChartNameArray() {
    let normfiles = fs.readdirSync(dir_2_normalized);
    let chartnames = [];
    normfiles.forEach((file) => {
        if (file.endsWith(".tif") && file.search("_FLY") == -1) {
            chartnames.push(file.replace(".tif", ""));
        }
    });
    return chartnames;
}

function buildCommandArray() {
    let mergedfolders = fs.readdirSync(dir_5_merged);
    let cmdarray = [];

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
                    cmd = `pngquant --quality ${settings.TiledImageQuality} ${imgpath} --output ${outpath}`;
                    cmdarray.push(cmd);
                });
            });
        }
    });
    return cmdarray;
}

function normalizeFileName(file) {
    let newname = replaceAll(file, " ", "_");
    newname = newname.replace("-", "_").replace("_SEC", "").replace("_TAC", "").toLowerCase();
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
