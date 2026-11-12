
import fs from 'node:fs';
import http from 'node:http';
import { exec, execSync, spawn } from 'node:child_process';
import readlineSync from 'readline-sync';
import path from 'node:path';
import express from 'express';
import { cwd } from 'node:process';
import { WebSocketServer } from 'ws';

class AppMessage {
    static mtInfo = "info";
    static mtTiming = "timing";
    static mtCommandResponse = "commandresponse";
    static mtRunning = "running";
    static mtComplete = "complete";
    static mtCommand = "command";
    static mtSettings = "settings";
    static mtDownload = "download";
    static mtConnection = "connection";
    static mtCommandPackage = "commandpackage";
    static mtExistingDb = "existingdb";
    static mtSyncState = "syncstate";

    constructor(msgtype) {
        this.type = msgtype;
        this.css = [];
        this.payload = "";
        this.rowindex = -1;
        this.completed = false;
        this.items = [];
        this.filename = "";
        this.getexisting = false;
        this.dbfilename = "";
        this.uid = "";
    }
}

class MakeCommand {
    constructor(command, chart, rowindex, chartname, layertype) {
        this.command = command;
        this.chart = chart;
        this.rowindex = rowindex;
        this.chartname = chartname;
        this.layertype = layertype;
    }
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        try {
            list[name] = decodeURIComponent(value);
        } catch {
            list[name] = value;
        }
    });
    return list;
}

class ProcessTime {
    constructor(processName) {
        this.processname = processName.replaceAll("_", " ");
        this.startdate = new Date(new Date().toLocaleString());
        this.totaltime = "";
        this.logtime = "";
    }

    calculateProcessTime() {
        let pt = ProcessTime.reportProcessingTime(this.startdate);
        this.totaltime = `time: ${pt}`;
    }

    static reportProcessingTime(startdate) {
        let date2 = new Date(new Date().toLocaleString());
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

        let phh = pad2(hh);
        let pmm = pad2(mm);
        let pss = pad2(ss);
        let ttime = `${phh}:${pmm}:${pss}`;
        logEntry(`Start time: ${startdate}, End time: ${date2}, Total time: ${ttime}`);
        return ttime;
    }
};

class ChartTaskContext {
    constructor(workarea, chartworkname, chartname, charturl, clippedShapeFolder, isifrchart = false, signal = null) {
        this.chartworkname = chartworkname;
        this.chartname = chartname;
        this.charturl = charturl;
        this.clippedShapeFolder = clippedShapeFolder;
        this.isifrchart = isifrchart;
        this.metadataDescription = chartname.replaceAll("_", " ");
        this.chartfolder = path.join(workarea, chartname);
        this.dir_1_unzipped = path.join(this.chartfolder, "1_unzipped");
        this.dir_2_expanded = path.join(this.chartfolder, "2_expanded");
        this.dir_3_clipped = path.join(this.chartfolder, "3_clipped");
        this.dir_4_mbtiles = path.join(this.chartfolder, "4_mbtiles");
        this.signal = signal;
    }
}

class JobQueue {
    constructor() {
        this.queue = [];
        this.currentJob = null;
        this.currentChart = "";
        this.currentContext = null;
        this.userJobs = new Map();
    }

    get isBusy() {
        return this.currentJob !== null;
    }

    enqueue(message) {
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const abortController = new AbortController();
        const job = {
            jobId,
            uid: message.uid || "",
            commandlist: message.commandlist || [],
            message,
            status: "queued",
            cancelled: false,
            abortController,
            createdAt: new Date(),
            startedAt: null,
            completedAt: null,
            timings: new Map(),
            completedItems: [],
            currentChart: "",
            currentRowIndex: -1,
            totalTime: ""
        };

        if (job.uid) {
            this.userJobs.set(job.uid, job);
        }

        this.queue.push(job);
        const position = this.queue.length;
        const wasBusy = this.isBusy;

        if (wasBusy) {
            let msg = new AppMessage(AppMessage.mtCommandResponse);
            msg.uid = job.uid;
            msg.payload = "queued";
            msg.items = [{ jobId, position }];
            sendMessageToClients(msg, job.uid);
        } else {
            this.processNext();
        }

        return {
            status: wasBusy ? "queued" : "accepted",
            jobId,
            position: wasBusy ? position : 0
        };
    }

    cancelJob(uid, jobId = null) {
        if (!uid && !jobId) return { cancelled: false, error: "No user or job specified" };

        // 1. Check if waiting in queue
        const qIndex = this.queue.findIndex(j => (jobId && j.jobId === jobId) || (uid && j.uid === uid));
        if (qIndex !== -1) {
            const [cancelledJob] = this.queue.splice(qIndex, 1);
            cancelledJob.cancelled = true;
            cancelledJob.status = "cancelled";
            this.notifyWaitingClients();
            if (this.userJobs.has(cancelledJob.uid)) {
                this.userJobs.delete(cancelledJob.uid);
            }
            let msg = new AppMessage(AppMessage.mtCommandResponse);
            msg.uid = cancelledJob.uid;
            msg.payload = "cancelled";
            sendMessageToClients(msg, cancelledJob.uid);
            console.log(`Cancelled queued job ${cancelledJob.jobId} for uid: ${cancelledJob.uid}`);
            return { cancelled: true, wasRunning: false, jobId: cancelledJob.jobId };
        }

        // 2. Check if currently running
        if (this.currentJob && ((jobId && this.currentJob.jobId === jobId) || (uid && this.currentJob.uid === uid))) {
            const runningJob = this.currentJob;
            runningJob.cancelled = true;
            runningJob.status = "cancelled";
            console.log(`Aborting running job ${runningJob.jobId} for uid: ${runningJob.uid}...`);
            try {
                runningJob.abortController.abort();
            } catch (err) {
                console.error("Error calling abort on running job:", err);
            }
            if (this.currentContext && this.currentContext.chartfolder) {
                try {
                    if (fs.existsSync(this.currentContext.chartfolder)) {
                        fs.rmSync(this.currentContext.chartfolder, { recursive: true, force: true });
                    }
                } catch (e) {
                    console.error("Error cleaning up aborted chart folder:", e);
                }
            }
            let msg = new AppMessage(AppMessage.mtCommandResponse);
            msg.uid = runningJob.uid;
            msg.payload = "cancelled";
            sendMessageToClients(msg, runningJob.uid);
            if (this.userJobs.has(runningJob.uid)) {
                this.userJobs.delete(runningJob.uid);
            }
            return { cancelled: true, wasRunning: true, jobId: runningJob.jobId };
        }

        return { cancelled: false, error: "Job not found" };
    }

    notifyWaitingClients() {
        this.queue.forEach((queuedJob, index) => {
            const position = index + 1;
            let msg = new AppMessage(AppMessage.mtCommandResponse);
            msg.uid = queuedJob.uid;
            msg.payload = "queued";
            msg.items = [{ jobId: queuedJob.jobId, position }];
            sendMessageToClients(msg, queuedJob.uid);
        });
    }

