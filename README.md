# Chartmaker - Create VFR and IFR digital raster chart MBTILES databases from downloaded FAA geo-referenced TIF images for OpenLayers or Leaflet mapping applications   

### Run this application in Docker     
Create a new directory, download and place the the docker-compose.yml file in that directory and from that directory, open a terminal and enter the docker compose command ***docker compose pull && docker compose up*** (the web server default is ***localhost:8500***, see screen shots below.) Two local folders will be created within your new directory: ***chartcache***, and ***mbtiles***. The ***settings.json*** file will be created in ***[yourdirectoryname]***, all downloaded raster charts will be placed in ***[yourdirectoryname]/chartcache***, and the generated charts will be placed in ***[yourdirectoryname]/mbtiles***.

### Check out my chart viewing application at https://github.com/n129bz/mapclient
 Shows Metars, TAFs, Pireps, Animated Weather, Airport Information including frequencies and runways - and more! Also check out the companion express web server application at https://github.com/n129bz/mapserver    

### Required installations to run the app locally: gdal-bin (v3.6.2 minimum,) build-essential, libgdal-dev, libssl-dev, sqlite3, curl, unzip, and nodejs + npm (LTS) 

#### Installation:
1.) This node.js application is designed to run on Linux, and also runs well on **WSL** (Windows Subsystem for Linux) and assumes a pre-existing node js installation   
2.) After installing all requirements, clone this repository, change directory to **chartmaker**, open a terminal and enter **npm install**        
3.) Run the application in a terminal with the command **node make.js** or to see command line options, **node make.js --help** 
4.) To run the application as a console app, make the setting **"webservermode": false** (The default is to run from the web server.)    
5.) If not passing a chart number argument, respond to the prompt for what to process      
6.) Go do something else... depending on the number of charts and image quality, the full Sectional chart can take up to several hours to complete.     

### Process Control Files

#### chartdates.json
The FAA publishes charts 20 days ***before*** the official chart date, and chartmaker will automatically select the nearest chart date from this file of official FAA chart 56-day release dates, all the way up to the year 2044. If the next chart date is more than 20 days out, chartmaker will get the current chart date.                   
#### config.yml
The arrays **fullchartlist** and **areachartlist** are the actual zip filenames the FAA uses and are for reference only. **Changes to the downloadtemplates, chartlists, layertypes, or tiledrivers lists WILL BREAK THE APPLICATION!**    
* The default **tileimagequality** percentage of ***95*** and **tiledriverindex** index to ***2*** (webp) gives the best resolution at a reasonable mbtiles file size. The smaller the percentage, the fuzzier the chart will be at high zoom levels. **webp** does extremely well at 95%.   
  * Please note that the tiledimagequality setting only works for **webp** images. 
* If the folder path in the **mbtilesfolder** setting does not exist, it will be created recursively. All generated mbtiles files will be moved here after processing is complete.
* To save disk space, you can set **cleanprocessfolders** to true, which will remove all temporary processing files when the processing completes.
* To preserve the intermediate processed files, you can set **renameworkarea** to true. This will rename the **workarea** folder to include the processed chart date so the next run will not overwrite the folder. This is a convenience setting to allow seeing the intermediate files, but it uses more disk space.

