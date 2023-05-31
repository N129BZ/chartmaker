# chartmaker - Download FAA digital raster charts and translate into mbtiles databases

### Requirements: Python 3, Node.js, Perl, pngquant, and GDAL v3.6.2

### Instructions:

1.) This node.js application is designed to run on Linux, and also runs on **WSL2** (Windows Subsystem for Linux)         
2.) Clone the repository, change directory to **chartmaker**, open a terminal and enter **npm install**        
3.) Give execute permissions to **perlsetup.sh** shell script and run it to install perl dependencies           
4.) Install the **pngquant** png image compression utility: **sudo apt install pngquant**      
5.) Run the application in a terminal with the command***** node make *****              
6.) Go do something else... depending on the desired chart, the process can take several hours to complete.     

### Settings.json

Since the FAA publishes charts 20 days *before* the official chart date, this application will automatically select                 
the appropriate chart date from the list of official FAA chart dates in the chartdates.json file.                  

* Edit the array values in **chartprocessindexlist** with any ordinal index numbers from the **faachartname**s array for charts you want process, in the order you want them processed. The default is all charts in the index list, in index order. The setting array **faachartnames** are the actual zip filenames the FAA uses and are for reference only. **Changes to downloadtemplate, faachartnames, layertypes, and tiledrivers values and are not recommended!**    
* The zoom range value can either be in the format **n-n**, or you can use a single zoom level **n**                
* You can change the **tiledimagequality** percentage from ***1*** up to ***100*** and **tiledriverindex** index to ***2*** (webp) to reduce mbtiles file size. The smaller the percentage, the fuzzier the chart will be.   
  * The tiledimagequality setting works for both **png** and **webp** images.  
* To save disk space, you can set **cleanprocessfolders** to true. 
  * The merge and/or pngquant work folders will be many gigabytes for the entire chart set and are not needed once processing is complete
* To preserve the processed databases, you can set **renameworkarea** to true.   
  * This will rename the **workarea** folder to include the processed chart date.

### Additional information

The chart zip files are downloaded from the FAA digital raster chart repository and unzipped. The unzipping process will normalize the resultant GEOtiff images and their matching tfw world files to all lower-case filenames with underscores in place of dashes and spaces.     

As of May 13 2023, the official chart release is for **04-20-2023. You can view those release dates up to the year 2044 in the chartdates.json file** or view the list at: https://aeronav.faa.gov/visual/10-07-2021/sectional-files. **Also note that the FAA publishes these chart files *20 days before* an official release date.**        

**settings.json:**                                                                                                              

```
{
    "attribution": "Aviation charts <a href='https://github.com/n129bz/chartmaker'>github.com/n129bz/chartmaker</a>",
    "downloadtemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip",
    "tiledimagequality" : "100",
    "renameworkarea": true,
    "cleanprocessfolders": true,
    "zoomrange" : "0-11",
    "chartprocessindexlist": [0,1,2,3,4],
    "layertypeindex": 1,
    "tiledriverindex": 2,
    "faachartnames": [
        "Grand_Canyon",
        "Helicopter",
        "Caribbean",
        "Terminal",
        "Sectional"
    ],
    "layertypes": [
        "baselayer", 
        "overlay"
    ],
    "tiledrivers": [
        "png",
        "jpg",
        "webp"
    ]
}
```

### ToDo:

Add IFR charts, etc.    

#### ***inspired by https://github.com/jlmcgraw/aviationCharts***