    async processNext() {
        if (this.currentJob !== null || this.queue.length === 0) {
            return;
        }

        const job = this.queue.shift();
        this.currentJob = job;
        inMakeLoop = true;
        job.status = "running";
        job.startedAt = new Date();
        if (job.uid) {
            this.userJobs.set(job.uid, job);
        }
        this.notifyWaitingClients();

        try {
            await executeMakeJob(job);
            if (!job.cancelled) {
                job.status = "completed";
            }
        } catch (err) {
            if (job.cancelled || err.name === 'AbortError') {
                job.status = "cancelled";
                console.log(`Job ${job.jobId} terminated due to cancellation.`);
            } else {
                job.status = "failed";
                console.error(`Error executing job ${job.jobId}:`, err);
            }
        } finally {
            this.currentJob = null;
            this.currentChart = "";
            this.currentContext = null;
            inMakeLoop = this.queue.length > 0;
            if (this.queue.length > 0) {
                this.processNext();
            }
        }
    }

    getStatus() {
        return {
            running: this.isBusy,
            chartdate: chartdate,
            currentChart: this.currentChart || chartname || "",
            currentJobId: this.currentJob ? this.currentJob.jobId : null,
            queueLength: this.queue.length
        };
    }

    getUserJobState(uid) {
        if (!uid) return null;
        const job = this.userJobs.get(uid);
        if (!job) return null;

        let position = 0;
        if (job.status === "queued") {
            const idx = this.queue.findIndex(q => q.jobId === job.jobId);
            position = idx !== -1 ? idx + 1 : 1;
        }

        return {
            jobId: job.jobId,
            uid: job.uid,
            status: job.status,
            position,
            commandlist: job.commandlist,
            completedItems: job.completedItems,
            currentChart: job.currentChart,
            currentRowIndex: job.currentRowIndex,
            totalTime: job.totalTime,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt
        };
    }

    clearUserJob(uid) {
        if (!uid) return;
        const job = this.userJobs.get(uid);
        if (job && (job.status === "completed" || job.status === "failed")) {
            this.userJobs.delete(uid);
        }
    }
}

const jobQueue = new JobQueue();

// create websocket variables
const connections = new Map();
let inMakeLoop = false;
let pingSenderId = 0;

// set the base application folder, this will change if running in docker
let appdir = cwd();

/**
 * Utility to see if we are in a docker container
 * @returns boolean
 */
let isdocker = isRunningInDocker();
function isRunningInDocker() {
    let indocker = false;
    try {
        let r = execSync(`cat /proc/1/cgroup`, {encoding: "utf8"});
        indocker = (r.search("/docker/") > -1);
    }
    catch {}
    if (!indocker) {
        indocker = fs.existsSync("/.dockerenv") || process.env.DOCKER === "true";
    }
    if (indocker) {
        console.log("Running in docker!");
        appdir = "/chartmaker";
    }
    return indocker;
}

/**
 * Handle all prompting for input
 */
function processPrompt(message) {
    return readlineSync.question(message); 
}

let settingspath = path.join(appdir, "settings.json");
if (isdocker) {
    const externalConfigDir = path.join(appdir, "config");
    const externalSettingsPath = path.join(externalConfigDir, "settings.json");
    if (!fs.existsSync(externalConfigDir)) {
        fs.mkdirSync(externalConfigDir, { recursive: true });
    }
    if (!fs.existsSync(externalSettingsPath)) {
        fs.copyFileSync(settingspath, externalSettingsPath);
    }
    settingspath = externalSettingsPath;
}
const settings = JSON.parse(fs.readFileSync(settingspath, "utf-8")).settings;
const useWebServer = settings.webservermode;
let timings = new Map();

/** 
 *  Set the time zone of this process to the value in settings if it exists.
 *  See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones for
 *  for an exhaustive list of valid timezone string values. 
 */ 
if (settings.timezone != "") {
    process.env.TZ = settings.timezone; 
}

/**
 * Get the number of available processes
 * @returns integer
 */
function getProcessCount() {
    let pc = 4; // default
    try {
        let r = execSync(`grep -c "^processor" /proc/cpuinfo`, { encoding: 'utf8'});
        pc = Number(r.replace('\n', ""));
        logEntry(`Processor count = ${pc}`)
    }
    catch {}
    return pc;
}

// logging
let logfd = 0;
const setupDebugLog = function(logfolder) {
    if (settings.logtofile) {
        logfd = fs.openSync(path.join(logfolder, "debug.log"), 'w', 0o666);
    }
}

const logEntry = function(entry) {
    if (settings.logtofile) {
        fs.writeSync(logfd, `${entry}\n`)
    }
    else {
        console.log(entry);
    }
}

function pad2(n) {
    let nn = `${n}`;
    if (n < 10) {
        nn = `0${nn}`;
    }
    return nn;
}

// Get the current chart date from the chartdates.json file
let expiredate = "";
const chartdate = getBestChartDate();
const users = JSON.parse(fs.readFileSync(path.join(appdir, "users.json"), "utf-8")).users;
const zipfilename = settings.zipfilename;


// used for process timing
const startdate = new Date(new Date().toLocaleString());

// make sure these base level folders exist
let workarea = path.join(appdir, "workarea");
if (settings.renameworkarea) workarea += `_${chartdate}`;
if (!fs.existsSync(workarea)) fs.mkdirSync(workarea)

let chartcache = path.join(appdir, "chartcache");
if (!fs.existsSync(chartcache)) fs.mkdirSync(chartcache);

let dbfolder = path.join(appdir, "mbtiles");
if (!fs.existsSync(dbfolder)) fs.mkdirSync(dbfolder, { recursive: true });

let imageformat = settings.tiledrivers[settings.tiledriverindex];
let chartworkname = "";
let chartname = "";
let charturl = "";
let clippedShapeFolder = "";
let cmd = "";
let chartfolder = "";
let dir_1_unzipped = "";
let dir_2_expanded = "";
let dir_3_clipped = "";
let dir_4_mbtiles = "";
let isifrchart = false;
let metadataDescription = "";

/**
 * Chart processing starts here
 */
let parray = [];
let nm = 0;

const processes = getProcessCount();
const arg = process.argv.slice(2);

