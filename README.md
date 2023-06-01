# chartmaker - Download FAA VFR and IFR digital raster charts and translate into mbtiles databases

### Requirements: Python 3, Node.js, Perl, pngquant, and GDAL v3.6.2

### Instructions:

1.) This node.js application is designed to run on Linux, and also runs on **WSL2** (Windows Subsystem for Linux)         
2.) Clone the repository, change directory to **chartmaker**, open a terminal and enter **npm install**        
3.) Give execute permissions to **perlsetup.sh** shell script and run it to install perl dependencies           
4.) Install the **pngquant** png image compression utility: **sudo apt install pngquant**      
5.) Run the application in a terminal with the command***** node make *****              
6.) Go do something else... depending on the desired chart, the process can take several hours to complete.     

### Settings.json

Since the FAA publishes charts 20 days *before* the official chart date, this application will automatically select the appropriate chart date from the list of official FAA chart dates in the chartdates.json file.                  

* Edit the values in **chartprocessindexes** with any ordinal index numbers from the **faachartnames** list for charts you want to process, in the order you want them processed. The default is all charts in the index list, in index order. The setting array **faachartnames** are the actual zip filenames the FAA uses and are for reference only. **Changes to the downloadtemplate or faachartnames, layertypes, and tiledrivers lists are not recommended!**    
* The zoom range value can either be in the format **n-n**, or you can use a single zoom level **n**                
* You can change the **tiledimagequality** percentage from ***1*** up to ***100*** and **tiledriverindex** index to ***2*** (webp) to reduce mbtiles file size. The smaller the percentage, the fuzzier the chart will be.   
  * The tiledimagequality setting works for both **png** and **webp** images.  
* To save disk space, you can set **cleanprocessfolders** to true. 
  * The merge and/or pngquant work folders will be many gigabytes for the entire chart set and are not needed once processing is complete
* To preserve the processed databases, you can set **renameworkarea** to true. This will rename the **workarea** folder to include the processed chart date so the next run will not overwrite the folder.

### Additional information

The chart zip files are downloaded from the FAA digital raster chart repository and unzipped. The unzipping process will normalize the resultant GEOtiff images and their matching tfw world files to all lower-case filenames with underscores in place of dashes and spaces.     

As of May 13 2023, the official chart release is for **04-20-2023. You can view those release dates up to the year 2044 in the chartdates.json file. Also note that the FAA publishes these chart files *20 days before* an official release date.**        

**Values in settings.json:**

* ***attribution** is whatever link or other info you want on the bottom right corner of a map*   
```
"attribution": "Aviation charts <a href='https://github.com/n129bz/chartmaker'>github.com/n129bz/chartmaker</a>"   
```   
* ***wget download templates,** values inside brackets <> are replaced with values to match FAA's file names*       
```
"vfrdownloadtemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip"   
"ifrdownloadtemplate": "https://aeronav.faa.gov/enroute/<chartdate>/<charttype>.zip"
```  
* ***application flags***   
```
"renameworkarea": false       <- if true, will append chart date to the working folder name  
"logtofile": true             <- if true will produce a file "debug.log"  
"cleanprocessfolders": false  <- if true then working folders are removed after processing
```     
* ***tiled image processing values,** tileimagequality has a huge effect on png processing time, not quite as much with webp*    
```
"tileimagequality" : 80   <- percentage (1-100) greatly affects processing speed and database size
"zoomrange" : "0-11"      <- range of overviews to produce, higher takes longer and can make db huge
```   
* ***chartprocessindexes** control which chart types to process, the array values correspond to their ordinal position in the faachartnames list, NOTE: any actual alias name should not contain any spaces*   
```
"chartprocessindexes": [0,1,2,3,4,5], <- charts represented by indexes 0-5 will be processed, in this order   
"faachartnames": [   
    ["Grand_Canyon", "vfr", ""],      <- as in [FAA chart file name, type, no alias needed for vfr charts]   
    ["Helicopter", "vfr", ""],   
    ["Caribbean", "vfr", ""],   
    ["Terminal", "vfr", ""],   
    ["Sectional", "vfr", ""],   
    ["DDECUS", "ifr", "Enroute_Low"]  <- alias for the file DDECUS (which means Digital Data Enroute Continental US)   
]
```       
* ***layertypeindex** controls the layertype and therefore how it will be rendered on the map*   
```
"layertypeindex": 1,   
"layertypes": [   
    "baselayer",    
    "overlay"   
]
```      
* ***tiledriverindex** determines the tiledriver type, for example webp produces the smallest image size but png produces the sharpest images*   
```
"tiledriverindex": 2,   
"tiledrivers": [   
    "png",   
    "jpg",   
    "webp"   
]
```   
    
### ToDo:

Add IFR charts, etc.    

#### ***inspired by https://github.com/jlmcgraw/aviationCharts***
