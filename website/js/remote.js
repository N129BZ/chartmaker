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


var fulllist = document.getElementById("fulllist");
var arealist = document.getElementById("arealist");
var settings = {};

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

function displayLists() {
    let  i = 0;
    for (i = 0; i < settings.fullchartlist.length; i++) {
        
    }

    for (i = 0; i < settings.areachartlist.length; i++) {

    }
}

$(() => {



});