if (useWebServer === false) {
    if (arg.length >= 1) {
        let chart = "";
        let sarg = arg[0].toLowerCase();
        if (sarg.startsWith("-s")) {
            // output settings.json
            
            console.log("\r\n\r\n----------------------------------------------------------------------------------\r\n" +
                        "Settings.json\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
            console.log(settings);
            console.log("\r\n\r\n\r\n");
            process.exit();
        }
        else if (sarg.startsWith("-h")) {
            console.log("Command line options:\r\n" +
                        "----------------------------------------------------------------------------------\r\n" +
                        "-h, --help         Show this help\r\n" +
                        "-s, --settings     Show all values in settings.json\r\n" +
                        "-w, --webserver    Start the web server\r\n" +
                        "----------------------------------------------------------------------------------\r\n" +
                        "area-single=X   Process one area chart where X is the index in the area chart list\r\n" +
                        "area-all        Process all 53 area VFR charts individually\r\n" +
                        "full-single=X   Process one full chart where X is an index in the full chart list\r\n" +
                        "full-all        Process all of the full charts in the full chart list\r\n" +
                        "----------------------------------------------------------------------------------\r\n");
                        process.exit();
        }
        else if (sarg.startsWith("-w")) {
            enterWebserverMode();
        }
        else if (sarg === "area-all") {
            await processAllAreas();
        }
        else if (sarg === "full-all") {
            await processFulls();
        }
        else if (sarg.search("area-single") > -1) {
            try {
                nm = Number(arg[0].split("=")[1]);
                chart = settings.areachartlist[nm][1].replace("_", " ");
                console.log(`Processing area chart: ${chart}`);
                parray.push(nm);
                await processSingles();
            }
            catch {
                console.log("Index error in argument, format is: area-single=X where X is a valid vfr chart index number (see settings.json.) Exiting chartmaker!");
                process.exit();
            }
        }
        else if (sarg.search("full-single") > -1) {
            try {
                nm = Number(arg[0].split("=")[1]);
                chart = settings.fullchartlist[nm][0].replace("_", " ");
                if (chart === "DDECUS") chart = settings.fullchartlist[nm][2].replace("_", " ");
                console.log(`Processing full chart: ${chart}`);
                parray.push(nm);
                await processFulls();
            }
            catch {
                console.log("Index error in argument, format is: full-single=X where X is a valid full chart index number (see settings.json.) Exiting chartmaker!");
                process.exit();
            }
        }
    }
    else {
        let response = processPrompt("Select:\r\n" +
                                "--------------------------------------------------------------------\r\n" +
                                "1 = Process a single area VFR chart\r\n" +
                                "2 = Process all 53 area VFR charts individually\r\n" +
                                "3 = Process a single full chart from the full chart list\r\n" +
                                "4 = Process all of the full charts in the full chart list\r\n" +
                                "5 = Put chartmaker into webserver mode (new feature)\r\n" +
                                "6 = Output the settings.json file to the console\r\n" +
                                "---------------------------------------------------------------------\r\n\r\n" +
                                "Your selection: "); 
        switch (response) {
            case "1":
                await processOneArea();
                break;
            case "2":
                await processAllAreas();
                break;
            case "3":
                await processOneFull();
                break;
            case "4":
                await processAllFulls();
                break;
            case "5":
                enterWebserverMode();
                break;
            case "6":
                console.log(settings);
                console.log("\r\n\r\n\r\n");
                process.exit();
            default:
                console.log("Exiting chartmaker!");
                break;
        }
    }
}

async function processOneArea(area = -1) {
    if (area == -1) {
        let lst = "\nSelect the chart number you want to process from this list\r\n\r\n";
        for (let i = 0; i <  settings.areachartlist.length; i++) {
            lst += `${i} ${settings.areachartlist[i].split("_").join(" ")}\r\n`; 
        }
        lst += "--------------------------------------------\r\nYour selection: ";
        let response = processPrompt(lst);
        nm = +response;
    }
    else {
        nm = +area;
    }

    try {
        if (nm >= 0 && nm < settings.areachartlist.length) {
            parray.push(nm);
            await processSingles();
        }
        else {
            console.log("Invalid response, exiting chartmaker!");
            process.exit();
        }
    }
    catch(err) {
        console.error(err);
    }
}

async function processAllAreas() {    
    console.log("\r\nProcessing all 53 chart areas...\r\n");
    for (let i = 0; i < 53; i++) {
        parray.push(i);
    }
    await processSingles();
}

function createAreaChartContext(opt, signal = null) {
    const chartworkname = settings.areachartlist[opt];
    const chartname = chartworkname;
    const clippedShapeFolder = path.join(appdir, "clipshapes", "sectional");
    const charturl = `${settings.vfrindividualtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
    return new ChartTaskContext(workarea, chartworkname, chartname, charturl, clippedShapeFolder, false, signal);
}

function createFullChartContext(opt, signal = null) {
    const chart = settings.fullchartlist[opt];
    const charttype = chart[1];
    let lcasename = chart[0].toLowerCase();
    const chartworkname = chart[0];
    let isifrchart = false;
    let chartname = "";
    let charturl = "";
    let clippedShapeFolder = "";

    if (charttype === "ifr") {
        isifrchart = true;
        lcasename = chart[2].toLowerCase();
        charturl = settings.ifrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
        clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
        chartname = chart[2]; // use alias value for IFR
    } else {
        if (lcasename === "us_vfr_wall_planning") {
            charturl = `${settings.usvfrwallplanningtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname)}`;
        } else {
            charturl = settings.vfrdownloadtemplate.replace("<chartdate>", chartdate).replace("<charttype>", chartworkname);
        }
        clippedShapeFolder = path.join(appdir, "clipshapes", lcasename);
        chartname = chartworkname;
    }
    return new ChartTaskContext(workarea, chartworkname, chartname, charturl, clippedShapeFolder, isifrchart, signal);
}

async function processSingles(msgid = -1, indices = null, timingsMap = timings, signal = null) {
    const listToProcess = indices !== null ? indices : parray;
    for (let idx = 0; idx < listToProcess.length; idx++) {
        const areaOpt = listToProcess[idx];
        const ctx = createAreaChartContext(areaOpt, signal);

        chartworkname = ctx.chartworkname;
        chartname = ctx.chartname;
        chartfolder = ctx.chartfolder;
        clippedShapeFolder = ctx.clippedShapeFolder;
        charturl = ctx.charturl;
        isifrchart = ctx.isifrchart;
        metadataDescription = ctx.metadataDescription;

        const cpt = new ProcessTime(ctx.chartname);
        timingsMap.set(ctx.chartname, cpt);
        console.log(`${cpt.startdate}\n`);
        console.log(ctx.charturl);

        let doProcessing = true;
        let chartdbfile = path.join(dbfolder, `${ctx.chartname}.mbtiles`);
        if (fs.existsSync(chartdbfile)) {
            let stat = fs.statSync(chartdbfile);    
            const birthDate = stat.birthtime;
            const year = birthDate.getFullYear();
            const month = String(birthDate.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
            const day = String(birthDate.getDate()).padStart(2, '0');
            const formattedDate = `${month}-${day}-${year}`;
            if (formattedDate === chartdate) {
                // Current version of this chart exists, no processing needed
                doProcessing = false;
            }
        }
        if (doProcessing) {
            await runProcessing(ctx);
        }
        
        cpt.calculateProcessTime();
        console.log(`${cpt.totaltime}\r\n`);
        
        // if this was a single chart process request,
        // return the resulting timing class object
        if (msgid > -1) {
            return cpt;
        }
    }
}

async function processOneFull() {
    let lst = "\nSelect the full chart number you want to process from this list\r\n\r\n";
    let i = 1;
    settings.fullchartlist.forEach((fullchart) => {
        let cname = fullchart[0] === "DDECUS" ? fullchart[2] : fullchart[0];
        lst += `${i} ${cname.split("_").join(" ")}\r\n`;
        i++;
    });
    lst += "--------------------------------------------\r\nYour selection: ";
    let response = processPrompt(lst);
    nm = Number(response); 

    if (nm >= 1 && nm < settings.fullchartlist.length + 1) {
        parray.push(nm - 1);
    }
    else {
        console.log("Invalid response, exiting!");
        process.exit();
    }
	const cpt = new ProcessTime(chartname);
	timings.set(chartname, cpt);
    console.log(`${cpt.startdate}\n`);
    await processFulls();
}

async function processAllFulls() {
    settings.fullchartlist.forEach((fullchart) => {
        parray.push(settings.fullchartlist.indexOf(fullchart))
    });
    const cpt = new ProcessTime(chartname);
    timings.set(chartname, cpt);
    console.log(`${cpt.startdate}\n`);
    await processFulls();
}

async function processFulls(msgid = -1, indices = null, timingsMap = timings, signal = null) {
    const listToProcess = indices !== null ? indices : parray;
    for (let idx = 0; idx < listToProcess.length; idx++) { 
        const fullOpt = listToProcess[idx];
        const ctx = createFullChartContext(fullOpt, signal);

        chartworkname = ctx.chartworkname;
        chartname = ctx.chartname;
        chartfolder = ctx.chartfolder;
        clippedShapeFolder = ctx.clippedShapeFolder;
        charturl = ctx.charturl;
        isifrchart = ctx.isifrchart;
        metadataDescription = ctx.metadataDescription;

        const cpt = new ProcessTime(ctx.chartname);
        timingsMap.set(ctx.chartname, cpt);
        console.log(`${cpt.startdate}\n`);

        let chartdbfile = path.join(dbfolder, `${ctx.chartname}.mbtiles`);
        if (!fs.existsSync(chartdbfile)) {
            await runProcessing(ctx);
        }
        
        cpt.calculateProcessTime();
        if (msgid > -1) {
            return cpt;
        }
    };
}

async function generateGeoTIFF() {
    let question = "Enter the full path and filename of your mbtiles file: ";
    let mbtilesfile = processPrompt(question);
    if (fs.existsSync(mbtilesfile)) {
        question = "Enter the full path and filename of the geoTIFF that will be created: "
        let geotiff = processPrompt(question);
        cmd = `gdal_translate -of GTiff -co BIGTIFF=YES ${mbtilesfile} ${geotiff}`;
        await execCommandAsync(cmd);
    }
    else {
        console.log("ERROR: The specified mbtiles file does not exist, exiting chartmaker!");
    }
}

async function runProcessing(ctx = null) {
    if (!ctx) {
        ctx = new ChartTaskContext(workarea, chartworkname, chartname, charturl, clippedShapeFolder, isifrchart);
    }
    jobQueue.currentContext = ctx;
    setupEnvironment(ctx);
    await downloadCharts(ctx);
    await unzipCharts(ctx);
    normalizeChartNames(ctx);
    await processImages(ctx);
    
    if (settings.cleanprocessfolders === true) {
        if (fs.existsSync(ctx.chartfolder)) {
            fs.rmSync(ctx.chartfolder, { recursive: true, force: true });
        }
    }   
    
    if (!useWebServer) {
        ProcessTime.reportProcessingTime(startdate);
    }
}

/**
 * Generate all of the working folders for image processing
 */
function setupEnvironment(ctx = null) {
    const cfolder = ctx ? ctx.chartfolder : chartfolder;
    const d1 = ctx ? ctx.dir_1_unzipped : dir_1_unzipped;
    const d2 = ctx ? ctx.dir_2_expanded : dir_2_expanded;
    const d3 = ctx ? ctx.dir_3_clipped : dir_3_clipped;
    const d4 = ctx ? ctx.dir_4_mbtiles : dir_4_mbtiles;
    const cname = ctx ? ctx.chartname : chartname;

    // make sure the working folder for this chart is cleared out
    if (fs.existsSync(cfolder)) {
        fs.rmSync(cfolder, { recursive: true, force: true });
    }

    // Create the base workarea chart folder
    fs.mkdirSync(cfolder, { recursive: true });

    // OK, now create all of the workarea sub folders
    if (!fs.existsSync(d1)) fs.mkdirSync(d1, { recursive: true });
    if (!fs.existsSync(d2)) fs.mkdirSync(d2, { recursive: true });
    if (!fs.existsSync(d3)) fs.mkdirSync(d3, { recursive: true });
    if (!fs.existsSync(d4)) fs.mkdirSync(d4, { recursive: true });
    if (settings.logtofile) setupDebugLog(cfolder);
    logEntry(`Created all workarea subfolders for ${cname}`);
}

/**
 * Get the desired chart zip file from the FAA's digital sources URL
 */
async function downloadCharts(ctx = null) {
    const cworkname = ctx ? ctx.chartworkname : chartworkname;
    const curl = ctx ? ctx.charturl : charturl;

    let chartzip = path.join(chartcache, `${cworkname}-${chartdate}.zip`);
    if (fs.existsSync(chartzip)) {
        logEntry(`Using cached ${chartzip}`);
        return;
    }
    else { 
        let oldfiles = fs.readdirSync(chartcache);
        for (let i = 0; i < oldfiles.length; i++) {
            if (oldfiles[i].startsWith(cworkname)) {
                fs.rmSync(path.join(chartcache, oldfiles[i]));
                break;
            }
        }
        logEntry(`Downloading ${chartzip}`);
        const dlcmd = `curl ${curl} -v -o ${chartzip}`;
        await execCommandAsync(dlcmd, true, ctx?.signal);
    }
}

/**
 * Unzip chart file
 */
async function unzipCharts(ctx = null) {
    const cworkname = ctx ? ctx.chartworkname : chartworkname;
    const cname = ctx ? ctx.chartname : chartname;
    const d1 = ctx ? ctx.dir_1_unzipped : dir_1_unzipped;
    const isifr = ctx ? ctx.isifrchart : isifrchart;

    let chartzip = path.join(chartcache, `${cworkname}-${chartdate}.zip`);
    let unzipcmd = `unzip -o ${chartzip} -x '*.htm' -d ${d1}`;
    await execCommandAsync(unzipcmd, null, ctx?.signal);

    if (isifr) { // we now have a work area full of IFR zip files
        let zipfiles = fs.readdirSync(d1);
        for (const zipfile of zipfiles) {
            let srchstr = cname === "Enroute_High" ? "ENR_H" : "ENR_L"; // only unzip the indicated type
            if (zipfile.search(srchstr) > -1) {
                let ifrcmd = `unzip -o ${path.join(d1, zipfile)} -d ${d1}`;
                await execCommandAsync(ifrcmd, null, ctx?.signal);
            }
        }
    }

    // now clean out all of the irrelevant files...
    await executeCommand(`rm -r -f ${path.join(d1, "*.pdf")}`, null, ctx?.signal);
    await executeCommand(`rm -r -f ${path.join(d1, "*.htm")}`, null, ctx?.signal);
    await executeCommand(`rm -r -f ${path.join(d1, "*.zip")}`, null, ctx?.signal);
    await executeCommand(`rm -r -f "${path.join(d1, 'Caribbean Planning Chart.tif')}"`, null, ctx?.signal);
}

/** 
 * Clean up chart tif names by converting spaces and dashes to underscores
 */
function normalizeChartNames(ctx = null) {
    const d1 = ctx ? ctx.dir_1_unzipped : dir_1_unzipped;
    let files = fs.readdirSync(d1);
    for (const file of files) {
        if (file.endsWith(".tif") || file.endsWith(".tfw") || file.endsWith(".tfwx")) {
            let newfile = normalizeFileName(file);
            fs.renameSync(path.join(d1, file), path.join(d1, newfile));
        }
    }
}

/**
 * Perform GDAL operations on all the unzipped chart tif images 
 */
async function processImages(ctx = null) {
    const chartareas = buildChartNameArray(ctx);
    const cblend = settings.blendpixels;
    const shapeFolder = ctx ? ctx.clippedShapeFolder : clippedShapeFolder;
    const d1 = ctx ? ctx.dir_1_unzipped : dir_1_unzipped;
    const d2 = ctx ? ctx.dir_2_expanded : dir_2_expanded;
    const d3 = ctx ? ctx.dir_3_clipped : dir_3_clipped;
    const d4 = ctx ? ctx.dir_4_mbtiles : dir_4_mbtiles;
    const cname = ctx ? ctx.chartname : chartname;

    for (const area of chartareas) {
        logEntry(`* chart ${area}`);
        const shpfile = `${area}.shp`;
        const vrtfile = `${area}.vrt`;
        const srcfile = `${area}.tif`;
        const shapefile = path.join(shapeFolder, shpfile);
        const sourcetif = path.join(d1, srcfile);
        const expanded = path.join(d2, vrtfile);
        const clipped = path.join(d3, vrtfile);
        
        // determine if RGB expansion is required
        let ginfoCmd = `gdalinfo -json "${sourcetif}"`;
        const infojson = JSON.parse(await execCommandAsync(ginfoCmd, false, ctx?.signal));
        let expandopt = "";
        if (infojson.bands.length === 1) {
            if (settings.outputgrayscale) {
                expandopt = "-expand gray"; 
            } else {
                expandopt = "-expand rgb";
            }
        }
        
        logEntry(`>> gdal_translate ${sourcetif}`);
        let transCmd = `gdal_translate -strict -of vrt -ovr NONE ${expandopt} ${sourcetif} ${expanded}`;
        await execCommandAsync(transCmd, null, ctx?.signal);

        logEntry(`>> gdalwarp warping and clipping ${clipped} using shapefile ${shapefile}`);
        let warpCmd = `gdalwarp -t_srs EPSG:3857 -dstalpha --config GDAL_CACHEMAX 512 ` + 
              `-multi -cblend ${cblend} -cutline ${shapefile} -crop_to_cutline ${expanded} ${clipped}`;
        await execCommandAsync(warpCmd, null, ctx?.signal);
    }

    // setup formatting arguments for overviews        
    let configargs = "";
    switch (imageformat) {
        case "webp":
            configargs = `--config WEBP_LOSSLESS_OVERVIEW NO --config WEBP_LEVEL_OVERVIEW ${settings.tileimagequality}`;
            break;
        case "jpeg":
            configargs = `--config JPEG_QUALITY_OVERVIEW ${settings.tileimagequality}`;
            break;     
        default:
            // no adjustments for PNG images
            break;
    }

    // ensure output database folder exists
    if (!fs.existsSync(dbfolder)) {
        fs.mkdirSync(dbfolder, { recursive: true });
    }

    const imgfmt = imageformat.toUpperCase();
    const mbtiles = path.join(d4, cname) + ".mbtiles";
    const finalmbtiles = path.join(dbfolder, cname) + ".mbtiles";
    const bigvrt = path.join(d3, cname) + ".vrt";
    const infiles = `${d3}/*.vrt`;
    logEntry(`>> Building single chart VRT file: ${bigvrt}`);
    let vrtCmd = `gdalbuildvrt ${bigvrt} ${infiles}`;
    await execCommandAsync(vrtCmd, null, ctx?.signal);

    logEntry(`>> Creating MBTILES database file at: ${mbtiles}`);
    let mbCmd = `gdal_translate ${bigvrt} ${mbtiles} -of MBTILES ` + 
          `--config GDAL_CACHEMAX 4096 --config GDAL_MAX_DATASET_POOL_SIZE 500 ` +
          `--config OGR_SQLITE_JOURNALMODE MEMORY --config OGR_SQLITE_SYNCHRONOUS OFF ` +
          `-co TILE_FORMAT=${imgfmt} -co QUALITY=${settings.tileimagequality}`;
    await execCommandAsync(mbCmd, null, ctx?.signal);

    logEntry(`>> Adding gdaladdo overviews to ${mbtiles}`);
    configargs = `--config GDAL_CACHEMAX 4096 --config GDAL_NUM_THREADS ALL_CPUS`;
    let ovrCmd = `gdaladdo -r average ${configargs} ${mbtiles}`;
    await execCommandAsync(ovrCmd, null, ctx?.signal);

    // Update the metadata table to remove underscore characters from chart name
    let metaDesc = cname.replaceAll("_", " ");
    let sql = `UPDATE metadata SET value = '${metaDesc}' ` + 
              `WHERE name IN ('name', 'description');`;
    await execCommandAsync(`sqlite3 ${mbtiles} "${sql}"`, false, ctx?.signal);

    // Insert the metadata attribution information
    const attribution = settings.attribution.replaceAll("'", "''");
    sql = `INSERT OR REPLACE INTO metadata (name, value) ` + 
          `VALUES ('attribution', '${attribution}');`;
    await execCommandAsync(`sqlite3 ${mbtiles} "${sql}"`, false, ctx?.signal);

    // Move the finished mbtiles database to the external mbtiles folder
    logEntry(`>> Moving finished MBTILES file to: ${finalmbtiles}`);
    await execCommandAsync(`mv -f "${mbtiles}" "${finalmbtiles}"`, null, ctx?.signal);
}

/**
 * Called by processImages() so it can iterate through all unzipped chart names
 * @returns array containing all of the chart names to be processed
 */
function buildChartNameArray(ctx = null) {
    const d1 = ctx ? ctx.dir_1_unzipped : dir_1_unzipped;
    let files = fs.readdirSync(d1);
    let chartnames = [];
    files.forEach((file) => {
        if (file.search("new_york_vfr_plannings_.tif") === -1) {
            let fname = file.toLowerCase();
            if ((fname.endsWith(".tif")) &&
                (fname.search("fly") === -1)) {
                    let cname = fname.replace(".tif", "");
                    chartnames.push(cname);
            }
        }
    });
    return chartnames;
}

/**
 * Get rid of spaces and dashes in chart names and "normalize" with underscores
 * @param {string} file 
 * @returns string with underscores instead of spaces or dashes
 */
function normalizeFileName(file) {
    return file.toLowerCase()
               .split(" ").join("_")
               .split("'").join("")
               .split("-").join("_")
               .split("_sec").join("")
               .split("_tac").join("")
               .split("_chart").join("")
               .split("u.s.").join("us");
}

/**
 * Iterate through the chartdates.json file that contains chart publication dates
 * @returns the closest date of currently available FAA published charts 
 */
function getBestChartDate() {
    let thisdate = new Date();
    let thistime = thisdate.getTime();
    let cdates = [];
    let found = false;
    let selectedDate = "";
    let datedata = fs.readFileSync(path.join(appdir, "chartdates.json"), "utf-8");
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
                let m = pad2(dateobj.getMonth() + 1); // months (0-11)
                let d = pad2(dateobj.getDate());      // day (1-31)
                let y = dateobj.getFullYear();
                selectedDate = `${m}-${d}-${y}`;
                found = true;
            }
        }
        else {
            if (expiredate === "") {
                let m = pad2(dateobj.getMonth() + 1); // months (0-11)
                let d = pad2(dateobj.getDate());      // day (1-31)
                let y = dateobj.getFullYear();
                expiredate = `${m}-${d}-${y}`;
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
 * Execute the passed in command asynchronously and log the result
 * @param {string} command 
 * @param {boolean|null} logstdout 
 * @param {AbortSignal|null} signal
 * @returns {Promise<string>}
 */
function execCommandAsync(command, logstdout = null, signal = null) {
    return new Promise((resolve, reject) => {
        if (logstdout == null) {
            logstdout = settings.debug;
        }
        const execOptions = { maxBuffer: 50 * 1024 * 1024 };
        if (signal) {
            execOptions.signal = signal;
        }
        exec(command, execOptions, (error, stdout, stderr) => {
            const outStr = stdout != null ? stdout.toString() : "";
            if (error) {
                logEntry(error.message);
                if (stderr) {
                    logEntry(stderr.toString());
                }
                reject(error);
                return;
            }
            if (logstdout && outStr) {
                logEntry(outStr);
            }
            resolve(outStr);
        });
    });
}

/**
 * Execute the passed in command and log the result
 * @param {string} command 
 * @param {boolean|null} logstdout
 * @param {AbortSignal|null} signal
 */
async function executeCommand(command, logstdout = null, signal = null) {
    try {
        return await execCommandAsync(command, logstdout, signal);
    }
    catch (error) {
        if (error.name === 'AbortError') throw error;
        return "";
    }
}

/**
 * Utility to make sure clipping files are all lower-case
 */
function normalizeClipNames(targetFolder = null) {
    let folder = targetFolder || clippedShapeFolder;
    if (!folder || !fs.existsSync(folder)) return;
    let files = fs.readdirSync(folder);
    try {
        files.forEach((file) => {
            let oldname = path.join(folder, file);
            let newname = oldname.toLowerCase();
            if (oldname !== newname) {
                fs.renameSync(oldname, newname);
            }
        });
    }
    catch (err) {
        logEntry(err.message);
    }
}

/**
 * Set the global useWebServer flag 
 */
function enterWebserverMode() {
    useWebServer = true;
    //console.log("Entering web server mode")
}

/**
 * Iterate through any/all connected clients and send data
 * @param {message} json message object 
 */
async function sendMessageToClients(message, userid = "") {
    [...connections.keys()].forEach((client) => {
        if (userid === client.tag.uid || userid === "") {
            client.send(JSON.stringify(message));
        }
    });
}

// Set up a periodic ping interval
function startPingSender() {
    if (pingSenderId !== 0) {
        return pingSenderId;
    }
    const interval = setInterval(() => {
        [...connections.keys()].forEach((ws) => {
            ws.ping();
         });
    }, settings.pinginterval); 
    pingSenderId = interval;
}

function getTimingJsonObject() {
    let ptimes = [];
    [...timings.keys()].forEach((key) => {
        let cpt = timings.get(key);
        ptimes.push({chart: cpt.processname, timing: cpt.totaltime});
    });
    let tjson = {processtimes: ptimes};
    return tjson;
};

/**
 * Handle app closure and log the results
 */
process.on('exit', (code) => {
    if (pingSenderId !== 0) {
        try {
            clearInterval(pingSenderId);
            console.log("clearInterval called on ping sender");
        } 
        finally {}
    }
    console.log(`\nAbout to exit with code: ${code}`);
});

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Cleaning up...');
    // Perform cleanup operations here
    process.exit(0); // Exit gracefully
});

