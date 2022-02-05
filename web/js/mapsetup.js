let URL_HOST_BASE           = window.location.hostname + (window.location.port ? ':' + window.location.port : '');
let URL_HOST_PROTOCOL       = window.location.protocol + "//";
let URL_SERVER              = `${URL_HOST_PROTOCOL}${URL_HOST_BASE}`;
let URL_GET_SETTINGS        = `${URL_SERVER}/getsettings`;
let URL_RUN_PROCESS         = `${URL_SERVER}/runprocess`;
var URL_WSRUN_INFO          = `ws://localhost:9090`;

let settings;
let chartval;
let pngquant;

let sl_selectlist = document.getElementById("chartlist");
let tb_pngquality = document.getElementById("pngquality");
let cb_cleanmerge = document.getElementById("cleanmerge");
let cb_renamework = document.getElementById("renamework")
let tb_zoomrange = document.getElementById("zoomrange");
let btn_process = document.getElementById("processbutton");
let lbl_runinfo = document.getElementById("runinfo");

$.ajax({
    async: false,
    type: "GET",
    url: URL_GET_SETTINGS,
    success: function(data) {
        try {
            settings = JSON.parse(data);
            updateControls();
        }
        catch(err) {
            console.log(err);
        }
    }
});

$(() => {
    var websock = new WebSocket(URL_WSRUN_INFO);
    websock.onmessage = onRunInfo;
});

function onRunInfo(e) {
    lbl_runinfo.innerHTML = e.data;
    console.log(e.data);
}

function updateControls() {
    sl_selectlist.value = settings.ChartType;
    tb_pngquality.value = settings.TiledImageQuality;
    tb_zoomrange.value = settings.ZoomRange;
    cb_cleanmerge.checked = settings.CleanMergeFolder;
    cb_renamework.checked = settings.RenameWorkArea;
}

function processChart() {
    btn_process.style.visibility = "hidden"; 
    lbl_runinfo.style.visibility = "visible";
    let vals = `{ "charttype": "`
              + `${sl_selectlist.value}",`
              + `"pngquality": "${tb_pngquality.value}",`
              + `"zoomrange": "${tb_zoomrange.value}",`
              + `"cleanmerge": ${cb_cleanmerge.checked},`
              + `"renamework": ${cb_renamework.checked}}`;

    // Creating a XHR object
    let xhr = new XMLHttpRequest();

    xhr.open("POST", URL_RUN_PROCESS, true);

    // Set the request header i.e. which type of content you are sending
    xhr.setRequestHeader("Content-Type", "application/json");
 
    // Create a state change callback
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            console.log("Chart Process Started!");
        }
    };

    // Converting JSON data to stringlet jobj = JSON.parse(req.body);
        
    //var data = JSON.stringify(vals);

    // Sending data with the request
    xhr.send(vals);
}


