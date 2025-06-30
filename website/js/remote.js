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
    setupCommandBody();
    populateCommandsDropdown();
});

document.addEventListener('keydown', function(event) {
    if (event.shiftKey) {  
        if (event.key === '~') {
            console.log(`Secret key combo shift + '~' was pressed for settings request`);
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
                    postTimeTable(message);
                    break;
                case messagetypes.info.type:
                    addMessageToCommandbody(message);
                    break;
                case messagetypes.running.type:
                    addMessageToCommandbody(message);
                    break;
                case messagetypes.response.type:
                    if (message.payload === 'success') {
                        message.payload = "Server response: chart processing has started...";
                        addMessageToCommandbody(message);
                    }
                    else {
                        message.payload = "Server response: status unknown, possible command error";
                        addMessageToCommandbody(message);
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

function setupCommandBody() {
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
    let msgtt = messagetypes.timing;
    msgtt.payload = "Chart processing times:"
    addMessageToCommandbody(msgtt);
    let times = message.payload.processtimes;
    for (let i = 0; i < times.length; i++) {
        let lmsg = messagetypes.info;
        lmsg.payload = times[i].timing;
        addMessageToCommandbody(lmsg);
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
    resetCommandList(); 
    resetChartList();  
    setupCommandBody();
    blinking = false;
    sendBtn.innerText = "Send Commands";
    sendBtn.style.backgroundColor = "Blue";
}

function submitCommands() {
    if (commands.commandlist.length > 0) {
        inResponseView = true;
        blinkSendButton(true);
        websocket.send(JSON.stringify(commands));
        commands = {"commandlist": []};
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

    let infomessage = settings.messagetypes.info;
    infomessage.payload = command.value;
    
    if (chart.value !== "") {
        infomessage.payload += ` : ${chart.value}`
    }
    addMessageToCommandbody(infomessage);
    
    let idx = commands.commandlist.length;
    let entry = { command: selectedcommand, chart: selectedchart };
    commands.commandlist.push(entry); 

    selectedchart = -1;
    selectedcommand = -1;
    
    command.value = "";
    chart.value = "";
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

function addMessageToCommandbody(message) { //(line, usebold = false, colorclass = 'none') {
    for (let i = 0; i < commandbody.rows.length; i++) {
        let tr = commandbody.rows[i];
        if (i > 0) {
            let lastrow = commandbody.rows[i -1];
            let lasttd = lastrow.firstChild;
            if (lasttd.classList.contains("runningchart")) {
                lasttd.classList.remove("runningchart");
                lasttd.innerText = lasttd.innerText.replace("Now", "Finished");
            };
        }
        let td = tr.firstChild;
        if (td.innerText === "") { 
            td.classList.add(... message.css);
            td.textContent = message.payload;
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
    commandlist.innerText = ""; 
    command.value = "";
    selectedcommand = -1;
    selectedchart = -1;
}

function resetChartList() {
    chartlist.innerText = "";
    chart.value = "";
}