/**
 * Execute a single chartmaker job from the queue
 * @param {*} job 
 */
async function executeMakeJob(job) {
    let idx = -1;
    let opt = -1;
    let item = {};
    let list = job.commandlist;
    let userid = job.uid;
    let message = job.message;

    try {
        let msgclist = processCommandMessage(message);
        let msg = new AppMessage(AppMessage.mtCommandResponse);
        msg.uid = userid;
        msg.payload = "success";
        sendMessageToClients(msg, userid);
        sendMessageToClients(msgclist, userid);

        outerloop: for (let i = 0; i < list.length; i++) {
            if (job.cancelled) {
                console.log(`Job ${job.jobId} cancelled. Exiting chart processing loop.`);
                break;
            }
            resetGlobalVariables();
            item = list[i];
            idx = Number(item.command);
            opt = Number(item.chart);

            console.log(`Job ${job.jobId} - command: ${idx}, chart: ${opt}`);
            switch (idx) {
                case 0:
                    if (opt >= 0 && opt <= 52) {
                        let ridx = i; // + 1;
                        let rmt = new AppMessage(AppMessage.mtRunning); 
                        rmt.rowindex = ridx;
                        rmt.filename = item.chartname;
                        rmt.dbfilename = `${item.chartname.replaceAll(" ", "_")}.mbtiles`;
                        jobQueue.currentChart = item.chartname;
                        job.currentChart = item.chartname;
                        job.currentRowIndex = ridx;
                        sendMessageToClients(rmt, userid);

                        let cpt = await processSingles(i, [opt], job.timings, job.abortController.signal);

                        let cmt = new AppMessage(AppMessage.mtComplete); 
                        cmt.rowindex = ridx; 
                        cmt.payload = cpt.totaltime;
                        cmt.filename = item.chartname;
                        cmt.dbfilename = `${cpt.processname.replaceAll(" ", "_")}.mbtiles`;
                        job.completedItems.push({
                            type: AppMessage.mtComplete,
                            rowindex: ridx,
                            filename: item.chartname,
                            dbfilename: cmt.dbfilename,
                            payload: cpt.totaltime
                        });
                        sendMessageToClients(cmt, userid);
                    }
                    break;
                case 1:
                    if (opt >= 0 && opt <= 7) {
                        let ridx = i;
                        let rmt = new AppMessage(AppMessage.mtRunning);
                        rmt.rowindex = ridx;

                        let chart = settings.fullchartlist[opt][0].replace("_", " ");
                        if (chart === "DDECUS") chart = settings.fullchartlist[opt][2].replace("_", " ");
                        console.log(`Job ${job.jobId} - processing full chart: ${chart}`);
                        rmt.filename = chart;
                        rmt.dbfilename = `${chart.replaceAll(" ", "_")}.mbtiles`;
                        jobQueue.currentChart = chart;
                        job.currentChart = chart;
                        job.currentRowIndex = ridx;
                        sendMessageToClients(rmt, userid);

                        let cpt = await processFulls(i, [opt], job.timings, job.abortController.signal);

                        let cmt = new AppMessage(AppMessage.mtComplete);
                        cmt.rowindex = ridx;
                        cmt.payload = cpt.totaltime;
                        cmt.filename = chart;
                        cmt.dbfilename = `${cpt.processname.replaceAll(" ", "_")}.mbtiles`;
                        job.completedItems.push({
                            type: AppMessage.mtComplete,
                            rowindex: ridx,
                            filename: chart,
                            dbfilename: cmt.dbfilename,
                            payload: cpt.totaltime
                        });
                        sendMessageToClients(cmt, userid);
                    }
                    break;
            }
        }
        if (!job.cancelled) {
            let payload = ProcessTime.reportProcessingTime(job.startedAt || startdate); 
            job.totalTime = payload;
            job.status = "completed";
            job.completedAt = new Date();
            job.currentChart = "";
            job.currentRowIndex = -1;

            let timemsg = new AppMessage(AppMessage.mtTiming); 
            timemsg.payload = payload;
            sendMessageToClients(timemsg, userid);
        }
    }
    catch (error) {
        if (job.cancelled || error.name === 'AbortError') {
            job.status = "cancelled";
            console.log(`Job ${job.jobId} aborted by user.`);
            let cmsg = new AppMessage(AppMessage.mtCommandResponse);
            cmsg.uid = userid;
            cmsg.payload = "cancelled";
            sendMessageToClients(cmsg, userid);
        } else {
            job.status = "failed";
            console.error(`Error in executeMakeJob for ${job.jobId}:`, error);
            throw error;
        }
    }
    finally {
        jobQueue.currentChart = "";
        jobQueue.currentContext = null;
        resetGlobalVariables();
    }
}

