'use strict'

let URL_LOCATION            =  location.hostname;
let URL_PROTOCOL            =  location.protocol;
let URL_PORT                =  location.port;
let URL_HOST_BASE           =  URL_LOCATION;
if (parseInt(URL_PORT) > 0) {
    URL_HOST_BASE += `:${URL_PORT}`;
}
let URL_HOST_PROTOCOL       = `${URL_PROTOCOL}//`;
let URL_SERVER              = `${URL_HOST_PROTOCOL}${URL_HOST_BASE}`;
let URL_WINSOCK             = `ws://${URL_LOCATION}:`;
let URL_GET_SETTINGS        = `${URL_SERVER}/settings`;
let URL_GET_STATUS          = `${URL_SERVER}/status`;
let URL_POST_DATA           = `${URL_SERVER}/data`;
let URL_GET_DOWNLOAD        = `${URL_SERVER}/download`;

var messagetypes = {};

var fclist = document.getElementById("fclist");
var aclist = document.getElementById("aclist");
var confwindow = document.getElementById("confwindow");
var command = document.getElementById("command");
var chart = document.getElementById("chart");
var commandlist = document.getElementById("commandlist");
var chartlist = document.getElementById("chartlist");
let sendBtn = document.getElementById("send");
let commandbody = document.getElementById("commandbody");
let download = document.getElementById("download");
let dlbutton = document.getElementById("dlbutton");

var thisUserId = "";
var websocket;
var indexlist = [];
var commands = {"commandlist": []};
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

document.addEventListener('keydown', function(event) {
    if (event.shiftKey) {  
        if (event.key === '~') {
            console.log(`Secret key combo shift + '~' was pressed for settings request`);
            websocket.send(JSON.stringify(messagetypes.settings));
        }
    }
});

async function getSettingsFromServer() {
    try {
        const data = await fetch(URL_GET_SETTINGS);
        if (!data.ok) {
            throw new Error(`HTTP error! status: ${data.status}`);
        } 
        settings = await data.json();
        console.log(settings);
        messagetypes = settings.messagetypes;
        setChartNameArrays();
        startWebsocketClient();
    }
    catch(err) {
        console.log(err.message);
    }
}