#### other config.yml values
* ***attribution*** is a database metadata value that many mapping applications use for acknowledgement of the database creator      
```
attribution: "Aviation charts <a href='https://github.com/n129bz/chartmaker'>github.com/n129bz/chartmaker</a>"   
```   
* ***curl download templates,*** values inside brackets <> are programmatically replaced with values to match FAA's file names       
```
vfrdownloadtemplate: "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip"   
ifrdownloadtemplate: "https://aeronav.faa.gov/enroute/<chartdate>/<charttype>.zip"
vfrindividualtemplate: "https://aeronav.faa.gov/visual/<chartdate>/sectional-files/<charttype>.zip"    
```  
* ***application flags***   
```
renameworkarea: false       <- if true, will append chart date to the working folder name  
logtofile: true             <- if true will produce a file "debug.log"  
cleanprocessfolders: false  <- if true then working folders are removed after processing
```     
* ***tile image quality percentage,*** tileimagequality only affects webp and jpg quality, but no effect with png    
```
tileimagequality : 95   <- percentage (1-100) greatly affects processing speed and database size
```   
* ***fullchartlist*** is an array with subarrays that contain 3 values: FAA chart name, chart type, and an alias (not used for vfr charts.)    
**WARNING: Editing of any of these faachartnames values will break the application.**   
```
fullchartlist:
    - ["Sectional", "vfr", "VFR_Sectional"]
    - ["Caribbean", "vfr", "VFR_Caribbean"]
    - ["Grand_Canyon", "vfr", "Grand_Canyon_Air_Tour_Operators"]
    - ["Terminal", "vfr", "VFR_Terminal"]
    - ["Helicopter", "vfr", "VFR_Helicopter"]
    - ["DDECUS", "ifr", "Enroute_Low"]
    - ["DDECUS", "ifr", "Enroute_High"]
    - ["US_VFR_Wall_Planning", "vfr", "VFR_Wall_Planning"]
```
* ***areachartlist*** is a list of all 53 VFR area charts and is what the application uses for individual chart processing.    
**WARNING: Editing any of these values will cause individual chart processing to fail.**
```
areachartlist:
    - Albuquerque
    - Anchorage
    - Atlanta
    - Bethel
    - Billings
    - Brownsville
    - Cape_Lisburne
    - Charlotte
    - Cheyenne
    - Chicago
    - Cincinnati
    - Cold_Bay
    - Dallas-Ft_Worth
    - Dawson
    - Denver
    - Detroit
    - Dutch_Harbor
    - El_Paso
    - Fairbanks
    - Great_Falls
    - Green_Bay
    - Halifax
    - Hawaiian_Islands
    - Houston
    - Jacksonville
    - Juneau
    - Kansas_City
    - Ketchikan
    - Klamath_Falls
    - Kodiak
    - Lake_Huron
    - Las_Vegas
    - Los_Angeles
    - McGrath
    - Memphis
    - Miami
    - Montreal
    - New_Orleans
    - New_York
    - Nome
    - Omaha
    - Phoenix
    - Point_Barrow
    - Salt_Lake_City
    - San_Antonio
    - San_Francisco
    - Seattle
    - Seward
    - St_Louis
    - Twin_Cities
    - Washington
    - Western_Aleutian_Islands
    - Wichita
```    
* ***layertypeindex*** controls the layertype and therefore how it will be rendered on a map, for example If you will be overlaying an OSM map with your chartmaker map   
```
layertypeindex: 1
  layertypes:
    - baselayer
    - overlay
```      
* ***tiledriverindex*** determines the tiledriver type, for example index 2 (webp) produces the smallest image size but png produces the sharpest images   
```
tiledriverindex: 2
  tiledrivers:
    - png
    - jpeg
    - webp
```   
#### *Additional information
The chart zip files are downloaded from the FAA digital raster chart repository and unzipped. After the unzipping process all of the the resultant GEOtiff image names (and their matching tfw world file names) are "normalized" to all lower-case filenames with underscores in place of dashes and spaces and any apostrophes removed. This simplifies the down-stream processing of these files since **GDAL** can interpret spaces as argument separators.   

<img width="589" height="725" alt="Chartmaker01" src="https://github.com/user-attachments/assets/14f8c991-568a-48f7-8f68-0663ac9e044b" />
<img width="597" height="841" alt="ChartmakerWeb" src="https://github.com/user-attachments/assets/febfa936-4aff-4439-acf8-7599ea60b934" />
<img width="591" height="752" alt="ChartmakerMain" src="https://github.com/user-attachments/assets/993b4f0f-a1fd-47c4-a660-e151b10eba20" />
<img width="581" height="526" alt="Chartmaker04" src="https://github.com/user-attachments/assets/62c13b7c-7d08-4f27-b8b0-793ff2a14aed" />

### ToDo:

**Suggestions welcome!**

#### ***inspired by https://github.com/jlmcgraw/aviationCharts***