/**
 * Convenience wrapper: enqueues the command message into the FIFO jobQueue
 * @param {*} message JSON object message
 */
async function processMakeCommands(message) {
    return jobQueue.enqueue(message);
}

function resetGlobalVariables() {
    chartworkname = "";
    chartname = "";
    charturl = "";
    clippedShapeFolder = "";
    cmd = "";
    chartfolder = "";
    dir_1_unzipped = "";
    dir_2_expanded = "";
    dir_3_clipped = "";
    dir_4_mbtiles = "";
    isifrchart = false;
    metadataDescription = "";
    parray.splice(0, parray.length);
    nm = 0;
}

function processCommandMessage(message) {
    let clist = new AppMessage(AppMessage.mtCommand);
    clist.payload = { commandlist: [] };
    clist.uid = message.uid;
    
    try {
        if (message.type === AppMessage.mtSettings) {
            console.log("Settings command received");
            return;
        }
        else if(message.type === AppMessage.mtDownload) {
            console.log("Download command received");
            return;
        }
        else {
            if (message.commandlist.length > 0) {
                for (let i = 0; i < message.commandlist.length; i++) {
                    let tclcmd = +message.commandlist[i].command;
                    let tclcht = +message.commandlist[i].chart;
                    let strcmd = tclcmd === 0 ? "Process single area VFR chart" : "Process single full chart";
                    let strcht = "";
                    switch (tclcmd) {
                        case 0:
                            strcht = settings.areachartlist[tclcht]
                            strcht = strcht.replaceAll("_", " ");
                            break;
                        case 2:
                            strcht = settings.fullchartlist[tclcht][0];
                            strcht = strcht.replaceAll("_", " ");
                            break;
                        default:
                            strcht = "N/A";
                            break;
                    }     
                    clist.payload.commandlist.push({ command: strcmd, chart: strcht })
                }
            }
        }
    }
    catch(error) {
        console.log(error)
    }

    return clist;
}

