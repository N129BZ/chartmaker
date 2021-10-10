# VfrSecChartMaker - Download continental US VFR sectional chart TIF files and translate them all into a single mbtiles database.  

### Instructions:   
1.) requires ***node js*** and ***GDAL*** installed with apt (see below)  
2.) clone this repository - ***git clone https://github.com/N129BZ/VfrSecChartMaker.git***         
3.) unzip the folder in ***clipshapes.zip*** to the VfrSecChartMaker directory.   
4.) from a terminal prompt in the VfrSecChartMaker directory, enter ***npm install***     
5.) after all setup procedures are complete, run the app via command **node makechart.js *chartdate*** using a valid FAA sectional chart release date.     
    
# Install required utility applications
```
sudo apt install        \   
        unzip           \
        imagemagick     \
        cpanminus       \
        carton          \
        gdal-bin
        
git clone https://github.com/mapbox/mbutil.git

carton install
```

### ToDo:    
Add all of the other areas and chart types including Alaska, Hawaii, territories, and IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

