# chartmaker - Download FAA VFR and IFR digital raster charts and translate into mbtiles databases for other mapping applications
### (Check out my chart viewing application https://github.com/n129bz/chartserver - also shows Metars, Pireps, Weather, etc.)

### Docker image: ***docker pull n129bz/chartmaker:latest***
### To run the image: ***docker run -it n129bz/chartmaker:latest***
### To launch chartmaker on the docker image: ***node /chartmaker/main*** or, for a specific chart: ***see Wiki for a complete list of possible arguments***

### Requirements: nodejs + npm, sqlite3, python, perl, cpanminus, pngquant, imagemagick, curl, unzip, build-essential, libgdal-dev, libssl-dev, gdal-bin (v3.6.2 minimum)

#### Installation:
1.) This node.js application is designed to run on Linux, and also runs well on **WSL** (Windows Subsystem for Linux) and assumes a pre-existing node js installation   
2.) After installing all requirements, clone this repository, change directory to **chartmaker**, open a terminal and enter **npm install**        
3.) Give execute permissions to **perlinstall.sh** shell script and run it to install all the perl dependencies           
4.) Run the application in a terminal with the command **node main** or to see command line options, **node main --help**    
5.) If not passing a chart number argument, respond to the prompt for what to process    
6.) Go do something else... depending on the number of charts and image quality, the process can take several hours to complete.     

### Process Control Files

#### chartdates.json
The FAA publishes charts 20 days ***before*** the official chart date, and chartmaker will automatically select the nearest chart date from this file of official FAA chart 56-day release dates, all the way up to the year 2044. If the next chart date is more than 20 days out, chartmaker will get the current chart date.                   
#### settings.json
* Edit the values in **chartprocessindexes** with any ordinal index numbers from the **faachartnames** list for charts you want to process, in the order you want them processed. The default is all charts in the index list, in index order. The setting array **faachartnames** are the actual zip filenames the FAA uses and are for reference only. **Changes to the downloadtemplates, faachartnames, layertypes, or tiledrivers lists WILL BREAK THE APPLICATION!**    
* The zoom range value can either be in the format **n-n**, or you can use a single zoom level **n**                
* You can change the **tileimagequality** percentage from ***1*** up to ***100*** and **tiledriverindex** index to ***2*** (webp) to reduce mbtiles file size. The smaller the percentage, the fuzzier the chart will be at high zoom levels.   
  * The tiledimagequality setting works for both **png** and **webp** images. Percentages as low as 30% will still produce highly readable charts and ***significantly*** reduce database size.     
* To save disk space, you can set **cleanprocessfolders** to true. 
  * The merge and/or pngquant work folders will be many gigabytes for the entire chart set and are not needed once processing is complete
* To preserve the processed databases, you can set **renameworkarea** to true. This will rename the **workarea** folder to include the processed chart date so the next run will not overwrite the folder.

