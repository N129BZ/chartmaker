'use strict'


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
    
    constructor(msgtype) {
        this.type = msgtype;
        this.css = [];
        this.payload = "";
        this.rowindex = -1;
        this.completed = false;
        this.items = [];
        this.commandlist = [];
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

const URL_LOCATION            =  location.hostname;
const URL_PROTOCOL            =  location.protocol;
const URL_PORT                =  location.port;

var URL_HOST_BASE           =  URL_LOCATION;
if (parseInt(URL_PORT) > 0) {
    URL_HOST_BASE += `:${URL_PORT}`;
}

const URL_HOST_PROTOCOL       = `${URL_PROTOCOL}//`;
const URL_SERVER              = `${URL_HOST_PROTOCOL}${URL_HOST_BASE}`;
const URL_WINSOCK             = `ws://${URL_LOCATION}:`;
const URL_GET_SETTINGS        = `${URL_SERVER}/settings`;
const URL_GET_EXISTINGCOUNT   = `${URL_SERVER}/existingcount`;
const URL_POST_SENDEXISTING   = `${URL_SERVER}/sendexisting`;
const URL_GET_STATUS          = `${URL_SERVER}/status`;
const URL_POST_MAKE           = `${URL_SERVER}/make`;
const URL_POST_DOWNLOAD       = `${URL_SERVER}/download`;

const fclist = document.getElementById("fclist");
const aclist = document.getElementById("aclist");
const confwindow = document.getElementById("confwindow");
const txtCommand = document.getElementById("txtCommand");
const txtChart = document.getElementById("txtChart");
const commandOptions = document.getElementById("commandOptions");
const chartOptions = document.getElementById("chartOptions");
const commandbody = document.getElementById("commandbody");
const download = document.getElementById("download");
const downloadExisting = document.getElementById("downloadExisting");

const addItemsMenu = document.getElementById("addItemsMenu");
const btnUndoCommand = document.getElementById("btnUndoCommand");
const btnUndoChart = document.getElementById("btnUndoChart");
const btnAddCommand = document.getElementById("btnAddCommand");
const btnSelectAll = document.getElementById("btnSelectAll");
const btnUnselectAll = document.getElementById("btnUnselectAll");
const btnDownload = document.getElementById("btnDownload");
const btnReset = document.getElementById("btnReset");
const btnRemove = document.getElementById("btnRemove");
const btnProcessCharts = document.getElementById("btnProcessCharts");
const chkForExisting = document.getElementById("checkForExisting");
const processInfo = document.getElementById("processInformation");

var thisUserId = "";
var websocket;
var indexlist = [];
var commandpackage = { type: "commandpackage",
                       commandlist: [],
                       uid: "" };
var processitems = [];
var confcommands = [];
var settings = {};
var selectedcommand = -1;
var selectedchart = -1;
var blinking = false;
var inResponseView = false;
var fullChartNames = [];
var areaChartNames = [];
var downloadInProgress = false;

const dlchkPrefix = "dlchk";


window.addEventListener("load", () => {
    setupCommandBody();
    populateCommandsDropdown();
});

window.addEventListener("resize", () => {
    console.log("windowresize event");
});

async function getSettingsFromServer() {
    try {
        const data = await fetch(URL_GET_SETTINGS); 
        if (!data.ok) {
            throw new Error(`HTTP error! status: ${data.status}`);
        } 
        settings = await data.json();
        console.log(settings);
        checkForExistingDatabases();
        setChartNameArrays();
        startWebsocketClient();
        
    }
    catch(err) {
        console.log(err.message);
    }
}

/**
 * get the settings object from the server
 */
getSettingsFromServer();

/**
 * See if we need to display the show downloadExisting checkbox
 */
async function checkForExistingDatabases() {
    let hasexisting = await hasExistingDatabases();
    if(hasexisting) {
        downloadExisting.style.visibility = "visible";
    }
    else {
        downloadExisting.style.visibility = "hidden"
    }
}

/**
 * Iterate through the chart types and chart names and create their lists
 */
function setChartNameArrays() {
    // Full chart names
    for (let i = 0; i < settings.fullchartlist.length; i++) {
        let item = settings.fullchartlist[i][0];
        if (item.includes("DDECUS")) {
            item = settings.fullchartlist[i][2];
        }
        fullChartNames.push(item.replaceAll("_", " "));
    }

    // Area chart names
    for (let i = 0; i < settings.areachartlist.length; i++) {
        let item = settings.areachartlist[i];
        areaChartNames.push(item.replaceAll("_", " "));
    }
};

/**
 * Websocket connection and message handling
 */
function startWebsocketClient() { 
    try {
        let wsurl = `${URL_WINSOCK}${settings.wsport}`;
        console.log(`OPENING: ${wsurl}`);
        websocket = new WebSocket(wsurl);

        websocket.onmessage = (event) => {
            try {
                let message = JSON.parse(event.data);
                switch (message.type) {
                    case AppMessage.mtTiming: 
                        blinkSendButton(false);
                        postTimingMessaqe(message);
                        break;
                    case AppMessage.mtInfo:
                        updateCommandBody(message);
                        break;
                    case AppMessage.mtRunning:
                    case AppMessage.mtComplete:
                        updateCommandBody(message);
                        break;
                    case AppMessage.mtCommandResponse:
                        if (message.payload === "success") {
                            message.payload = "Server response: chart processing has started...";
                            updateCommandBody(message);
                        }
                        else {
                            message.payload = "Server response: status unknown, possible command error";
                            message.css = ["boldred"];
                            updateCommandBody(message);
                        }
                        break;
                    case AppMessage.mtDownload:
                        updateCommandBody(message)
                        break;
                    case AppMessage.mtSettings:
                        let payload = JSON.parse(message.payload);
                        console.log(payload);
                        break;
                    case AppMessage.mtConnection:
                        thisUserId = message.uid;
                        commandpackage = new AppMessage(AppMessage.mtCommandPackage);
                        commandpackage.uid = thisUserId;
                        break; 
                    case AppMessage.mtCommand:
                    default:
                        console.log(message.payload);
                        break;
                }
            }
            finally { }
        }

        websocket.onerror = function(evt){
            console.log("Websocket ERROR: " + evt.data);
        }
        
        websocket.onopen = function(evt) {
            console.log("Websocket CONNECTED.");
        }
        
        websocket.onclose = function(evt) {
            console.log("Websocket CLOSED.");
        }
    }
    catch (error) {
        console.log(error);
    }
};

/**
 * Get a json object from a data string
 * @param {*} data 
 * @returns true or false 
 */
function getJSON(data) {
    if (typeof data !== 'string' || data.trim() === '') {
        return { isJSON: false }; // probably a Blob
    }

    try {
        let output = JSON.parse(data);
        return { isJSON: true, message: output }; // Successfully parsed, return JSON
    } 
    catch (error) {
        return { isJSON: false }; // Parsing failed, return false
    }
}

/**
 * Remove the last command the user entered
 */
function removeLastEntry() {
    if (commandpackage.commandlist.length > 0) {
        commandpackage.commandlist.pop();
        for (let i = commandbody.rows.length - 1; i >= 0; i--) {
            let lastitem = commandbody.rows[i];
            let td = lastitem.firstChild;
            if (td.textContent !== "") {
                td.textContent = "";
                break;        
            }
        }
    }
}

/**
 * Reset the application after a completed download session
 */
function resetFromDownloadState() {
    console.log("RESETTING FROM DOWNLOAD STATE!");
    processitems.forEach((item) =>{
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        ckb.checked = false;
    });
    btnDownload.classList.remove("running");
    btnDownload.innerText = "Download Checked Items";
    resetEverything();
}

/**
 * Reset the application back to it's initial load state
 */
function resetEverything() {
    selectedchart = -1;
    selectedcommand = -1;
    processitems.splice(0, processitems.length);
    addItemsMenu.style.display = "block";
    resetCommandOptions(); 
    resetChartOptions();  
    setupCommandBody();
    setDownloadButtonVisible(false);
    confwindow.scroll({left: 0, top: 0}); 
    btnReset.style.visibility = "visible";
    btnSelectAll.style.display = "none";
    btnUnselectAll.style.display = "none";
    btnAddCommand.style.display = "block";
    btnRemove.style.display = "inline";
    chkForExisting.checked = false;
    downloadInProgress = false;
    blinking = false;
    btnProcessCharts.innerText = "Process Charts";
    btnProcessCharts.classList.remove("start-animation"); 
    commandpackage = { type: "commandpackage",
                       commandlist: [],
                       uid: "" };
    commandpackage.uid = thisUserId;
}

/**
 * Package up the command requests and send them to the server
 */
async function sendCommandsToServer() {
    if (commandpackage.commandlist.length > 0) {
        commandpackage.uid = thisUserId;
        addItemsMenu.style.display = "none";
        inResponseView = true;
        blinkSendButton(true);
        const response = await fetch(URL_POST_MAKE, { method: 'POST',
                                                      headers: {'Content-Type': 'application/json'},  
                                                      body: JSON.stringify(commandpackage) }); 
        if (response.ok) {    
            resetCommandOptions();
            resetChartOptions();
            addItemsMenu.style.display = "block";
        }  
    }
}

/**
 * Post a timing message for a completed process
 * @param {*} message 
 */
function postTimingMessaqe(message) {
    processInfo.classList.add( ... message.css);
    processInfo.textContent = `Total time for chart processing: ${message.payload}`;
    resetCommandOptions(); 
    resetChartOptions(); 
    commandpackage = new AppMessage(AppMessage.mtCommandPackage);
    
    processitems.forEach((item) => {
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        ckb.style.display = "inline";
        ckb.addEventListener("change", handleCheckboxChange); 
    });
}

/**
 * Master event handler for commandbody checkboxes
 */
function handleCheckboxChange() {
    // We want to iterate ALL checkboxes and set the state
    // of the download button if ANY checkbox is checked.
    let found = false;
    processitems.forEach((item) => {
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        if (ckb.checked) {
            found = true;
        }
    });
    setDownloadButtonVisible(found);
}

/**
 * Undo the last selection from either list
 * @param {*} source 
 */
function undoSelection(source) {
    if (source === "command") {
        txtCommand.value = "";
        selectedcommand = -1;
        txtChart.value = "";
        selectedchart = -1;
    }
    else if (source === "chart") {
        txtChart.value = "";
        selectedchart = -1;
    }
}

/**
 * Call for the server to zip up the user's selected 
 * databases and then upload the zip back here to the client
 */
async function downloadCheckedItems() {
    let dlitems = { uid: thisUserId, charts: [] };
    btnDownload.classList.add("running");
    btnDownload.innerText = "Zipping download files...";
    processitems.forEach((item) => {
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        if (ckb.checked) {
            let details = {}
            dlitems.charts.push(item);
        }
    });

    if (dlitems.charts.length > 0) {
        console.log(dlitems);
        downloadZipfile(dlitems);
    }
}

/**
 * Set the desired state of the download button
 * @param {*} isVisible 
 */
function setDownloadButtonVisible(isVisible) {
    if (isVisible) {
        btnDownload.style.visibility = "visible";
        btnRemove.style.visibility = "hidden";
        btnProcessCharts.style.visibility = "hidden";
        addItemsMenu.style.visibility = "hidden";
        downloadExisting.style.visibility = "hidden";
        chkForExisting.checked = false;
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.display = "inline";
    }
    else {
        btnDownload.classList.remove("running");
        btnDownload.innerText = "Download Checked Items"
        btnDownload.style.visibility = "hidden";
        btnRemove.style.visibility = "visible";
        btnProcessCharts.style.visibility = "visible";
        addItemsMenu.style.visibility = "visible";
        checkForExistingDatabases(); 
    }
}

/**
 * Add a command request to the list and the commandbody
 * @returns 
 */
function addCommandRequest() {
    if (inResponseView) {
        setupCommandBody();
    }

    if (selectedcommand === -1) {
        return;
    }

    if (selectedcommand === 0 || selectedcommand === 2) {
        if (txtChart.value === "") {
            return;
        }
    }
    
    // If one of the "all charts" options has been selected, 
    // initialize the list len number to match the option.
    let listlen = 1; 
    let isfullList = true;
    let cmdtext = "";
    let list = [];
    switch (selectedcommand) {
        case 0:
            cmdtext = "Process area chart :";
            list = areaChartNames;
            isfullList = false;
            break;
        case 1:
            cmdtext = "Process area chart :";
            list = areaChartNames;
            selectedcommand --;
            selectedchart = 0;
            break;
        case 2:
            cmdtext = "Process full chart :";
            list = fullChartNames;
            isfullList = false;
            break;
        case 3:
            cmdtext = "Process full chart :";
            list = fullChartNames;
            selectedcommand --;
            selectedchart = 0;
            break;
    }
    
    let idx = commandpackage.commandlist.length;
    
    for (let i = idx; i < idx + list.length; i++) {
        let infomessage = new AppMessage(AppMessage.mtInfo); 
        let chartname = list[selectedchart];
        infomessage.payload = `${cmdtext} ${chartname}` ;
        infomessage.uid = thisUserId;
        updateCommandBody(infomessage);

        let ridx = i + 1;
        let selectedRadio = document.querySelector('input[name="layerType"]:checked');
        let entry = new MakeCommand(selectedcommand, selectedchart, ridx, chartname, selectedRadio.value);
        commandpackage.commandlist.push(entry); 
        if (isfullList) {
            selectedchart = selectedchart + 1; 
        }
        else {
            break;
        }
    }
    resetCommandOptions();
}

/**
 * Turn animation on/off for the download button
 * @param {*} isVisible 
 */
function blinkSendButton(isVisible) {
    if (isVisible) {
        blinking = true;
        btnProcessCharts.textContent = "Processing...";
        btnProcessCharts.classList.add('start-animation');
        downloadExisting.style.visibility = "hidden";
    }
    else {
        blinking = false;
        btnProcessCharts.textContent = "Process Charts";
        btnProcessCharts.classList.remove('start-animation');
        checkForExistingDatabases();
    }
}

/**
 * Update a row in the commandbody with incoming information
 * @param {*} message 
 * @returns 
 */
function updateCommandBody(message) { 
    if (message.type === "commandresponse") {
        processInfo.classList.add(... message.css);
        processInfo.textContent = message.payload;
    }
    else {
        if (message.type === AppMessage.mtRunning) {
            let rowidx = +message.rowindex;
            let tr = commandbody.rows[rowidx];
            let td = tr.children[0];
            td.classList.add("running");
            td = tr.children[1]; 
            let span = td.firstChild;
            span.textContent = "* in progress *";
            td.classList.add("running");
            processInfo.textContent = `Now processing: ${message.filename}`;
        }
        else if (message.type === AppMessage.mtComplete) {
            let rowidx = +message.rowindex;
            let tr = commandbody.rows[rowidx];
            let td = tr.children[0];
            td.classList.remove("running");
            td = tr.children[1];
            let span = td.firstChild;
            span.textContent = message.payload;
            td.classList.remove("running");
            processitems.push(message);
        }
        else if (message.type === AppMessage.mtExistingDb) {
            let tr = commandbody.rows[message.rowindex];
            let td1 = tr.children[0];
            td1.textContent = message.filename;
            let td2 = tr.children[1];
            let ch1 = td2.children[0];
            let div = document.createElement("div");
            div.textContent = message.filedate;
            div.className = "datediv";
            td2.insertBefore(div, ch1);
            btnSelectAll.style.display = "block";
        }
        else if (message.type === AppMessage.mtDownload) {
            if (message.completed === false) {
                var tr, td1, td2;
                for (let i = 0; i < commandbody.rows.length; i++) {
                    tr = commandbody.rows[i];
                    td1 = tr.children[0];
                    td2 = tr.children[1];
                    if (i !== message.rowindex) {
                        td1.classList.remove("running");
                        td2.classList.remove("running");
                    }
                    else {
                        td1.classList.add("running");
                        td2.classList.add("running");
                    }
                }
            }
            else {
                resetEverything();
            }
        }
        else {
            // Add the incoming message to the first empty row
            for (let i = 0; i < commandbody.rows.length; i++) {
                let tr = commandbody.rows[i];
                let td = tr.firstChild;
                if (td.innerText === "") { 
                    td.classList.add(... message.css);
                    td.innerText = message.payload;
                    return;
                }
            }
        }
    }
}

/**
 * Set the selected state of a chart item
 */
function chartSelected() {
    selectedchart = -1;
    let item = txtChart.value;
    for (let i = 0; i < settings.areachartlist.length; i++) {
        if (chartOptions.options[i].value === item) {
            selectedchart = i;
            break;
        } 
    }
}

/**
 * Set the selected state of a command item
 */
function commandSelected() {
    selectedcommand = -1;
    let item = txtCommand.value;
    
    if (chkForExisting.checked) {
        chkForExisting.checked = false;
        setupCommandBody();
    }

    for(let i = 0; i < commandOptions.options.length; i++) {
        if (commandOptions.options[i].value === item) {
            selectedcommand = i;
            break; 
        }
    }

    switch (selectedcommand) {
        case 0:
        case 1:
            populateAreaChartList();
            break;
        case 2:
        case 3:
            populateFullChartList();
            break;
    }
}

/**
 * Populate the individual area chart list
 */
function populateAreaChartList() {
    resetChartOptions();
    for (let i = 0; i < settings.areachartlist.length; i++) {
        let option = document.createElement('option');
        option.value = `${settings.areachartlist[i].replaceAll("_", " ")}`;
        chartOptions.appendChild(option);
    }
}

/**
 * Populate the full chart list
 */
function populateFullChartList() {
    resetChartOptions();
    let  i = 0;
    let item = "";
    
    for (i = 0; i < settings.fullchartlist.length; i++) {
        let option = document.createElement('option');
        if (i == 5 || i == 6) {
            item = `${settings.fullchartlist[i][2].replaceAll("_", " ")}`;
            option.value = item;
        }
        else {
            item = `${settings.fullchartlist[i][0].replaceAll("_", " ")}`;
            option.value = item;
        } 
        chartOptions.appendChild(option)
    }
}

/**
 * Generate or Re-generate an empty commandbody list
 */
function setupCommandBody() {
    inResponseView = false;
    processInfo.textContent = "Confirmed chart processing entries:"
    commandbody.innerText = "";
    for (let i = 0; i < 100; i++) {
        let tr = document.createElement("tr");
        tr.setAttribute("tag", i.toString());
        tr.className = "tablerow";

        let td = document.createElement("td");
        let nmid = `leftcell-${i}`;
        td.name = nmid;
        td.id = nmid;
        td.className = "leftcell";
        tr.appendChild(td);
        
        td = document.createElement("td");
        nmid = `rightcell-${i}`;
        td.name = nmid;
        td.id = nmid;
        td.className = "rightcell";
        
        // create the <span> text container
        let span = document.createElement("span");
        nmid = `span-${i}`;
        span.id = nmid;
        span.name = nmid;
        span.className = "resultspan";
        td.appendChild(span)
        
        // create the hidden checkbox
        let ckb = document.createElement("input");
        nmid = `${dlchkPrefix}-${i}`;
        ckb.name = nmid;
        ckb.id = nmid;
        ckb.type = "checkbox";
        ckb.className = "dlcheckbox";
        td.appendChild(ckb);
        
        tr.appendChild(td);

        // Now append the new <tr> to the command body
        commandbody.appendChild(tr);
    }
}

/**
 * Populate the Commands item list
 */
function populateCommandsDropdown() {
    let alist = []; 
    for (let i = 0; i < 4; i++) {
        alist.push(document.createElement('option'));
        alist[i].className = "option";
    }
    alist[0].value = "Process single area VFR chart";
    commandOptions.appendChild(alist[0]);
    alist[1].value = "Process all 53 area VFR charts";
    commandOptions.appendChild(alist[1]);
    alist[2].value = "Process single full chart";
    commandOptions.appendChild(alist[2]);
    alist[3].value = "Process all of the full charts";
    commandOptions.appendChild(alist[3]);
}

/**
 * Reset the command dropdown list
 */
function resetCommandOptions() {
    txtCommand.value = "";
    selectedcommand = -1;
    resetChartOptions();    
}

/**
 * Reset the chart dropdown list
 */
function resetChartOptions() {
    selectedchart = -1;
    txtChart.value = "";
    chartOptions.innerText = "";
}

/**
 * Call the server asynchronously to request a zip file download
 * @param {*} dlitems 
 * @returns 
 */
async function downloadZipfile(dlitems) {
    downloadInProgress = true;
    chkForExisting.checked = false;
    try {    
        // dlitems is an array of AppMessage type "complete"...       
        const response = await fetch(URL_POST_DOWNLOAD, { method: 'POST',
                                                          headers: {'Content-Type': 'application/json'},  
                                                          body: JSON.stringify(dlitems) }); 
        if (!response.ok) {
            resetEverything();
            return;
        } 
        const stream = response.body;
        const reader = stream.getReader();
        const chunks = [];

        function pump() {
            return reader.read().then(({ done, value }) => {
                if (done) {
                    processChunks(chunks);
                    return;
                }
                chunks.push(value);
                return pump();
            });
        }
        await pump();
    } 
    catch (err) {
        console.error("Download failed:", err.message);
    }
}

/**
 * Sub process handles incoming download chunks
 * @param {*} chunks 
 */
function processChunks(chunks) {
    const blob = new Blob(chunks);
    const fileURL = URL.createObjectURL(blob);

    const downloadLink = document.createElement("a");
    downloadLink.style.display = "none"; 
    downloadLink.href = fileURL;
    downloadLink.download = settings.zipfilename;

    document.body.appendChild(downloadLink);
    downloadLink.click();

    URL.revokeObjectURL(fileURL);
    document.body.removeChild(downloadLink);
}

/**
 * Get the list of pre-existing current databases from the server
 * @returns true or false
 */
async function getExistingDatabaseList() {
    let dlreq = new AppMessage(AppMessage.mtDownload);
    let found = false;

    dlreq.uid = thisUserId;
    dlreq.getexisting = true;
    const response = await fetch(URL_POST_SENDEXISTING, { method: 'POST',
                                 headers: {'Content-Type': 'application/json'},  
                                 body: JSON.stringify(dlreq) }); 
    const data = await response.json();
    const items = data.items.existingdblist;
    if (items.length > 0) {
        setupCommandBody();
        processInfo.textContent = `There are ${items.length} databases available for download:`;
        found = true;
        processitems = [];
        items.forEach((item) => {
            updateCommandBody(item);
            processitems.push(item);
            const ckbid = `${dlchkPrefix}-${item.rowindex}`;
            const ckb = document.getElementById(ckbid);
            ckb.style.display = "inline";
            ckb.addEventListener("change", handleCheckboxChange);
        });
        addItemsMenu.style.display = "none";
        btnProcessCharts.style.visibility = "hidden";
        btnRemove.style.display = "none";
        btnSelectAll.style.display = "inline";
        downloadExisting.style.visibility = "hidden";
    }
    return found;
}

/**
 * See if there are pre-existing databases
 * @returns true if the returned count > 0
 */
async function hasExistingDatabases() {
    const response = await fetch(URL_GET_EXISTINGCOUNT, { method: 'GET' }); 
    const data = await response.json();
    return (data.existingcount > 0);
}

/*********************************************
 *      VARIOUS ELEMENT EVENT HANDLERS
 *********************************************/
txtCommand.addEventListener('input', () => {
    commandSelected();
});
btnUndoCommand.addEventListener('click', () => {
    undoSelection("command");
});

txtChart.addEventListener('input', () => {
    chartSelected();
});
btnUndoChart.addEventListener('click', () => {
    undoSelection("chart");
});

btnAddCommand.addEventListener('click', () => {
    addCommandRequest();
});

btnProcessCharts.addEventListener('click', () => {
    sendCommandsToServer();
});

btnReset.addEventListener('click', () => {
    resetEverything();
});

btnRemove.addEventListener('click', () => {
    removeLastEntry();
});

btnDownload.addEventListener('click', async () => {
    btnSelectAll.style.display = "none";
    btnUnselectAll.style.display = "none";
    btnReset.style.visibility = "hidden";
    await downloadCheckedItems();
});

chkForExisting.addEventListener('change', async () => {
    let inSelfCheckState = false;
    if (!downloadInProgress && !inSelfCheckState) {
        if (chkForExisting.checked) {
            let success = await getExistingDatabaseList();
            if (success) {
                resetCommandOptions();
            }
            else {
                inSelfCheckState = true;
                chkForExisting.checked = false;
            }
        }
        else {
            resetFromDownloadState();
        }
    }
});

btnSelectAll.addEventListener('click', () => {
    let found = false;
    for(let i = 0; i < commandbody.rows.length; i++) {
        const ckbid = `${dlchkPrefix}-${i}`;
        const ckb = document.getElementById(ckbid);
        if (ckb.checkVisibility()) {
            ckb.checked = true;
            found = true;
        }
    }
    if (found) {
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.display = "inline";
        btnProcessCharts.style.visibility = "hidden";
    }
    setDownloadButtonVisible(found);
});

btnUnselectAll.addEventListener('click', () => {
    for(let i = 0; i < commandbody.rows.length; i++) {
        const ckbid = `${dlchkPrefix}-${i}`;
        const ckb = document.getElementById(ckbid);
        ckb.checked = false;
    }
    btnDownload.style.visibility = "hidden";
    btnUnselectAll.style.display = "none";
    btnSelectAll.style.display = "inline";
});
