

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
        this.commandlist = [];
        this.filename = "";
        this.getexisting = false;
        this.dbfilename = "";
        this.uid = "";
    }
}

class MakeCommand {
    constructor(command, chart, rowindex, chartname) {
        this.command = command;
        this.chart = chart;
        this.rowindex = rowindex;
        this.chartname = chartname;
    }
}

const URL_LOCATION = location.hostname;
const URL_PROTOCOL = location.protocol;
const URL_PORT = location.port;

let URL_HOST_BASE = URL_LOCATION;
if (parseInt(URL_PORT) > 0) {
    URL_HOST_BASE += `:${URL_PORT}`;
}

const URL_HOST_PROTOCOL = `${URL_PROTOCOL}//`;
const URL_SERVER = `${URL_HOST_PROTOCOL}${URL_HOST_BASE}`;
const WS_PROTOCOL = URL_PROTOCOL === "https:" ? "wss:" : "ws:";
const URL_GET_CONFIG = `${URL_SERVER}/api/config`;
const URL_GET_EXISTINGCOUNT = `${URL_SERVER}/existingcount`;
const URL_POST_SENDEXISTING = `${URL_SERVER}/sendexisting`;
const URL_GET_STATUS = `${URL_SERVER}/status`;
const URL_POST_MAKE = `${URL_SERVER}/make`;
const URL_POST_DOWNLOAD = `${URL_SERVER}/download`;

const confwindow = document.getElementById("confwindow");
const txtCommand = document.getElementById("txtCommand");
const txtChart = document.getElementById("txtChart");
const commandbody = document.getElementById("commandbody");
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
const btnCancel = document.getElementById("btnCancel");
const chkForExisting = document.getElementById("checkForExisting");
const processInfo = document.getElementById("processInformation");

function showCancelButton(isVisible) {
    if (btnCancel) {
        btnCancel.style.display = isVisible ? "inline-block" : "none";
        btnCancel.disabled = false;
        btnCancel.textContent = "Cancel Job";
    }
    if (btnProcessCharts) {
        if (isVisible) {
            btnProcessCharts.style.display = "none";
            btnProcessCharts.style.visibility = "hidden";
        } else {
            btnProcessCharts.style.display = "";
        }
    }
}
window.showCancelButton = showCancelButton;
window.resetEverything = resetEverything;

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        return decodeURIComponent(parts.pop().split(';').shift());
    }
    return "";
}

function setCookie(name, value, days = 30) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

let thisUserId = getCookie("chartmaker_uid");
let websocket;
let indexlist = [];
let commandpackage = {
    type: "commandpackage",
    commandlist: [],
    uid: thisUserId
};
let processitems = [];
let confcommands = [];
let configuration = {};
let selectedcommand = -1;
let selectedchart = -1;
let blinking = false;
let inResponseView = false;
let fullChartNames = [];
let areaChartNames = [];
let downloadInProgress = false;

const dlchkPrefix = "dlchk";

window.addEventListener("load", () => {
    setupCommandBody();
    populateCommandsDropdown();
});

window.addEventListener("resize", () => {
    console.log("windowresize event");
});

async function getConfigFromServer() {
    try {
        const data = await fetch(URL_GET_CONFIG);
        if (!data.ok) {
            throw new Error(`HTTP error! status: ${data.status}`);
        }
        configuration = await data.json();
        console.log(configuration);
        checkForExistingDatabases();
        setChartNameArrays();
        await checkJobStateOnLoad();
        startWebsocketClient();

    }
    catch (err) {
        console.log(err.message);
    }
}

/**
 * Check if the user has an active or completed job on initial page load
 */
async function checkJobStateOnLoad() {
    try {
        const uid = getCookie("chartmaker_uid");
        if (!uid) return;
        const res = await fetch(`/job-state?uid=${encodeURIComponent(uid)}`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.job) {
                restoreUIFromState(data.job);
            }
        }
    } catch (e) {
        console.warn("Could not check initial job state:", e);
    }
}

/**
 * Restore the application UI and completed download items from persistent job state
 * @param {*} state Job state object from server
 */