#### settings.json values
* ***attribution*** is a database metadata value that many mapping applications use for acknowledgement of the database creator      
```
"attribution": "Aviation charts <a href='https://github.com/n129bz/chartmaker'>github.com/n129bz/chartmaker</a>"   
```   
* ***curl download templates,*** values inside brackets <> are programmatically replaced with values to match FAA's file names       
```
"vfrdownloadtemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip"   
"ifrdownloadtemplate": "https://aeronav.faa.gov/enroute/<chartdate>/<charttype>.zip"
"vfrindividualtemplate": "https://aeronav.faa.gov/visual/<chartdate>/sectional-files/<charttype>.zip"    
```  
* ***application flags***   
```
"renameworkarea": false       <- if true, will append chart date to the working folder name  
"logtofile": true             <- if true will produce a file "debug.log"  
"cleanprocessfolders": false  <- if true then working folders are removed after processing
```     
* ***tile image quality percentage,*** tileimagequality has a huge effect on png processing time, not quite as much with webp    
```
"tileimagequality" : 80   <- percentage (1-100) greatly affects processing speed and database size
"zoomrange" : "1-12"      <- range of overviews to produce, higher takes longer and can make db huge
```   
* ***chartprocessindexes*** control which chart types to process if you do not pass a chart number argument and you respond to the subsequent prompt with a "0". In this case each faachartname index in the array will be processed.
* ***faachartnames*** is an array with 3 values: FAA chart name, chart type, and an alias (not used for vfr charts.) The chartprocessindexes array values correspond to the ordinal position (zero-based) in the faachartnames list.   
**WARNING: Editing of any of these faachartnames values will break the application.**   
```
"chartprocessindexes": [0,1,2,3,4,5,6], <- charts represented by indexes, default is all 6 will be processed, in this order (order can be changed or indexes removed) 
"faachartnames": [   
    ["Sectional", "vfr", ""],    <- as in [FAA chart name, chart type, alias] (NOTE no alias used for vfr charts)  
    ["Caribbean", "vfr", ""],
    ["Grand_Canyon", "vfr", ""],     
    ["Terminal", "vfr", ""],   
    ["Helicopter", "vfr", ""],   
    ["DDECUS", "ifr", "Enroute_Low"]  <- aliases are required for DDECUS (which means Digital Data Enroute Continental US)
    ["DDECUS", "ifr", "Enroute_High"]
]
```
* ***vfrindividualcharts*** is a list of all 53 VFR area charts and is what the application uses for individual chart processing.    
**WARNING: Editing any of these values will cause individual chart processing to fail.**
```
"vfrindividualcharts": [
    [1, "Albuquerque"],
    [2, "Anchorage"],
    [3, "Atlanta"],
    [4, "Bethel"],
    [5, "Billings"],
    [6, "Brownsville"],
    [7, "Cape_Lisburne"],
    [8, "Charlotte"],
    [9, "Cheyenne"],
    [10, "Chicago"],
    [11, "Cincinnati"],
    [12, "Cold_Bay"],
    [13, "Dallas-Ft_Worth"],
    [14, "Dawson"],
    [15, "Denver"],
    [16, "Detroit"],
    [17, "Dutch_Harbor"],
    [18, "El_Paso"],
    [19, "Fairbanks"],
    [20, "Great_Falls"],
    [21, "Green_Bay"],
    [22, "Halifax"],
    [23, "Hawaiian_Islands"],
    [24, "Houston"],
    [25, "Jacksonville"],
    [26, "Juneau"],
    [27, "Kansas_City"],
    [28, "Ketchikan"],
    [29, "Klamath_Falls"],
    [30, "Kodiak"],
    [31, "Lake_Huron"],
    [32, "Las_Vegas"],
    [33, "Los_Angeles"],
    [34, "McGrath"],
    [35, "Memphis"],
    [36, "Miami"],
    [37, "Montreal"],
    [38, "New_Orleans"],
    [39, "New_York"],
    [40, "Nome"],
    [41, "Omaha"],
    [42, "Phoenix"],
    [43, "Point_Barrow"],
    [44, "Salt_Lake_City"],
    [45, "San_Antonio"],
    [46, "San_Francisco"],
    [47, "Seattle"],
    [48, "Seward"],
    [49, "St_Louis"],
    [50, "Twin_Cities"],
    [51, "Washington"],
    [52, "Western_Aleutian_Islands"],
    [53, "Wichita"] 
]
```    
* ***layertypeindex*** controls the layertype and therefore how it will be rendered on a map, for example If you will be overlaying an OSM map with your chartmaker map   
```
"layertypeindex": 1,   
"layertypes": [   
    "baselayer",    
    "overlay"   
]
```      
* ***tiledriverindex*** determines the tiledriver type, for example webp produces the smallest image size but png produces the sharpest images   
```
"tiledriverindex": 0,   
"tiledrivers": [   
    "png",   
    "jpg",   
    "webp"   
]
```   
#### *Additional information
The chart zip files are downloaded from the FAA digital raster chart repository and unzipped. After the unzipping process all of the the resultant GEOtiff image names (and their matching tfw world file names) are "normalized" to all lower-case filenames with underscores in place of dashes and spaces and any apostrophes removed. This simplifies the down-stream processing of these files since **GDAL** can interpret spaces as argument separators.   

### ToDo:

**Suggestions welcome!**

#### ***inspired by https://github.com/jlmcgraw/aviationCharts***