function getUniqueUserId(){
    return `${Date.now()}-${Math.random().toString(36)}`;
}

/**
 * Start the express web server and open a websocket server
 */
(() => {
    if (useWebServer) {
        const app = express();
        const server = http.createServer(app);
        
        try {

            app.use(express.urlencoded({ extended: true }));
            server.listen(settings.httpport, '0.0.0.0', () => { 
                console.log(`Web Server listening on port ${settings.httpport}`);
            });

            let options = {
                maxAge: 600000,
                dotfiles: 'ignore',
                etag: false,
                extensions: ['html'],
                index: false,
                redirect: false,
                setHeaders: function (res, path, stat) {
                    res.set('x-timestamp', Date.now());
                    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
                }
            };

            let distdir = path.join(appdir, "dist");
            app.use(express.static(distdir, options));
            if (settings.useauthentication) {
                app.use(authentication);
            }
            app.use(express.json());

            // Cookie & User Identity middleware
            app.use((req, res, next) => {
                const cookies = parseCookies(req.headers.cookie);
                let uid = cookies.chartmaker_uid;
                if (!uid) {
                    uid = getUniqueUserId();
                    res.cookie('chartmaker_uid', uid, {
                        maxAge: 30 * 24 * 60 * 60 * 1000,
                        httpOnly: false,
                        sameSite: 'lax',
                        path: '/'
                    });
                }
                req.userUid = uid;
                next();
            });
            
            app.get("/", (req, res) => {
                const indexPath = path.join(distdir, "index.html");
                if (!fs.existsSync(indexPath)) {
                    res.status(503).send("Client build not found in dist/. Run 'npm run build' first.");
                    return;
                }
                res.send(fs.readFileSync(indexPath, "utf-8"));
                res.end();
            });

            app.get("/settings", (req, res) => {
                res.send(JSON.stringify(settings));
                res.end();
            });
            
            app.get("/status", (req, res) => {
                res.json(jobQueue.getStatus());
            });

            app.get("/job-state", (req, res) => {
                const cookies = parseCookies(req.headers.cookie);
                const uid = req.query.uid || cookies.chartmaker_uid || req.userUid;
                if (!uid) {
                    return res.json({ job: null });
                }
                const state = jobQueue.getUserJobState(uid);
                res.json({ job: state });
            });

            app.post("/clearjob", (req, res) => {
                const cookies = parseCookies(req.headers.cookie);
                const uid = req.body?.uid || req.query.uid || cookies.chartmaker_uid || req.userUid;
                if (uid) {
                    jobQueue.clearUserJob(uid);
                }
                res.json({ success: true });
            });

            app.get("/existingcount", async (req, res) => {
                let data = await getExistingCount();
                res.send(JSON.stringify({ existingcount: data }));
                res.end();
            });

            app.post("/sendexisting", async (req, res) => {
                let data = await sendExistingDatabases(req.body);
                res.send(data);
            });

            app.post("/make", async (req, res) => {
                try {
                    const message = req.body || {};
                    if (!message.commandlist || !Array.isArray(message.commandlist) || message.commandlist.length === 0) {
                        return res.status(400).json({ error: "No chart commands provided in commandlist" });
                    }
                    if (!message.uid) {
                        message.uid = req.userUid;
                    }
                    const result = jobQueue.enqueue(message);
                    res.status(202).json({
                        status: result.status,
                        jobId: result.jobId,
                        position: result.position,
                        message: result.status === "queued"
                            ? `Chart processing job queued (position #${result.position})`
                            : "Chart processing initiated"
                    });
                } catch (err) {
                    console.error("Error during POST /make:", err);
                    res.status(500).json({ error: err.message });
                }
            });

            app.post("/download", async (req, res) => {
                console.log("Download request posted!");
                await uploadArchiveFile(req.body, res);
            });

            app.post("/cancel", (req, res) => {
                try {
                    const cookies = parseCookies(req.headers.cookie);
                    const uid = req.body?.uid || cookies.chartmaker_uid || req.userUid;
                    const jobId = req.body?.jobId || null;
                    const result = jobQueue.cancelJob(uid, jobId);
                    res.json(result);
                } catch (err) {
                    console.error("Error during POST /cancel:", err);
                    res.status(500).json({ error: err.message });
                }
            });

            // Unified single-port WebSocket server attached directly to the HTTP server
            const wss = new WebSocketServer({ server });
            console.log(`WebSocket server listening on port ${settings.httpport}`);
            let msg = {};

            wss.on('connection', (ws, req) => {
                const cookies = parseCookies(req?.headers?.cookie);
                const clientUid = cookies.chartmaker_uid || "";

                ws.tag = { sent: false, uid: clientUid };
                ws.ping();
                
                ws.on('close', function() {
                    const id = connections.get(ws);
                    connections.delete(ws);
                    console.log(`Websocket closed, id: ${id}`);
                });

                ws.on('pong', () => {
                    if (ws.tag.sent === false) {
                        let uid = ws.tag.uid || getUniqueUserId();
                        ws.tag.uid = uid;
                        ws.tag.sent = true;
                        console.log(`Websocket connected, id: ${uid}`);
                        // Add the client ws to the connections dictionary
                        connections.set(ws, uid);   

                        // Send a confirmation message back to the client
                        let msg = { type: "connection", uid: uid };
                        sendMessageToClients(msg, uid);

                        // If user has an existing job state, send syncstate
                        const userState = jobQueue.getUserJobState(uid);
                        if (userState) {
                            let syncMsg = new AppMessage(AppMessage.mtSyncState);
                            syncMsg.uid = uid;
                            syncMsg.payload = userState;
                            ws.send(JSON.stringify(syncMsg));
                        }
                    }
                });

                ws.on('error', (error) => {
                    console.error("Websocket error:", error);
                    connections.delete(ws);
                });

                ws.onmessage = async(event) => {
                    try {
                        let message = JSON.parse(event.data);
                        if (message.type === "init" || message.type === "connection") {
                            if (message.uid) {
                                ws.tag.uid = message.uid;
                                connections.set(ws, message.uid);
                                const userState = jobQueue.getUserJobState(message.uid);
                                if (userState) {
                                    let syncMsg = new AppMessage(AppMessage.mtSyncState);
                                    syncMsg.uid = message.uid;
                                    syncMsg.payload = userState;
                                    ws.send(JSON.stringify(syncMsg));
                                }
                            }
                            return;
                        }
                        if (message.type === "clearjob") {
                            const uid = message.uid || ws.tag.uid;
                            if (uid) jobQueue.clearUserJob(uid);
                            return;
                        }
                        if (message.type === "canceljob") {
                            const uid = message.uid || ws.tag.uid;
                            const jobId = message.jobId || null;
                            jobQueue.cancelJob(uid, jobId);
                            return;
                        }
                        if (!message.commandlist || !Array.isArray(message.commandlist) || message.commandlist.length === 0) {
                            return;
                        }
                        if (!message.uid) {
                            message.uid = ws.tag.uid;
                        }
                        jobQueue.enqueue(message);
                    } catch (err) {
                        console.error("Websocket onmessage error:", err);
                    }
                };
            });
            startPingSender();
        }
        catch (err) {
            console.log(err);
        }
        
    }
})();

