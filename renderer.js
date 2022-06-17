const { ipcRenderer } = require('electron');

let settings;
let cl = document.getElementById("chartlist");
let zr = document.getElementById("zoomrange");
let pq = document.getElementById("pngquality");
let cm = document.getElementById("cleanmerge");
let rw = document.getElementById("renamework");
let btnrun = document.getElementById("run");
let btncancel = document.getElementById("cancel");

document.querySelector('form').addEventListener('click', (event) => {
    if (event.target == btnrun) {
        settings.ChartIndex = cl.selectedIndex;
        settings.ZoomRange = zr.value;
        settings.TiledImageQuality = pq.value;
        settings.CleanMergeFolder = cm.checked;
        settings.RenameWorkArea = rw.checked;
        ipcRenderer.send('form-submission', settings);
    }
    else if (event.target == btncancel) {
        ipcRenderer.send('form-submission', undefined);
    }
});

ipcRenderer.send('variable-request');
ipcRenderer.on('variable-reply', (event, data) => {
    settings = data[0]; 
    let charts = data[1];
    zr.value = settings.ZoomRange;
    pq.value = settings.TiledImageQuality;
    cm.checked = settings.CleanMergeFolder;
    rw.checked = settings.RenameWorkArea;

    charts.ChartTypes.forEach((chart) => {
        let option = document.createElement("option");
        option.value = replaceAll(chart[0], " ", "_");
        option.text = replaceAll(chart[0], "_", " ");
        cl.appendChild(option);
    });
    cl.selectedIndex = settings.ChartIndex;
    console.log(settings);
});

function replaceAll(string, search, replace) {
    return string.split(search).join(replace);
}