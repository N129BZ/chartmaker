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

getSettingsFromServer();

async function checkForExistingDatabases() {
    let hasexisting = await hasExistingDatabases();
    if(hasexisting) {
        downloadExisting.style.visibility = "visible";
    }
    else {
        downloadExisting.style.visibility = "hidden"
    }
}

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

function resetEverything() {
    selectedchart = -1;
    selectedcommand = -1;
    processitems.splice(0, processitems.length);
    addItemsMenu.style.display = "block";
    resetCommandOptions(); 
    resetChartOptions();  
    setupCommandBody();
    setDownloadButtonVisible(false);
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

function setDownloadButtonVisible(isVisible) {
    if (isVisible) {
        btnDownload.style.visibility = "visible";
        btnRemove.style.visibility = "hidden";
        btnProcessCharts.style.visibility = "hidden";
        addItemsMenu.style.visibility = "hidden";
        downloadExisting.style.visibility = "hidden";
        chkForExisting.checked = false;
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.visibility = "inline";
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

function addCommandRequest() {
    if (inResponseView) {
        setupCommandBody();
    }

    if (selectedcommand === -1) {
        //alert("You must first select a command to add!")
        return;
    }

    if (selectedcommand === 0 || selectedcommand === 2) {
        if (txtChart.value === "") {
            //alert("You must select a chart for the selected command");
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
        let entry = { command: selectedcommand, chart: selectedchart, rowindex: ridx };
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
            td1.textContent = message.dbfilename;
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

function populateAreaChartList() {
    resetChartOptions();
    for (let i = 0; i < settings.areachartlist.length; i++) {
        let option = document.createElement('option');
        option.value = `${settings.areachartlist[i].replaceAll("_", " ")}`;
        chartOptions.appendChild(option);
    }
}

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

function setupCommandBody() {
    inResponseView = false;
    commandbody.innerText = "";
    for (let i = 0; i < 70; i++) {
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

function resetCommandOptions() {
    txtCommand.value = "";
    selectedcommand = -1;
    resetChartOptions();    
}

function resetChartOptions() {
    selectedchart = -1;
    txtChart.value = "";
    chartOptions.innerText = "";
}

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
                //resetChartOptions();
            }
            else {
                inSelfCheckState = true;
                chkForExisting.checked = false;
                //alert("No databases on the server, nothing to list!");
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
    //setDownloadButtonVisible(false);
    btnDownload.style.visibility = "hidden";
    btnUnselectAll.style.display = "none";
    btnSelectAll.style.display = "inline";
});

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

async function hasExistingDatabases() {
    let dlreq = new AppMessage(AppMessage.mtDownload);
    dlreq.uid = thisUserId;
    dlreq.getexisting = true;
    const response = await fetch(URL_POST_SENDEXISTING, { method: 'POST',
                                 headers: {'Content-Type': 'application/json'},  
                                 body: JSON.stringify(dlreq) }); 
    const data = await response.json();
    return (data.items.existingdblist.length > 0);
}