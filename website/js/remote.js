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


var fclist = document.getElementById("fclist");
var aclist = document.getElementById("aclist");

var settings = {};

$.get({
    async: false,
    type: "GET",
    url: URL_GET_SETTINGS,
    success: (data) => {
        try {
            settings = JSON.parse(data);
            displayLists();
        }
        catch(err) {
            console.log(err);
        }
    },
    error: (xhr, ajaxOptions, thrownError) => {
        console.error(xhr.status, thrownError);
    }
});

// $.post({
    
//     console.log("request submitted");
// });

function submitRequest() {

    let cmdobj = document.getElementById("command");
    let chtobj = document.getElementById("chart");

    //$.post("/data", {commandlist:[{ command: cmdval, chart: chtval }]});
}

function displayLists() {
    let  i = 0;
    let item = "";
    let row = Object;

    for (i = 0; i < settings.fullchartlist.length; i++) {
        if (i == 5 || i == 6) {
            item = `${i} = ${settings.fullchartlist[i][2].replaceAll("_", " ")}`;
            row = fclist.insertRow();
        }
        else {
            item = `${i} = ${settings.fullchartlist[i][0].replaceAll("_", " ")}`;
            row = fclist.insertRow();
        }
        row.textContent = item;
    }

    for (i = 0; i < settings.areachartlist.length; i++) {
        item = `${i} = ${settings.areachartlist[i]}`;
        row = aclist.insertRow();
        row.textContent = item;
    }
}

$(() => {



});
