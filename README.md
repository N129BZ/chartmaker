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

### ToDo:    
Add all of the other areas and chart types including Alaska, Hawaii, territories, and IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

