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

var fclist = document.getElementById("fclist");
var aclist = document.getElementById("aclist");
var confwindow = document.getElementById("confwindow");
var command = document.getElementById("command");
var chart = document.getElementById("chart");
var commandlist = document.getElementById("commandlist");
var chartlist = document.getElementById("chartlist");
let conflist = document.getElementById("conflist");

var wss;
var indexlist = [];
var commands = {"commandlist": []};
var confcommands = [];
var settings = {};
var selectedcommand = -1;
var selectedchart = -1;

window.addEventListener("load", (event) => {
    populateCommandList();
});

$.get({
    async: false,
    type: "GET",
    url: URL_GET_SETTINGS,
    success: (data) => {
        try {
            settings = JSON.parse(data);
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
        wss = new WebSocket(wsurl);
        wss.onmessage = (evt) => {
            let message = JSON.parse(evt.data);
            console.log(message);
        }

        wss.onerror = function(evt){
            console.log("Websocket ERROR: " + evt.data);
        }
        
        wss.onopen = function(evt) {
            console.log("Websocket CONNECTED.");
        }
        
        wss.onclose = function(evt) {
            console.log("Websocket CLOSED.");
        }
    }
    catch (error) {
        console.log(error);
    }
    
    if (settings.usestratux) {
        setupStratuxWebsockets();
    }
});

function removeLastEntry() {
    commands.commandlist.pop();
    let lastItem = conflist.lastElementChild;
    conflist.removeChild(lastItem);
}

function submitRequest() {
    $.post(URL_POST_DATA, commands, function(data, status) {
        console.log(data, status);
        alert("Run command sent, clearing command list!");
        conflist.innerHTML = "";
        commands = {"commandlist": []};
    });
}

function addSubmitRequest() {
    let entry = { "command": selectedcommand, "chart": selectedchart };
    let confentry = command.value;
    if (selectedcommand === 0 || selectedcommand === 2) {
        if (chart.value === "") {
            alert("You must select a chart for the selected command");
            return;
        }
    }
    if (chart.value !== "") {
        confentry += `: ${chart.value}`
    }
    commands.commandlist.push(entry); 
    let li = document.createElement('li');
    li.textContent = confentry;
    conflist.appendChild(li);
    selectedchart = -1;
    selectedcommand = -1;
    populateCommandList();
    resetChartList();  
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
            selectedcommand = i; // Found a match, store the index
            break; // Exit the loop as the option is found
        }
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
    commandlist.innerHTML = ""; 
    command.value = "";
}

function resetChartList() {
    chartlist.innerHTML = "";
    chart.value = "";
}
