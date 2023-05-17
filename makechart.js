'use strict';

const fs = require('fs');
const { execSync } = require('child_process');


let settings = JSON.parse(fs.readFileSync(`${__dirname}/settings.json`));
let chartdate = getBestChartDate();

let cmd = "";
let urltemplate = "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip";
let charttype = settings.ChartTypes[settings.ChartTypeIndex];
let chartlayertype = settings.LayerTypes[settings.LayerTypeIndex];
let chartworkname = charttype.search("Grand_Canyon") != -1 ? "Grand_Canyon" : charttype;
let charturl = urltemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);

let workarea             = `${__dirname}/workarea`;
let chartfolder          = `${workarea}/${chartworkname}`;
let dir_0_download       = `${chartfolder}/0_download`;
let dir_1_unzipped       = `${chartfolder}/1_unzipped`;
let dir_2_clipped        = `${chartfolder}/2_clipped`;
let dir_3_tiled          = `${chartfolder}/3_tiled`;
let dir_4_merged         = `${chartfolder}/4_merged`;
let dir_5_quantized      = `${chartfolder}/5_quantized`;
let dir_6_mbtiles        = `${chartfolder}/6_mbtiles`;


makeWorkingFolders();
/***********************/
downloadCharts();
unzipCharts();
normalizeChartNames();
preprocessImages();
/***********************/
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
    if (!fs.existsSync(dir_2_clipped)) fs.mkdirSync(dir_2_clipped);
    if (!fs.existsSync(dir_3_tiled)) fs.mkdirSync(dir_3_tiled);
    if (!fs.existsSync(dir_4_merged)) fs.mkdirSync(dir_4_merged);
    if (!fs.existsSync(dir_5_quantized)) fs.mkdirSync(dir_5_quantized);
    if (!fs.existsSync(dir_6_mbtiles)) fs.mkdirSync(dir_6_mbtiles);
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
        let fname = file.toLowerCase();
        if (fname.endsWith(".tif") && fname.search("fly") == -1 && fname.search("vfr_planning") == -1) {
           
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

function preprocessImages() {
    let chartareas = buildChartNameArray();
    chartareas.forEach((area) => {
        let rawtif = `${dir_1_unzipped}/${area}.tif`;
        let expanded = `${dir_1_unzipped}/${area}_tmp.tif`;
        //let warped = `${dir_3_warped}/${area}.tif`
        
        console.log(`* Expand ${area} to RGBA`);
        cmd = `gdal_translate -strict -co TILED=YES -expand rgba ${rawtif} ${expanded}`;
        executeCommand(cmd);
        
        cmd = `mv -f ${expanded} ${rawtif}`; 
        executeCommand(cmd);
    });
}

function processImages(){
    /*-----------------------------------------------------------------------
     1) GDAL_TRANSLATE: Expand color table to RGBA
     2) GDALWARP: Warp chart to EPSG:4326 and clip off the borders and legend
     3) GDALADDO: Generate overviews of the VRT for all zoom levels 
     4) GDAL2TILES: Convert overviews into tiled PNG images
    -------------------------------------------------------------------------*/
    
    let clippedShapesDir = `${__dirname}/clipshapes/${chartworkname.toLowerCase()}`;

    let chartareas = buildChartNameArray();

    chartareas.forEach((area) => {
        
        console.log(`\r\n************** Processing chart: ${area} **************`);
        
        let shapefile = `${clippedShapesDir}/${area}.shp`;
        let sourcetif = `${dir_1_unzipped}/${area}.tif`;
        let clipped = `${dir_2_clipped}/${area}.vrt`;
        let tiled = `${dir_3_tiled}/${area}` 

        console.log(`* Clip off border & legend`);
        cmd = `gdalwarp -t_srs EPSG:4326 -nosrcalpha -dstalpha -cblend 6 -cutline "${shapefile}" -crop_to_cutline ${sourcetif} ${clipped}`; 
        executeCommand(cmd);
    
        console.log(`* Add overviews for each zoom level`);
        cmd = `gdaladdo --config GDAL_NUM_THREADS ALL_CPUS ${clipped}`;
        executeCommand(cmd); 
        
        console.log(`* Generate ${area} tile images`);
        cmd = `gdal2tiles.py --zoom=${settings.ZoomRange} --processes=4 --tmscompatible --webviewer=leaflet ${clipped} ${tiled}`;
        executeCommand(cmd);

        console.log(`* Remove virtual processing vrt file`);
        cmd = `rm -r -f ${clipped}`;
        executeCommand(cmd);
    });
}

function mergeTiles() {
    let areas = fs.readdirSync(dir_3_tiled);
    areas.forEach((area) => {
        let mergesource = `${dir_3_tiled}/${area}`;
        let cmd = `perl ./mergetiles.pl ${mergesource} ${dir_4_merged}`;
        executeCommand(cmd);
        cmd = `rm -r -f ${mergesource}`;
        executeCommand(cmd);
    });
}

function postProcessing() {

}

function quantizePngImages() {
    let interimct = 0;
    let i;
    let qcmd = "";
    let cmds = buildCommandArray();
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
    let fpath = `${dir_5_quantized}/metadata.json`; 
    let fd = fs.openSync(fpath, 'w');
    fs.writeSync(fd, metajson);
    fs.closeSync(fd);

    let mbtiles = `${dir_6_mbtiles}/${chtype}.mbtiles`;   
    cmd = `python3 ./mbutil/mb-util --scheme=tms ${dir_5_quantized} ${mbtiles}`;
    executeCommand(cmd);

    cmd = `ls -l ${mbtiles}`;
    executeCommand(cmd);
}

function buildChartNameArray() {
    let files = fs.readdirSync(dir_1_unzipped);
    let chartnames = [];
    files.forEach((file) => {
        let fname = file.toLowerCase();
        if (fname.endsWith(".tif") && fname.search("_fly") == -1 && fname.search("vfr_planning")== -1) {
            chartnames.push(fname.replace(".tif", ""));
        }
    });
    return chartnames;
}

function buildCommandArray() {
    let mergedfolders = fs.readdirSync(dir_4_merged);
    let cmdarray = [];
    let subarray = [];
    mergedfolders.forEach((zoomlevel) => {
        let zoomfolder = `${dir_4_merged}/${zoomlevel}`;
        if (fs.statSync(zoomfolder).isDirectory()) {    
            let quantzoomfolder = `${dir_5_quantized}/${zoomlevel}`;
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

function normalizeFileName(file) {
    let newname = replaceAll(file, " ", "_");
    newname = newname.replace("-", "_").replace("_SEC", "").toLowerCase();
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