function restoreUIFromState(state) {
    if (!state || !state.commandlist || state.commandlist.length === 0) {
        return;
    }

    console.log("Restoring UI from job state:", state.status, state.jobId);
    setupCommandBody();
    inResponseView = true;
    addItemsMenu.style.display = "none";
    commandpackage = new AppMessage(AppMessage.mtCommandPackage);
    commandpackage.commandlist = [...state.commandlist];
    commandpackage.uid = thisUserId;
    processitems = [];

    // Populate rows with chart labels
    state.commandlist.forEach((cmd, idx) => {
        let tr = commandbody.rows[idx];
        if (!tr) return;
        let td1 = tr.children[0];
        let cmdTypeStr = (+cmd.command === 0) ? "Process area chart :" : "Process full chart :";
        td1.textContent = `${cmdTypeStr} ${cmd.chartname}`;
    });

    // Populate completed items
    if (state.completedItems && Array.isArray(state.completedItems)) {
        state.completedItems.forEach((item) => {
            let rowidx = +item.rowindex;
            let tr = commandbody.rows[rowidx];
            if (tr) {
                let td0 = tr.children[0];
                let td1 = tr.children[1];
                let span = td1.firstChild;
                td0.classList.remove("running");
                td1.classList.remove("running");
                span.textContent = item.payload; // elapsed duration
            }
            if (!processitems.some(p => p.rowindex === item.rowindex)) {
                processitems.push(item);
            }
        });
    }

    if (state.status === "queued") {
        blinkSendButton(true);
        showCancelButton(true);
        processInfo.classList.remove("boldred");
        processInfo.classList.add("boldyellow");
        let pos = state.position || 1;
        processInfo.textContent = `Server response: job queued (position #${pos}), waiting for prior job to finish...`;
        btnRemove.style.visibility = "hidden";
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.display = "none";
        btnReset.style.visibility = "hidden";
    }
    else if (state.status === "running") {
        blinkSendButton(true);
        showCancelButton(true);
        processInfo.classList.remove("boldyellow", "boldred");
        processInfo.textContent = `Now processing: ${state.currentChart || "chart"}`;

        if (state.currentRowIndex >= 0 && state.currentRowIndex < commandbody.rows.length) {
            let tr = commandbody.rows[state.currentRowIndex];
            if (tr) {
                tr.children[0].classList.add("running");
                tr.children[1].classList.add("running");
                tr.children[1].firstChild.textContent = "* in progress *";
            }
        }
        btnRemove.style.visibility = "hidden";
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.display = "none";
        btnReset.style.visibility = "hidden";
    }
    else if (state.status === "completed") {
        blinkSendButton(false);
        showCancelButton(false);
        processInfo.classList.remove("boldyellow", "boldred");
        processInfo.textContent = `Total time for chart processing: ${state.totalTime || "Complete"}`;

        // Reveal download checkboxes on every completed row
        processitems.forEach((item) => {
            let ckbid = `${dlchkPrefix}-${item.rowindex}`;
            let ckb = document.getElementById(ckbid);
            if (ckb) {
                ckb.style.display = "inline";
                ckb.checked = false;
                ckb.removeEventListener("change", handleCheckboxChange);
                ckb.addEventListener("change", handleCheckboxChange);
            }
        });

        btnDownload.style.visibility = "visible";
        btnReset.style.visibility = "visible";
        btnProcessCharts.style.visibility = "hidden";
        btnRemove.style.visibility = "hidden";
        btnSelectAll.style.display = "inline";
        btnUnselectAll.style.display = "none";
    }
    else if (state.status === "failed") {
        blinkSendButton(false);
        showCancelButton(false);
        processInfo.classList.remove("boldyellow");
        processInfo.classList.add("boldred");
        processInfo.textContent = "Server response: chart processing failed or was interrupted.";
        btnReset.style.visibility = "visible";
    }
    else if (state.status === "cancelled") {
        blinkSendButton(false);
        showCancelButton(false);
        processInfo.classList.remove("boldyellow");
        processInfo.classList.add("boldred");
        processInfo.textContent = "Server response: chart processing was cancelled by user.";
        btnReset.style.visibility = "visible";
        btnProcessCharts.style.visibility = "visible";
    }
}

/**
 * get the settings object from the server
 */
getConfigFromServer();

/**
 * See if we need to display the show downloadExisting checkbox
 */