/**
 * Create and upload a ZIP archive with the user's selected charts
 * @param {*} message This is the controller message
 * @param {*} response Send the chart to the ZIP file via response
 */
async function uploadArchiveFile(message, response) {
    const charts = message.charts || [];
    const uid = message.uid || "";

    if (!charts.length) {
        return response.status(400).json({ error: "No charts selected for download" });
    }

    const tmpZipName = `charts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zip`;
    const tmpZipPath = path.join(workarea, tmpZipName);

    // Collect valid file paths
    const filesToZip = [];
    charts.forEach((item, index) => {
        const filePath = path.join(dbfolder, item.dbfilename);
        if (fs.existsSync(filePath)) {
            filesToZip.push(filePath);
            let msg = new AppMessage(AppMessage.mtDownload);
            msg.uid = uid;
            msg.dbfilename = item.dbfilename;
            msg.rowindex = item.rowindex !== undefined ? item.rowindex : index;
            msg.completed = false;
            sendMessageToClients(msg, uid);
        }
    });

    if (filesToZip.length === 0) {
        return response.status(404).json({ error: "Selected chart databases not found on server" });
    }

    try {
        const quotedFiles = filesToZip.map(f => `"${f}"`).join(" ");
        await execCommandAsync(`zip -j -1 "${tmpZipPath}" ${quotedFiles}`);

        response.download(tmpZipPath, zipfilename, (err) => {
            try {
                if (fs.existsSync(tmpZipPath)) {
                    fs.unlinkSync(tmpZipPath);
                }
            } catch {}
            if (err) {
                console.error('File download failed:', err);
            } else {
                console.log('Archive file downloaded successfully.');
                let dlcmsg = new AppMessage(AppMessage.mtDownload);
                dlcmsg.completed = true;
                sendMessageToClients(dlcmsg, uid);
            }
        });
    } catch (err) {
        console.error("Failed to create zip archive:", err);
        if (fs.existsSync(tmpZipPath)) {
            try { fs.unlinkSync(tmpZipPath); } catch {}
        }
        if (!response.headersSent) {
            response.status(500).json({ error: "Failed to generate zip archive: " + err.message });
        }
    }
}

