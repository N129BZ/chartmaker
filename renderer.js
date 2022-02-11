const { ipcRenderer } = require('electron');

let settings;
let cl = document.getElementById("chartlist");
let zr = document.getElementById("zoomrange");
let pq = document.getElementById("pngquality");
let cm = document.getElementById("cleanmerge");
let rw = document.getElementById("renamework");

document.querySelector('form').addEventListener('click', function (event) {
    let btnRun = document.getElementById("run");
    let btnCancel = document.getElementById("cancel");
    if (event.target == btnRun) {
        settings.ChartType = cl.value;
        settings.ZoomRange = zr.value;
        settings.TiledImageQuality = pq.value;
        settings.CleanMergeFolder = cm.checked;
        settings.RenameWorkArea = rw.checked;
        ipcRenderer.send('form-submission', settings);
    }
    else if (event.target == btnCancel) {
        ipcRenderer.send('form-submission', undefined);
    }
});
ipcRenderer.send('variable-request');

ipcRenderer.on('variable-reply', function (event, data) {
    settings = data[0]; 
    let charttypes = data[1];
    zr.value = settings.ZoomRange;
    pq.value = settings.TiledImageQuality;
    cm.checked = settings.CleanMergeFolder;
    rw.checked = settings.RenameWorkArea;

    charttypes.ChartTypes.forEach((chart) => {
        let option = document.createElement("option");
        option.value = replaceAll(chart, " ", "_");
        option.text = replaceAll(chart, "_", " ");
        cl.appendChild(option);
    });
    cl.value = settings.ChartType;
    console.log(settings);
});

function replaceAll(string, search, replace) {
    return string.split(search).join(replace);
}