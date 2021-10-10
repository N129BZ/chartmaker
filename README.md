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
        graphicsmagick  \
        unzip           \
        imagemagick     \
        cpanminus       \
        python-imaging  \
        carton          \
        gdal-bin
```

# Run the Perl carton installer
carton install

# Get mbtiles utilities, clone into the VfrSecChartMaker directory
git clone https://github.com/mapbox/mbutil.git

### ToDo:    
Add all of the other areas and chart types including Alaska, Hawaii, territories, and IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

