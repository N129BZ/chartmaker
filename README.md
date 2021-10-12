# VfrSecChartMaker - Download continental US VFR sectional chart TIF files and translate them all into a single mbtiles database.  

### Instructions:   
1.) requires ***node js*** and several ***sudo apt install*** applications (see below.)  
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
                        
### Install required utility applications
```
sudo apt install        \   
        graphicsmagick  \
        imagemagick     \
        python-imaging  \
        gdal-bin        \
        unzip
        
# clone into the base VfrSecChartMaker directory
git clone https://github.com/mapbox/mbutil.git

```
### Additional information       
The charts are downloaded from the FAA digital raster chart repository. VfrSectionalChartMaker uses a JSON file with the list of charts to be downloaded. You can change that list to include as many or as few area charts as you want. The list includes 37 area chart names which covers the continental USA. The only "gotcha" here is that the area names must exactly match the FAA's spelling, including dashes or underscores, without the ".zip" extension. The processing will normalize the resultant graphic files with underscores in place of dashes or spaces. As of today, 10-11-2021, the official chart release is for 10-07-2021.  You can view that list at     

https://aeronav.faa.gov/visual/10-07-2021/sectional-files    
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
            "Charlotte",
            "Cheyenne",
            "Chicago",
            "Cincinnati",
            "Dallas-Ft_Worth",
            "Denver",
            "Detroit",
            "El_Paso",
            "Great_Falls",
            "Green_Bay",
            "Houston",
            "Jacksonville",
            "Kansas_City",
            "Klamath_Falls",
            "Lake_Huron",
            "Las_Vegas",
            "Los_Angeles",
            "McGrath",
            "Memphis",
            "Miami",
            "New_Orleans",
            "New_York",
            "Omaha", 
            "Phoenix",
            "St_Louis",
            "Salt_Lake_City",
            "San_Antonio",
            "San_Francisco",
            "Seattle",
            "Twin_Cities",
            "Washington",
            "Wichita"            
        ]
}
```

### ToDo:    
Add all of the other areas and chart types including Alaska, Hawaii, territories, and IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

