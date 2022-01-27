# VfrSecChartMaker - Download US VFR digital raster charts and translate them all into a single mbtiles database  

### Instructions:   
1.) this application requires several supporting applications to be installed on your system - see ***Debian*** example below.              
2.) clone this repository - ***git clone https://github.com/N129BZ/VfrSecChartMaker.git***            
3.) clone the Mapbox mbtile application (see below) into the base VfrSecChartMaker directory.       
4.) unzip ***clipshapes.zip*** to the base VfrSecChartMaker directory.   
5.) from a terminal prompt in the VfrSecChartMaker directory, enter ***npm install***     
6.) run the app via command **node makechart.js *-d chartdate*** using a valid FAA sectional chart release date.        
7.) go do something else, the process will take several hours to complete.
     
### Command line arguments    
The application requires a Date argument.     
        
1.) The required date argument should be in the format ***-d mm-dd-YYYY***            
        example: **node makechart.js -d 10-07-2021**        
            
2.) Check other application settings in the ***settings.json*** file.                 
*  For example, the zoom range value can be in the format ***-z n-n***, or you can use a single zoom level ***n***                
*  You can also change the ***tiledImageQuality*** setting for an even smaller mbtiles file.  
*  To save disk space, you can set ***cleanMergeFolderAtQuantize*** to true.
   *  The merge folder can end up being as fat as 13 gigabytes for the entire chart set
   *  Quantized images are preserved in their own folder, these will be less than 1/3 the size of the merge folder
*  To preserve all of the processing folders, you can set ***renameWorkFolderOnCompletion*** to true.
   *  This setting will rename the **workarea** folder to include the processed chart date. 
                        
### Full Installation example on a Debian distro (your system may be different)
* Note that on some versions of Ubuntu, ```python-imaging``` has been replaced by ```python-pil```
```
# install required dependencies using apt as sudo
sudo apt install        \    
        git             \       
        perl            \
        imagemagick     \
        pngquant        \
        python-imaging  \
        gdal-bin        \
        nodejs          \
        npm             \
        unzip

# change directory to where you will clone VfrSecChartMaker, for example:
cd /myinstalldirectory

# clone VfrSecChartMaker
git clone https:github.com/N129BZ/VfrSecChartMaker.git

# change directory to VfrSecChartMaker
cd /myinstalldirectory/VfrSecChartMaker

# clone Mapbox Utilities
git clone https://github.com/mapbox/mbutil.git     

# unzip clipshapes.zip 
unzip clishapes.zip

# install required node packages
npm install      

# open a terminal in the VfrSecChartMaker directory. 
#
#   look at the chart release dates in settings.json for the newest date 
#   within 20 days of "today" and run the application, for example:
node makechart.js -d 01-27-2022

```
### Additional information       
The charts are downloaded from the FAA VFR digital raster chart repository by processing the list of chartnames in **settings.json.** You can edit this file to include as many or as few area charts as you want. The default list includes all 51 area chart names, covering the continental USA, Alaska, and Hawaii, as well as inset charts for several areas. **The chartnames on the list do not include the ".zip" extension and they must exactly match the FAA's spelling, including any spaces, dashes or underscores.** The unzipping process will normalize the resultant graphic filenames with underscores in place of dashes or spaces.     
       
