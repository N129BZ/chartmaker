# VfrSecChartMaker - Download continental US VFR sectional chart TIF files and translate them all into a single mbtiles database.  

### Instructions:   
1.) requires ***node js*** and ***gdal-bin*** (see https://gdal.org/), from debian use ***sudo apt install gdal-bin***    
2.) clone this repository - ***git clone https://github.com/N129BZ/VfrSecChartMaker.git***         
3.) unzip the folder in ***clipshapes.zip*** into the base VfrSecChartMaker directory.   
4.) from a terminal prompt in the VfrSecChartMaker directory, enter ***npm install***     
5.) after step 3 completes, run the app with the command **node index.js *chartdate*** using valid FAA sectional chart release date.     
    
### ToDo:    
Add all of the other areas and chart types including Alaska, Hawaii, territories, and IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

