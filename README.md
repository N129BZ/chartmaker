# chartmaker - Download FAA VFR and IFR digital raster charts and translate into mbtiles databases for other mapping applications

### Requirements: Sqlite3 (tested with v3.40.1), Python (tested with 3.11.4) , Node v18.16.0 (minimum), Perl v5.36.0, pngquant 2.17.0, curl, and GDAL v3.6.2 (minimum)

#### Installation:
1.) This node.js application is designed to run on Linux, and also runs well on **WSL2** (Windows Subsystem for Linux)    
2.) Install all required programs as referred to above 
3.) Clone the repository, change directory to **chartmaker**, open a terminal and enter **npm install**        
4.) Give execute permissions to **perlsetup.sh** shell script and run it to install perl dependencies           
5.) Install the **pngquant** png image compression utility: (deb example) **sudo apt install pngquant**      
6.) Run the application in a terminal with the command **node make**                 
7.) Go do something else... depending on the number of charts and image quality, the process can take several hours to complete.     

#### chartdates.json
The FAA publishes charts 20 days *before* the official chart date, and chartmaker will automatically select the nearest chart date from this file of official FAA chart 56-day release dates, all the way up to the year 2044. If the next chart date is more than 20 days out, chartmaker will get the current chart date.                   
#### settings.json
* Edit the values in **chartprocessindexes** with any ordinal index numbers from the **faachartnames** list for charts you want to process, in the order you want them processed. The default is all charts in the index list, in index order. The setting array **faachartnames** are the actual zip filenames the FAA uses and are for reference only. **Changes to the downloadtemplate or faachartnames, layertypes, and tiledrivers lists are not recommended!**    
* The zoom range value can either be in the format **n-n**, or you can use a single zoom level **n**                
* You can change the **tileimagequality** percentage from ***1*** up to ***100*** and **tiledriverindex** index to ***2*** (webp) to reduce mbtiles file size. The smaller the percentage, the fuzzier the chart will be.   
  * The tiledimagequality setting works for both **png** and **webp** images.  
* To save disk space, you can set **cleanprocessfolders** to true. 
  * The merge and/or pngquant work folders will be many gigabytes for the entire chart set and are not needed once processing is complete
* To preserve the processed databases, you can set **renameworkarea** to true. This will rename the **workarea** folder to include the processed chart date so the next run will not overwrite the folder.

#### settings values
* ***attribution*** is a database metadata value that many mapping applications use for acknowledgement of the database creator*   
```
"attribution": "Aviation charts <a href='https://github.com/n129bz/chartmaker'>github.com/n129bz/chartmaker</a>"   
```   
* ***wget download templates,*** values inside brackets <> are programmatically replaced with values to match FAA's file names*       
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
* ***tile image quality percentage,*** tileimagequality has a huge effect on png processing time, not quite as much with webp*    
```
"tileimagequality" : 80   <- percentage (1-100) greatly affects processing speed and database size
"zoomrange" : "0-11"      <- range of overviews to produce, higher takes longer and can make db huge
```   
* ***chartprocessindexes*** control which chart types to process, the array values correspond to their ordinal position in the faachartnames list, NOTE: any actual alias name should not contain any spaces*   
```
"chartprocessindexes": [0,1,2,3,4,5], <- charts represented by indexes 0-5 will be processed, in this order   
"faachartnames": [   
    ["Grand_Canyon", "vfr", ""],      <- as in [FAA chart file name, type, no alias needed for vfr charts]   
    ["Helicopter", "vfr", ""],   
    ["Caribbean", "vfr", ""],   
    ["Terminal", "vfr", ""],   
    ["Sectional", "vfr", ""],   
    ["DDECUS", "ifr", "Enroute_Low"]  <- aliases for the file DDECUS (which means Digital Data Enroute Continental US)
    ["DDECUS", "ifr", "Enroute_High"]
]
```       
* ***layertypeindex*** controls the layertype and therefore how it will be rendered on the map*   
```
"layertypeindex": 1,   
"layertypes": [   
    "baselayer",    
    "overlay"   
]
```      
* ***tiledriverindex*** determines the tiledriver type, for example webp produces the smallest image size but png produces the sharpest images*   
```
"tiledriverindex": 2,   
"tiledrivers": [   
    "png",   
    "jpg",   
    "webp"   
]
```   
#### Additional information
The chart zip files are downloaded from the FAA digital raster chart repository and unzipped. After the unzipping process all of the the resultant GEOtiff image names (and their matching tfw world file names) are "normalized" to all lower-case filenames with underscores in place of dashes and spaces and any apostrophes removed. This simplifies the down-stream processing of these files since **GDAL** can interpret spaces as argument separators.   

### ToDo:

**Suggestions welcome!**

#### ***inspired by https://github.com/jlmcgraw/aviationCharts***