As of January 1, 2022, the official chart release is for **01-27-2022. You can view those release dates below in the chartdates list in settings.json** or view the list at: https://aeronav.faa.gov/visual/10-07-2021/sectional-files. **Also note that the FAA publishes these chart files *20 days before* an official release date.**    
```
{
    "charturl": "https://aeronav.faa.gov/visual/<chartdate>/sectional-files/<chartname>.zip",
    "tiledbname": "usavfr",
    "tiledImageQuality": 90,
    "cleanMergeFolderAtQuantize": false,
    "renameWorkFolderOnCompletion": true,
    "zoomRange": "5-11",
    "areas":
        [
            "Albuquerque",
            "Atlanta",
            "Bethel",
            "Billings",
            "Brownsville",
            "Cape_Lisburne",
            "Charlotte",
            "Cheyenne",
            "Chicago",
            "Cincinnati",
            "Cold_Bay",
            "Dallas-Ft_Worth",
            "Dawson",
            "Denver",
            "Detroit",
            "Dutch_Harbor",
            "El_Paso",
            "Fairbanks",
            "Great_Falls",
            "Green_Bay",
            "Halifax",a
            "Hawaiian_Islands",
            "Houston",
            "Jacksonville",
            "Juneau",
            "Kansas_City",
            "Ketchikan",
            "Klamath_Falls",
            "Kodiak",
            "Lake_Huron",
            "Las_Vegas",a
            "Los_Angeles",
            "McGrath",
            "Memphis",
            "Montreal",
            "Miami",
            "New_Orleans",
            "New_York",
            "Nome",
            "Omaha", 
            "Phoenix",
            "Point_Barrow",
            "Salt_Lake_City",
            "San_Antonio",
            "San_Francisco",
            "Seattle",
            "Seward",
            "St_Louis",
            "Twin_Cities",
            "Washington",
            "Wichita"            
        ],
        "chartdates":
        [
            "12-02-2021",
            "01-27-2022",
            "03-24-2022",
            "05-19-2022",
            "07-14-2022",
            "09-08-2022",
            "11-03-2022",
            "12-29-2022",
            "02-23-3023",
            "04-20-2023",
            "06-15-2023",
            "08-10-2023",
            "10-05-2023",
            "11-30-2023",
            "01-25-2024",
            "03-21-2024",
            "05-16-2024",
            "07-11-2024",
            "09-05-2024",
            "10-31-2024",
            "12-26-2024",
            "02-20-2025",
            "04-17-2025",
            "06-12-2025",
            "08-07-2025",
            "10-02-2025",
            "11-27-2025",
            "01-22-2026",
            "03-19-2026",
            "05-14-2026",
            "07-09-2026",
            "09-03-2026",
            "10-29-2026",
            "12-24-2026",
            "02-18-2027",
            "04-15-2027",
            "06-10-2027",
            "08-05-2027",
            "09-30-2027",
            "11-25-2027",
            "01-20-2028",
            "03-16-2028",
            "05-11-2028",
            "08-06-2028",
            "10-26-2028",
            "12-21-2028",
            "02-15-2029",
            "04-12-2029",
            "06-07-2029",
            "08-02-2029",
            "09-27-2029",
            "11-22-2029",
            "01-17-2030",
            "03-14-2030",
            "05-09-2030",
            "07-04-2030",
            "10-24-2030",
            "12-19-2030",
            "02-13-2031",
            "04-10-2031",
            "06-05-2031",
            "07-31-2031",
            "09-25-2031",
            "11-20-2031",
            "01-15-2032",
            "03-11-2032",
            "05-06-2032",
            "07-01-2032",
            "08-26-2032",
            "10-21-2032",
            "12-16-2032",
            "02-10-2033",
            "04-07-2033",
            "06-02-2033",
            "07-28-2033",
            "09-22-2033",
            "11-17-2033",
            "01-12-2034",
            "03-09-2034",
            "05-04-2034",
            "06-29-2034",
            "08-24-2034",
            "10-19-2034",
            "12-14-2034",
            "02-08-2035",
            "04-05-2035",
            "05-31-2035",
            "07-26-2035",
            "09-20-2035",
            "11-15-2035",
            "01-10-2036",
            "03-06-2036",
            "05-01-2036",
            "06-26-2036",
            "08-21-2036",
            "10-16-2036",
            "12-11-2036",
            "02-05-2037",
            "04-02-2037",
            "05-28-2037",
            "07-23-2037",
            "09-17-2037",
            "11-12-2037",
            "01-07-2038",
            "03-04-2038",
            "04-29-2038",
            "06-24-2038",
            "08-19-2038",
            "10-14-2038",
            "12-09-2038",
            "02-03-2039",
            "03-31-2039",
            "05-26-2039",
            "07-21-2039",
            "09-15-2039",
            "11-10-2039",
            "01-05-2040",
            "03-01-2040",
            "04-21-2040",
            "06-16-2040",
            "08-16-2040",
            "10-11-2040",
            "12-06-2040",
            "01-31-2041",
            "03-28-2041",
            "05-23-2041",
            "07-18-2041",
            "09-12-2041",
            "11-07-2041",
            "01-02-2042",
            "02-27-2042",
            "04-24-2042",
            "06-19-2042",
            "08-14-2042",
            "10-09-2042",
            "12-04-2042",
            "01-29-2043",
            "03-26-2043",
            "05-21-2043",
            "07-16-2043",
            "09-10-2043",
            "11-05-2043",
            "12-31-2043",
            "02-25-2044",
            "04-21-2044",
            "06-16-2044",
            "08-11-2044",
            "10-06-2044",
            "12-29-2044"
        ]
}
```

### ToDo:    
Add other chart types including IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