getSettingsFromServer();

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

        websocket.onmessage = (evt) => {
            let message = JSON.parse(evt.data);
            if (downloadInProgress) {
                addDownloadChunks(message);
            }
            else {
                switch (message.type) {
                    case messagetypes.timing.type: 
                        blinkSendButton(false);
                        postTimingMessaqe(message);
                        break;
                    case messagetypes.info.type:
                        updateCommandBody(message);
                        break;
                    case messagetypes.complete.type:
                    case messagetypes.running.type:
                        updateCommandBody(message);
                        break;
                    case messagetypes.commandresponse.type:
                        if (message.payload === 'success') {
                            message.payload = "Server response: chart processing has started...";
                            updateCommandBody(message);
                        }
                        else {
                            message.payload = "Server response: status unknown, possible command error";
                            message.css = ["boldred"];
                            updateCommandBody(message);
                        }
                        break;
                    case messagetypes.download.type:
                        if (message.completed) {
                            dlbutton.classList.remove("running");
                            dlbutton.innerText = "Download Checked Items";
                            dlbutton.style.visibility = "hidden"; //setDownloadButtonVisible(false);
                        }
                        else {
                            console.log("Zip in progress: ", message)
                        }
                        break;
                    case messagetypes.settings.type:
                        let payload = JSON.parse(message.payload);
                        console.log(payload);
                        break;
                    case messagetypes.connection.type:
                        thisUserId = message.uid;
                        break; 
                    case messagetypes.command.type:
                    default:
                        console.log(message.payload);
                        break;
                }
            }
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

function resetFromDownloadState() {
    console.log("RESET FROM DOWNLOAD HERE: LINE 181");
    processitems.forEach((item) =>{
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        ckb.checked = false;
    });
    setDownloadButtonVisible(false);
}

function postTimingMessaqe(message) {
    let tr = commandbody.rows[0];
    let td = tr.firstChild;
    td.classList.add( ... message.css);
    td.innerText = `Total time for chart processing: ${message.payload}`;
    resetCommandList(); 
    resetChartList(); 
    commands = {"commandlist": []};
    
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

function downloadCheckedItems() {
    let dlitems = { charts: [] };
    dlbutton.classList.add("running");
    dlbutton.innerText = "Download in progress...";
    processitems.forEach((item) => {
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        if (ckb.checked) {
            dlitems.charts.push(item.dbfilename);
        }
    });

    if (dlitems.charts.length > 0) {
        let msg = messagetypes.download;
        msg.items = dlitems;
        msg.uid = thisUserId;
        websocket.send(JSON.stringify(msg));
        console.log(dlitems);
        downloadZipfile(dlitems);
    }

    // now reset all checkboxes to not checked and disable download button
    processitems.forEach((item) => {
        let ckbid = `${dlchkPrefix}-${item.rowindex}`;
        let ckb = document.getElementById(ckbid);
        ckb.checked = false;
    });
}

function setDownloadButtonVisible(isVisible) {
    if (isVisible) {
        dlbutton.style.visibility = "visible";
    }
    else {
        console.trace();
        dlbutton.style.visibility = "hidden";
    }
}

function removeLastEntry() {
    if (commands.commandlist.length > 0) {
        commands.commandlist.pop();
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

function resetEverything() {
    selectedchart = -1;
    selectedcommand = -1;
    processitems = [];
    resetCommandList(); 
    resetChartList();  
    setupCommandBody();
    dlbutton.style.visibility = "hidden"; //setDownloadButtonVisible(false);
    blinking = false;
    sendBtn.innerText = "Send Commands";
    sendBtn.style.backgroundColor = "Blue";
}

function submitCommands() {
    if (commands.commandlist.length > 0) {
        inResponseView = true;
        blinkSendButton(true);
        websocket.send(JSON.stringify(commands));
        resetCommandList();
        resetChartList();  
    }
}

function addCommandRequest() {
    if (inResponseView) {
        setupCommandBody();
    }

    if (selectedcommand == -1) {
        alert("You must first select a command to add!")
        return;
    }

    if (selectedcommand === 0 || selectedcommand === 2) {
        if (chart.value === "") {
            alert("You must select a chart for the selected command");
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
    
    let idx = commands.commandlist.length;
    
    for (let i = idx; i < idx + list.length; i++) {
        let infomessage = settings.messagetypes.info;
        let chartname = list[selectedchart];
        infomessage.payload = `${cmdtext} ${chartname}` ;
        updateCommandBody(infomessage);

        let ridx = i + 1;
        let entry = { command: selectedcommand, chart: selectedchart, rowindex: ridx };
        commands.commandlist.push(entry); 
        if (isfullList) {
            selectedchart = selectedchart + 1; 
        }
        else {
            break;
        }
    }

    selectedchart = -1;
    selectedcommand = -1;
    
    command.value = "";
    chart.value = "";
}

function blinkSendButton(state) {
    if (state === true) {
        blinking = true;
        sendBtn.textContent = "Processing...";
        sendBtn.classList.add('start-animation');
    }
    else {
        blinking = false;
        sendBtn.textContent = "Send Commands";
        sendBtn.classList.remove('start-animation');
        sendBtn.style.backgroundColor = "Blue";
    }
}

function updateCommandBody(message) { 
    if (message.type === "commandresponse") {
        let tr = commandbody.rows[0]; // First row reserved for static title text
        let td = tr.firstChild;
        td.classList.add(... message.css);
        td.innerText = message.payload;
    }
    else {
        if (message.type === "running") {
            let rowidx = +message.rowindex;
            let tr = commandbody.rows[rowidx];
            let td = tr.children[0];
            td.classList.add("running");
            td = tr.children[1]; // rightcell
            let span = td.firstChild;
            span.textContent = "* in progress *";
            td.classList.add("running");
        }
        else if (message.type === "complete") {
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
        else {
            // Add the incoming message to the first empty row
            for (let i = 1; i < commandbody.rows.length; i++) {
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
    let item = chart.value;
    for (let i = 0; i < settings.areachartlist.length; i++) {
        if (chartlist.options[i].value === item) {
            selectedchart = i;
            break;
        } 
    }
}

function populateChartList() {
    selectedcommand = -1;
    let item = command.value;

    for(let i = 0; i < commandlist.options.length; i++) {
        if (commandlist.options[i].value === item) {
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
    resetChartList();
    for (let i = 0; i < settings.areachartlist.length; i++) {
        let option = document.createElement('option');
        option.value = `${settings.areachartlist[i].replaceAll("_", " ")}`;
        chartlist.appendChild(option);
    }
}

function populateFullChartList() {
    resetChartList();
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
        chartlist.appendChild(option)
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
        if (i === 0) {
            td.setAttribute("colspan", "2");
            td.innerText = "Command list";
            td.classList.add("boldgreen");
        }   
        tr.appendChild(td);

        td = document.createElement("td");
        nmid = `rightcell-${i}`;
        td.name = nmid;
        td.id = nmid;
        td.className = "rightcell";
        // Add a checkbox on the right side of the <td> element
        if (i > 0) {
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
        }
        tr.appendChild(td);

        // Now append the new <tr> to the command body
        commandbody.appendChild(tr);
    }

    const children = document.childNodes;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
    }
}

function populateCommandsDropdown() {
    let alist = []; 
    for (let i = 0; i < 4; i++) {
        alist.push(document.createElement('option'));
        alist[i].className = "option";
    }
    alist[0].value = "Process single area VFR chart";
    commandlist.appendChild(alist[0]);
    alist[1].value = "Process all 53 area VFR charts";
    commandlist.appendChild(alist[1]);
    alist[2].value = "Process single full chart";
    commandlist.appendChild(alist[2]);
    alist[3].value = "Process all of the full charts";
    commandlist.appendChild(alist[3]);
}

function resetCommandList() {
    command.value = "";
    selectedcommand = -1;
    selectedchart = -1;
}

function resetChartList() {
    chart.value = "";
    chartlist.innerText = "";
}

async function downloadZipfile(dlitems) {
    try {
        const jsonstring = JSON.stringify(dlitems);
        const urlencoded = encodeURIComponent(jsonstring);
        var url = `${URL_GET_DOWNLOAD}?items=${urlencoded}`;
        
        //const zipfilename = settings.zipfilename;
        const response = await fetch(url); 
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${data.status}`);
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