async function checkForExistingDatabases() {
    let hasexisting = await hasExistingDatabases();
    if (hasexisting) {
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
    for (let i = 0; i < configuration.fullchartlist.length; i++) {
        let item = configuration.fullchartlist[i][0];
        if (item.includes("DDECUS")) {
            item = configuration.fullchartlist[i][2];
        }
        fullChartNames.push(item.replaceAll("_", " "));
    }

    // Area chart names
    for (let i = 0; i < configuration.areachartlist.length; i++) {
        let item = configuration.areachartlist[i];
        areaChartNames.push(item.replaceAll("_", " "));
    }
};

let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10000;

function updateConnectionStatus(status, text) {
    const el = document.getElementById("connectionStatus");
    if (!el) return;
    el.className = `connectionStatus status-${status}`;
    el.textContent = text;
}

/**
 * Websocket connection and message handling
 */
function startWebsocketClient() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    try {
        let wsurl;
        if (configuration.wsport && configuration.wsport !== configuration.httpport) {
            wsurl = `${WS_PROTOCOL}//${URL_LOCATION}:${configuration.wsport}/ws`;
        } else {
            wsurl = `${WS_PROTOCOL}//${URL_HOST_BASE}/ws`;
        }
        console.log(`OPENING WEBSOCKET: ${wsurl}`);
        updateConnectionStatus("connecting", "● Connecting...");
        websocket = new WebSocket(wsurl);

        websocket.onopen = function (evt) {
            console.log("Websocket CONNECTED.");
            reconnectDelay = 1000;
            updateConnectionStatus("connected", "● Connected");
            if (thisUserId) {
                websocket.send(JSON.stringify({ type: "init", uid: thisUserId }));
            }
        }

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
                        if (message.payload === "success" || message.payload === "accepted") {
                            message.payload = "Server response: chart processing has started...";
                            updateCommandBody(message);
                            showCancelButton(true);
                        }
                        else if (message.payload === "queued") {
                            let position = (message.items && message.items[0] && message.items[0].position) || 1;
                            message.payload = `Server response: job queued (position #${position}), waiting for prior job to finish...`;
                            message.css = ["boldyellow"];
                            updateCommandBody(message);
                            blinkSendButton(true);
                            showCancelButton(true);
                            btnRemove.style.visibility = "hidden";
                            btnSelectAll.style.visibility = "hidden";
                            btnUnselectAll.style.visibility = "hidden";
                            btnReset.style.visibility = "hidden";
                        }
                        else if (message.payload === "cancelled") {
                            message.payload = "Server response: chart processing was cancelled by user.";
                            message.css = ["boldred"];
                            updateCommandBody(message);
                            blinkSendButton(false);
                            showCancelButton(false);
                            btnReset.style.visibility = "visible";
                            btnProcessCharts.style.visibility = "visible";
                        }
                        else if (message.payload === "busy") {
                            message.payload = "Server response: another processing job is already in progress";
                            message.css = ["boldyellow"];
                            updateCommandBody(message);
                            blinkSendButton(false);
                            showCancelButton(false);
                        }
                        else {
                            message.payload = "Server response: status unknown, possible command error";
                            message.css = ["boldred"];
                            updateCommandBody(message);
                            blinkSendButton(false);
                            showCancelButton(false);
                        }
                        break;
                    case AppMessage.mtDownload:
                        updateCommandBody(message);
                        break;
                    case AppMessage.mtSettings:
                        let payload = JSON.parse(message.payload);
                        console.log(payload);
                        break;
                    case AppMessage.mtConnection:
                        thisUserId = message.uid;
                        setCookie("chartmaker_uid", thisUserId, 30);
                        commandpackage = new AppMessage(AppMessage.mtCommandPackage);
                        commandpackage.uid = thisUserId;
                        break;
                    case AppMessage.mtSyncState:
                        console.log("Received job syncstate from server:", message.payload);
                        restoreUIFromState(message.payload);
                        break;
                    case AppMessage.mtCommand:
                    default:
                        console.log(message.payload);
                        break;
                }
            }
            catch (err) {
                console.error("Websocket message parsing error:", err);
            }
        };

        websocket.onerror = function (evt) {
            console.log("Websocket ERROR");
            updateConnectionStatus("connecting", "● Connection Error");
        }

        websocket.onclose = function (evt) {
            console.log("Websocket CLOSED.");
            updateConnectionStatus("disconnected", "● Disconnected (Reconnecting...)");
            if (!reconnectTimer) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
                    startWebsocketClient();
                }, reconnectDelay);
            }
        }
    }
    catch (error) {
        console.log(error);
        updateConnectionStatus("disconnected", "● Offline");
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
    processitems.forEach((item) => {
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
    confwindow.scroll({ left: 0, top: 0 });
    btnReset.style.visibility = "visible";
    btnSelectAll.style.display = "none";
    btnUnselectAll.style.display = "none";
    btnAddCommand.style.display = "block";
    btnRemove.style.display = "inline";
    chkForExisting.checked = false;
    downloadInProgress = false;
    blinking = false;
    showCancelButton(false);
    btnProcessCharts.innerText = "Process Charts";
    btnProcessCharts.classList.remove("start-animation");
    btnProcessCharts.style.visibility = "visible";
    processInfo.classList.remove("boldyellow", "boldred");
    processInfo.textContent = "";
    commandpackage = {
        type: "commandpackage",
        commandlist: [],
        uid: ""
    };
    commandpackage.uid = thisUserId;
    if (thisUserId) {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: "clearjob", uid: thisUserId }));
        } else {
            fetch("/clearjob", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uid: thisUserId })
            }).catch(() => {});
        }
    }
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
        showCancelButton(true);
        try {
            const response = await fetch(URL_POST_MAKE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(commandpackage)
            });
            if (response.ok) {
                const resData = await response.json().catch(() => null);
                if (resData && resData.status === "queued") {
                    processInfo.classList.remove("boldred");
                    processInfo.classList.add("boldyellow");
                    processInfo.textContent = `Server response: job queued (position #${resData.position || 1}), waiting for current job to finish...`;
                }
                resetCommandOptions();
                resetChartOptions();
                btnRemove.style.visibility = "hidden";
                btnSelectAll.style.visibility = "hidden";
                btnUnselectAll.style.visibility = "hidden";
                btnReset.style.visibility = "hidden";
            } else {
                blinkSendButton(false);
                showCancelButton(false);
                processInfo.classList.remove("boldyellow");
                processInfo.classList.add("boldred");
                processInfo.textContent = `Server response: HTTP error ${response.status}`;
            }
        } catch (err) {
            blinkSendButton(false);
            showCancelButton(false);
            processInfo.classList.remove("boldyellow");
            processInfo.classList.add("boldred");
            processInfo.textContent = `Server response: network error (${err.message})`;
        }
    }
}

