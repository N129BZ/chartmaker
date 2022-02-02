# ChartMaker - Download FAA digital raster charts and translate into mbtiles database  

### Instructions:   
1.) this application requires several supporting applications to be installed on your system - see ***Debian*** example below.              
2.) clone this repository - ***git clone https://github.com/N129BZ/ChartMaker.git***            
3.) from a terminal prompt in the ChartMaker directory, enter ***npm install***                        
4.) edit **settings.json** wuth a text editor and change the **ChartType** value to one of the types in the ChartTypes list                      
5.) run the app via command **node index.js**         
6.) go do something else... depending on the desired charts, the process can take several hours to complete.
     
### Settings.json  
Since the FAA publishes charts 20 days *before* the official chart date, this application will "automatically" select                 
the appropriate chart date from the list of official FAA chart dates in the settings file.  Alternatively, you can pass              
a valid chart date argument when launching the application, in the format ***-d MM-dd-YYYY***.                     
                   
*  For example, the zoom range value can either be in the format **n-n**, or you can use a single zoom level **n**                
*  You can also change the **TiledImageQuality** setting for an even smaller mbtiles file.  
*  To save disk space, you can set **CleanMergeFolder** to true.
   *  The merge folder can end up being as fat as 13 gigabytes for the entire chart set
   *  Quantized images are preserved in their own folder, these will be less than 1/3 the size of the merge folder
*  To preserve all of the processing folders, you can set **RenameWorkArea** to true.
   *  This setting will rename the **workarea** folder to include the processed chart date. 
                   
***(See details below in additional information for the all application settings.)***                                    

### Full Installation example on a Debian distro (your system may be different)
* Note that on some versions of Ubuntu, ```python-imaging``` has been replaced by ```python-pil```
```
# install required dependencies using apt as sudo, this assumes you already have Python installed
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

# change directory to where you will clone ChartMaker, for example:
cd /myinstalldirectory

# clone ChartMaker
git clone https:github.com/N129BZ/ChartMaker.git
                            
# change directory to ChartMaker
cd /myinstalldirectory/ChartMaker
                                   
# unzip clipshapes.zip 
unzip clishapes.zip
                                    
# install required node packages
npm install      
                                
# open a terminal in the ChartMaker directory. 
#   You can either let the application automatically select the best valid chart date by not passing a date,  
#   or you can look at the chart release dates in chartdates.json for the nearest valid date within 20 days 
#   of "today" and run the application, for example, if you want to specify a date:
                   
      node makechart.js -d 01-27-2022**

```
### Additional information       
The chart zip file is downloaded from the FAA VFR digital raster chart repository and unzipped. The unzipping process will normalize the resultant GEOtiff images and their matching tfw world files to filenames with underscores in place of spaces.     
       
As of January 1, 2022, the official chart release is for **01-27-2022. You can view those release dates below in the chartdates list in chartdates.json** or view the list at: https://aeronav.faa.gov/visual/10-07-2021/sectional-files. **Also note that the FAA publishes these chart files *20 days before* an official release date.**        
                       
                        
**settings.json:**                                                                                                              
```
{
    "ChartUrlTemplate": "https://aeronav.faa.gov/visual/<chartdate>/All_Files/<charttype>.zip",
    "TiledImageQuality": 75,
    "CleanMergeFolder": true,
    "RenameWorkArea": false,
    "ZoomRange": "5-11",
    "ChartType": "Terminal",
    "ChartTypes":
        [
            "Sectional",
            "Terminal",
            "Caribbean",
            "Grand_Canyon",
            "Helicopter",
            "Planning"
        ]    
}
```

### ToDo:    
Add other chart types including IFR charts, etc.    
     
      
#### ***inspired by https://github.com/jlmcgraw/aviationCharts*** 