/**
 * Get the count of current pre-existing database files
 * @returns number
 */
async function getExistingCount() {
    try {
        const extensionsToOmit = ['.zip']; 
        const files = fs.readdirSync(dbfolder);
        const filteredfiles = files.filter(file => {
            const fileExtension = path.extname(file);
            return !extensionsToOmit.includes(fileExtension);
        });

        return filteredfiles.length;
    }
    catch(err) {
        console.log(err.message);
    }
    return 0;
}

/**
 * Send the existing database list to the requesting client browser
 * @param {'*'} message 
 * @returns an Appmessage.mtExistingDb message with a list of databases
 */
async function sendExistingDatabases(message) {
    const extensionsToOmit = ['.zip', '.txt']; 
    const items = { existingdblist: [] };
    try {
        const files = fs.readdirSync(dbfolder);
        const filteredfiles = files.filter(file => {
            const fileExtension = path.extname(file);
            return !extensionsToOmit.includes(fileExtension);
        });
        let idx = -1;
        filteredfiles.forEach(file => {
            idx ++;
            let msg = new AppMessage(AppMessage.mtExistingDb);  
            const spl = file.split(".");
            msg.filename = spl[0];
            msg.filedate = chartdate;
            msg.dbfilename = file;
            msg.rowindex = idx;
            items.existingdblist.push(msg);
        });
        message.items = items;
        message.completed = true;
    }
    catch(err) {
        console.error(err.stack);
    }
    return message;
}

/**
 * Authenticate the browser user
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 * @returns 
 */
function authentication(req, res, next) {
    const authheader = req.headers.authorization;
    
    if (!authheader) {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err)
    }
    
    const b64data = authheader.split(' ')[1];
    let ufound = false;
    for (let i = 0; i < users.length; i++) {
        if (users[i] === b64data) {
            ufound = true;
            break;
        }
    }
    
    if (ufound) {
        return next();
    }
    else {
        let err = new Error('You are not authenticated!');
        res.setHeader('WWW-Authenticate', 'Basic');
        err.status = 401;
        return next(err);
    }
}
