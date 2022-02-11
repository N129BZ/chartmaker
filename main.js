const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const runProcessing = require('./imageprocessing.js');

let appwindow;
let settings = loadSettings();
let charttypes = loadChartTypes();

const createWindow = () => {
    appwindow = new BrowserWindow({
        width: 750,
        height: 376,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
        }
    });
    
    appwindow.loadFile('index.html')

    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    Menu.setApplicationMenu(mainMenu);
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
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
                    runProcessing(settings);
                }
            }
        ]
    }
];

ipcMain.on('variable-request', function (event) {
    let data = [];
    data.push(settings);
    data.push(charttypes);
    event.sender.send('variable-reply', data);
});

ipcMain.on('form-submission', function (event, newsettings) {
    if (newsettings == undefined) {
        app.quit();
    }
    else {
        updateSettings(newsettings);
        runProcessing(newsettings);
    }
});

if (process.platform == 'darwin') {
    mainMenuTemplate.unshift({});
}

if (process.env.NODE_ENV !== 'production') {
    mainMenuTemplate.push({
        label: 'Developer Tools',
        submenu: [
            {
                label: 'Toggle DevTools',
                accelerator: process.platform !== 'darwin' ? 'Ctrl+I' : 'Command+I',
                click(item, focusedWindow) {
                    focusedWindow.toggleDevTools();
                }
            },
            {
                role: 'reload'
            }
        ]
    });
}

function loadSettings() {
    let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
    return JSON.parse(rawdata);
}

function loadChartTypes() {
    let rawdata = fs.readFileSync(`${__dirname}/charttypes.json`);
    return JSON.parse(rawdata);    
}

function updateSettings(newsettings) {
    console.log("Updating settings.json");
    settings.ChartType = newsettings.ChartType;
    settings.TiledImageQuality = newsettings.TiledImageQuality;
    settings.ZoomRange = newsettings.ZoomRange;
    settings.CleanMergeFolder = newsettings.CleanMergeFolder;
    settings.RenameWorkArea = newsettings.RenameWorkArea;

    let data = { "ChartUrlTemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip",
                 "HttpPort": settings.HttpPort,
                 "WsPort": settings.WsPort,
                 "TiledImageQuality": settings.TiledImageQuality,
                 "CleanMergeFolder": settings.CleanMergeFolder,
                 "RenameWorkArea": settings.RenameWorkArea,
                 "ZoomRange": settings.ZoomRange,
                 "ChartType": settings.ChartType
                };
    let stringToWrite = JSON.stringify(data, null, '  ').replace(/: "(?:[^"]+|\\")*",?$/gm, ' $&');
    fs.writeFileSync(`${__dirname}/settings.json`, stringToWrite,{flag: 'w+'});
}
