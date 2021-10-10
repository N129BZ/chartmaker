# VfrSecChartMaker - Download continental US VFR sectional chart TIF files and translate them all into a single mbtiles database.  

### Instructions:   
1.) requires ***node js*** https://nodejs.org/dist/v14.18.0/node-v14.18.0-linux-x64.tar.xz              
2.) requires ***GDAL*** and other ancillary applications (installed with apt, see below)  
3.) unzip ***clipshapes.zip*** to the VfrSecChartMaker directory.   
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

#### ***for information on GDAL, see: https://gdal.org/***

