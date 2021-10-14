# VfrSecChartMaker - Download US VFR sectional chart TIF files and translate them all into a single mbtiles database.  

### Instructions:   
1.) this application requires several supporting applications to be installed on your system - see ***Debian*** example below.              
2.) clone this repository - ***git clone https://github.com/N129BZ/VfrSecChartMaker.git***    
3.) clone the Mapbox mbtile application (see below) into the base VfrSecChartMaker directory.       
4.) unzip ***clipshapes.zip*** to the base VfrSecChartMaker directory.   
5.) from a terminal prompt in the VfrSecChartMaker directory, enter ***npm install***     
6.) run the app via command **node makechart.js *-d chartdate*** using a valid FAA sectional chart release date.        
7.) go do something else, the process will take several hours to complete.
     
### Command line arguments    
The application accepts 2 arguments. Date is required, zoom range defaults to **5-11**.     
        
1.) The required date argument should be in the format ***-d mm-dd-YYYY***            
        example: **node makechart.js -d 10-07-2021**        
            
2.) The optional zoom range argument should be in the format ***-z n-n***, or you can use a single zoom level ***n***                
        examples: **node makechart.js -d 10-07-2021 -z 4-10** or **node.makechart.js -d 10-07-2021 -z 8**     
                        
### Full Installation example on a Debian distro (your system may be different)
* Note that on some versions of Ubuntu, ```python-imaging``` has been replaced by ```python-pil```
```
# install required dependencies using apt as sudo
sudo apt install        \    
        git             \       
        graphicsmagick  \
        imagemagick     \
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

# run the application
node makechart.js -d 10-07-2021 -z 5-11

```
### Additional information       
The charts are downloaded from the FAA VFR digital raster chart repository by processing a list of chartnames in **chartlist.json.** You can edit this file to include as many or as few area charts as you want. The default list includes all 51 area chart names, covering the continental USA, Alaska, and Hawaii. **The chartnames on the list do not include the ".zip" extension and they must exactly match the FAA's spelling, including any spaces, dashes or underscores.** The unzipping process will normalize the resultant graphic filenames with underscores in place of dashes or spaces.     
       
As of October 1, 2021, the official chart release is for **10-07-2021.**  You can view that FAA list at: https://aeronav.faa.gov/visual/10-07-2021/sectional-files.  The file **chartdates.json** file is also included and contains the 56-day cycle of official publishing dates for FAA VFR raster charts, going out to the year 2044. **Also note that the FAA publishes these chart files *20 days before* an official release date.**    
```
{
    "charturl": "https://aeronav.faa.gov/visual/<chartdate>/sectional-files/<chartname>.zip",
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
            "Halifax",
            "Hawaiian_Islands",
            "Houston",
            "Jacksonville",
            "Juneau",
            "Kansas_City",
            "Ketchikan",
            "Klamath_Falls",
            "Kodiak",
            "Lake_Huron",
            "Las_Vegas",
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
        ]
}
```

### ToDo:    
Add other chart types including IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

