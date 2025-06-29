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

var websocket;
var indexlist = [];
var commands = {"commandlist": []};
var confcommands = [];
var settings = {};
var selectedcommand = -1;
var selectedchart = -1;
var blinking = false;
var inResponseView = false;

window.addEventListener("load", (event) => {
    setupCommandTable();
    populateCommandList();
});

document.addEventListener('keydown', function(event) {
    if (event.shiftKey) { // Check if the Shift key is pressed.
        // Shift key is down, now check for specific shifted characters or any character.
        if (event.key.length === 1 && event.key.match(/[~]/)) { // Check if it's a shifted character.
            console.log(`Secret key: "${event.key}" for settings was pressed!`); // Update the output paragraph.
            websocket.send(JSON.stringify(messagetypes.settings));
        }
    }
});

$.get({
    async: false,
    type: "GET",
    url: URL_GET_SETTINGS,
    success: (data) => {
        try {
            settings = JSON.parse(data);
            messagetypes = settings.messagetypes;
        }
        catch(err) {
            console.log(err);
        }
    },
    error: (xhr, ajaxOptions, thrownError) => {
        console.error(xhr.status, thrownError);
    }
});

/**
 * Websocket connection and message handling
 */
 $(() => { 
    try {
        let wsurl = `${URL_WINSOCK}${settings.wsport}`;
        console.log(`OPENING: ${wsurl}`);
        websocket = new WebSocket(wsurl);

        websocket.onmessage = (evt) => {
            let message = JSON.parse(evt.data);
            switch (message.type) {
                case messagetypes.timing.type: 
                    blinkSendButton(false);
                    postTimeTable(message.payload);
                    break;
                case messagetypes.info.type:
                    addLineToCommandbody(message.payload);
                    break;
                case messagetypes.response.type:
                    if (message.payload === 'success') {
                        addLineToCommandbody("Server response: chart processing has started...", true);
                    }
                    else {
                        addLineToCommandbody("Server response: status unknown, possible command error", true);
                    }
                    break;
                case messagetypes.settings.type:
                    let payload = JSON.parse(message.payload);
                    console.log(payload);
                    break;
                case messagetypes.command.type:
                default:
                    console.log(message.payload);
                    break;
                // end of case work
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
});

function setupCommandTable() {
    inResponseView = false;
    commandbody.innerText = "";
    for (let i = 0; i < 53; i++) {
        let tr = document.createElement("tr");
        tr.setAttribute("tag", i.toString());
        tr.className = "tablerow";
        let td = document.createElement("td");
        td.className = "tablecell";
        tr.appendChild(td);
        commandbody.appendChild(tr);
    }
}

function postTimeTable(message) {
    addLineToCommandbody("Processing times for submitted commands:", true);
    for (let i = 0; i < message.processtimes.length; i++) {
        let line = message.processtimes[i].timing;
        addLineToCommandbody(line);
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
    populateCommandList();
    resetChartList();  
    setupCommandTable();
    blinking = false;
    sendBtn.innerText = "Send Commands";
    sendBtn.style.backgroundColor = "Blue";
}

function submitRequest() {
    if (commands.commandlist.length > 0) {
        inResponseView = true;
        blinkSendButton(true);
        websocket.send(JSON.stringify(commands));
        commands = {"commandlist": []};
        // $.post(URL_POST_DATA, commands, function(data, status) {
        //     console.log(data);
        //     if (status === 'success') {
        //         addLineToCommandbody("Server response: chart processing has started...", true);
        //     }
        //     commands = {"commandlist": []};
        // });
    }
}

function blinkSendButton(state) {
    if (state === true) {
        blinking = true;
        sendBtn.textContent = "Processing...";
        sendBtn.classList.remove('stop-animation')
        sendBtn.classList.add('start-animation');
    }
    else {
        blinking = false;
        sendBtn.textContent = "Send Commands";
        sendBtn.classList.remove('start-animation');
        sendBtn.classList.add('stop-animation')
        sendBtn.style.backgroundColor = "Blue";
    }
}

function addSubmitRequest() {
    if (selectedcommand == -1) {
        alert("You must first select a command to add!")
        return;
    }
    if (inResponseView) {
        setupCommandTable();
    }
    let entry = { command: selectedcommand, chart: selectedchart };
    let confentry = `${selectedcommand}: ${command.value}`;
    if (selectedcommand === 0 || selectedcommand === 2) {
        if (chart.value === "") {
            alert("You must select a chart for the selected command");
            return;
        }
    }
    if (chart.value !== "") {
        confentry += `,  ${selectedchart}: ${chart.value}`
    }

    commands.commandlist.push(entry); 
    
    addLineToCommandbody(confentry);
    selectedchart = -1;
    selectedcommand = -1;
    populateCommandList();
    resetChartList();  
}

function addLineToCommandbody(line, usebold = false) {
    for (let i = 0; i < commandbody.rows.length; i++) {
        let tr = commandbody.rows[i];
        let td = tr.firstChild;
        if (td.innerText === "") { 
            if (usebold === true) {
                td.classList.add('boldline')
                td.textContent = line;
            }
            else {
                td.textContent = line;
            }
            return;
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
        }Red
    }

    if (selectedcommand == 0) {
        populateAreaChartList();
    }
    else if(selectedcommand == 2) {
        populateFullChartList();
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

function populateCommandList() {
    resetCommandList();
    let alist = []; 
    for (let i = 0; i < 4; i++) {
        alist.push(document.createElement('option'));
        alist[i].className = "option";
    }
    alist[0].value = "Process a single area VFR chart";
    commandlist.appendChild(alist[0]);
    alist[1].value = "Process all 53 area VFR charts individually";
    commandlist.appendChild(alist[1]);
    alist[2].value = "Process a single full chart ";
    commandlist.appendChild(alist[2]);
    alist[3].value = "Process all of the full charts";
    commandlist.appendChild(alist[3]);
}

function resetCommandList() {
    commandlist.innerText = ""; 
    command.value = "";
    selectedcommand = -1;
    selectedchart = -1;

}

function resetChartList() {
    chartlist.innerText = "";
    chart.value = "";
}
