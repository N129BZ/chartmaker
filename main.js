const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const runProcessing = require('./imageprocessing.js');

let appwindow;
let settings = loadSettings();
let charttypes = loadChartTypes();
let finishEvent = null;

const createWindow = () => {
    appwindow = new BrowserWindow({
        width: 750,
        height: 380,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
        }
    });
    appwindow.on('close', (event) => {
        if (app.quitting) {
            appwindoww = null
        } 
        else {
            event.preventDefault()
            appwindow.hide()
        }
    })

    appwindow.loadFile('index.html')

    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    Menu.setApplicationMenu(mainMenu);
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', () => { win.show() })

app.on('before-quit', () => app.quitting = true)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

const mainMenuTemplate = [
    {
        label: 'File',
        submenu: [
            { 
                label: 'Quit', 
                accelerator: process.platform !== 'darwin' ? 'Ctrl+Q' : 'Command+Q',
                click() {
                    app.quit();
                }
            }
        ],
    },
    {
        label: 'Process',
        submenu: [
            {
                label: 'Run',
                accelerator: process.platform !== 'darwin' ? 'Ctrl+R' : 'Command+R',
                click() {
                    let settings = loadSettings();
                    launchRunProcessing(settings);
                }
            }
        ]
    }
];

ipcMain.on('variable-request', (event) => {
    let data = [];
    data.push(settings);
    data.push(charttypes);
    event.sender.send('variable-reply', data);
});

ipcMain.on('form-submission', (event, newsettings) => {
    if (newsettings == undefined) {
        app.quit();
    }
    else {
        updateSettings(newsettings);
        appwindow.hide();
        launchRunProcessing(newsettings);
    }
});

if (process.platform == 'darwin') {
    mainMenuTemplate.unshift({});
}

function launchRunProcessing(settings) {
    runProcessing(settings);
}

function loadSettings() {
    let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
    return JSON.parse(rawdata);
}

function loadChartTypes() {
    let rawdata = fs.readFileSync(`${__dirname}/charttypes.json`);
    return JSON.parse(rawdata.toString());
}

function updateSettings(newsettings) {
    console.log("Updating settings.json");
    settings.ChartIndex = newsettings.ChartIndex;
    settings.TiledImageQuality = newsettings.TiledImageQuality;
    settings.ZoomRange = newsettings.ZoomRange;
    settings.CleanMergeFolder = newsettings.CleanMergeFolder;
    settings.RenameWorkArea = newsettings.RenameWorkArea;

    let data = { 
                 "ChartUrlTemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip",
                 "TiledImageQuality": settings.TiledImageQuality,
                 "CleanMergeFolder": settings.CleanMergeFolder,
                 "RenameWorkArea": settings.RenameWorkArea,
                 "ZoomRange": settings.ZoomRange,
                 "ChartIndex": settings.ChartIndex
                };
    let stringToWrite = JSON.stringify(data, null, '  ').replace(/: "(?:[^"]+|\\")*",?$/gm, ' $&');
    fs.writeFileSync(`${__dirname}/settings.json`, stringToWrite,{flag: 'w+'});
}