/**
 * Post a timing message for a completed process
 * @param {*} message 
 */
function postTimingMessaqe(message) {
    showCancelButton(false);
    processInfo.classList.remove("boldyellow", "boldred");
    if (message.css && message.css.length > 0) {
        processInfo.classList.add(...message.css);
    }
    processInfo.textContent = `Total time for chart processing: ${message.payload}`;
    resetCommandOptions();
    resetChartOptions();
    commandpackage = new AppMessage(AppMessage.mtCommandPackage);
    blinkSendButton(false);

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
        resetCommandOptions();
    }
    else if (source === "chart") {
        resetChartOptions();
        if (selectedcommand === 0) {
            populateAreaChartList();
        } else if (selectedcommand === 2) {
            populateFullChartList();
        }
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
        showCancelButton(false);
        btnDownload.style.visibility = "visible";
        btnRemove.style.visibility = "hidden";
        btnProcessCharts.style.visibility = "hidden";
        addItemsMenu.style.visibility = "hidden";
        downloadExisting.style.visibility = "hidden";
        chkForExisting.checked = false;
        btnSelectAll.style.display = "none";
        //btnUnselectAll.style.display = "none";
    }
    else {
        btnDownload.classList.remove("running");
        btnDownload.innerText = "Download Checked Items"
        btnDownload.style.visibility = "hidden";
        btnRemove.style.visibility = "visible";
        btnSelectAll.style.display = "none";
        btnUnselectAll.style.display = "none";
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

    if (selectedcommand === 0 || selectedcommand === 1) {
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
            cmdtext = "Process full chart :";
            list = fullChartNames;
            isfullList = false;
            break;
        // case 3:
        //     cmdtext = "Process full chart :";
        //     list = fullChartNames;
        //     selectedcommand --;
        //     selectedchart = 0;
        //     break;
    }

    let idx = commandpackage.commandlist.length;

    for (let i = idx; i < idx + list.length; i++) {
        let infomessage = new AppMessage(AppMessage.mtInfo);
        let chartname = list[selectedchart];
        infomessage.payload = `${cmdtext} ${chartname}`;
        infomessage.uid = thisUserId;
        updateCommandBody(infomessage);

        let ridx = i + 1;
        let entry = new MakeCommand(selectedcommand, selectedchart, ridx, chartname);
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
        processInfo.classList.remove("boldyellow", "boldred");
        if (message.css && message.css.length > 0) {
            processInfo.classList.add(...message.css);
        }
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
            btnReset.style.visibility = "visible";
            btnRemove.style.visibility = "hidden";
            btnSelectAll.style.visibility = "hidden";
            btnUnselectAll.style.visibility = "hidden";
            btnProcessCharts.style.visibility = "hidden";
            btnDownload.style.visibility = "visible";

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
                let tr, td1, td2;
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
                    td.classList.add(...message.css);
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
    selectedchart = parseInt(txtChart.value, 10);
    if (isNaN(selectedchart)) {
        selectedchart = -1;
    }
    validateAddButton();
}

/**
 * Validate and toggle the Add Chart button
 */
function validateAddButton() {
    if (selectedcommand === 0 || selectedcommand === 1) {
        btnAddCommand.disabled = (selectedchart === -1 || isNaN(selectedchart));
    } else {
        btnAddCommand.disabled = true;
    }
}

/**
 * Set the selected state of a command item
 */
function commandSelected() {
    selectedcommand = parseInt(txtCommand.value, 10);
    if (isNaN(selectedcommand)) {
        selectedcommand = -1;
    }

    if (chkForExisting.checked) {
        chkForExisting.checked = false;
        setupCommandBody();
    }

    switch (selectedcommand) {
        case 0:
            populateAreaChartList();
            break;
        case 1:
            populateFullChartList();
            break;
    }
    validateAddButton();
}

/**
 * Populate the individual area chart list
 */
function populateAreaChartList() {
    resetChartOptions();
    txtChart.innerHTML = '<option value="" disabled selected>-- Select area chart --</option>';
    for (let i = 0; i < configuration.areachartlist.length; i++) {
        let option = document.createElement('option');
        option.value = String(i);
        option.textContent = `${configuration.areachartlist[i].replaceAll("_", " ")}`;
        txtChart.appendChild(option);
    }
    txtChart.disabled = false;
}

/**
 * Populate the full chart list
 */
function populateFullChartList() {
    resetChartOptions();
    txtChart.innerHTML = '<option value="" disabled selected>-- Select full chart --</option>';
    for (let i = 0; i < configuration.fullchartlist.length; i++) {
        let option = document.createElement('option');
        option.value = String(i);
        let item = configuration.fullchartlist[i][0];
        if (i === 5 || i === 6) {
            item = configuration.fullchartlist[i][2];
        }
        option.textContent = item.replaceAll("_", " ");
        txtChart.appendChild(option);
    }
    txtChart.disabled = false;
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
    txtCommand.innerHTML = '<option value="" disabled selected>-- Select an option --</option>';
    const commandList = [
        "Process single area VFR chart",
        "Process single full chart",
    ];
    commandList.forEach((cmd, idx) => {
        let opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = cmd;
        txtCommand.appendChild(opt);
    });
}

/**
 * Reset the command dropdown list
 */
function resetCommandOptions() {
    txtCommand.value = "";
    selectedcommand = -1;
    resetChartOptions();
    validateAddButton();
}

/**
 * Reset the chart dropdown list
 */
function resetChartOptions() {
    selectedchart = -1;
    txtChart.innerHTML = '<option value="" disabled selected>-- Select chart --</option>';
    txtChart.disabled = true;
    validateAddButton();
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
        const response = await fetch(URL_POST_DOWNLOAD, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dlitems)
        });
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
    downloadLink.download = configuration.zipfilename;

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
    const response = await fetch(URL_POST_SENDEXISTING, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dlreq)
    });
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
txtCommand.addEventListener('change', () => {
    commandSelected();
});
txtCommand.addEventListener('input', () => {
    commandSelected();
});
btnUndoCommand.addEventListener('click', () => {
    undoSelection("command");
});

txtChart.addEventListener('change', () => {
    chartSelected();
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
    for (let i = 0; i < commandbody.rows.length; i++) {
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
    for (let i = 0; i < commandbody.rows.length; i++) {
        const ckbid = `${dlchkPrefix}-${i}`;
        const ckb = document.getElementById(ckbid);
        ckb.checked = false;
    }
    btnDownload.style.visibility = "hidden";
    btnUnselectAll.style.display = "none";
    btnSelectAll.style.display = "inline";
});

if (btnCancel) {
    btnCancel.addEventListener('click', async () => {
        btnCancel.disabled = true;
        btnCancel.textContent = "Cancelling...";
        try {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify({ type: "canceljob", uid: thisUserId }));
            }
            await fetch("/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uid: thisUserId })
            });
        } catch (err) {
            console.error("Error cancelling job:", err);
        }
    });
}
