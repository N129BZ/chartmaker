#!/usr/bin/env python3

import os
import sys
import shutil
from multiprocessing import Pool

def main(): 
    # Get the passed in maximum number of processes argument
    max_processes = int(sys.argv[1])

    # Get the source tiles directory argument
    source_tiles_directory = sys.argv[2]

    # Get the merged tiles directory argument 
    base_tiles_directory = sys.argv[3]

    # Read the source tiles directory
    areas = os.listdir(source_tiles_directory)

    with Pool(processes=max_processes) as pool:
        pool.starmap(process_zoom_levels, [(base_tiles_directory, os.path.join(source_tiles_directory, area)) for area in areas])

    #for area in areas:
    #    process_zoom_levels (base_tiles_directory, os.path.join(source_tiles_directory, area))

def process_zoom_levels(base_directory, overlay_directory):
    # Get all of the zoom level subdirectories in the overlay_directory
    overlay_tiles_zoom_levels = os.listdir(overlay_directory)

    for zoomlevel in overlay_tiles_zoom_levels:
        if os.path.isdir(os.path.join(overlay_directory, zoomlevel)):
            # Make the base/destination directory if it doesn't exist
            base_zoomlevel_path = os.path.join(base_directory, zoomlevel)
            if not os.path.exists(base_zoomlevel_path):
                os.makedirs(base_zoomlevel_path)

            # For each column...
            overlay_tiles_x_levels = os.listdir(os.path.join(overlay_directory, zoomlevel))

            for x in overlay_tiles_x_levels:
                # Make the base/destination directory if it doesn't exist
                overlay_x_path = os.path.join(overlay_directory, zoomlevel, x)
                if os.path.isdir(overlay_x_path):
                    base_x_path = os.path.join(base_zoomlevel_path, x)
                    if not os.path.exists(base_x_path):
                        os.makedirs(base_x_path)

                    # For each tile...
                    overlay_tiles_y_tiles = os.listdir(overlay_x_path)

                    for y in overlay_tiles_y_tiles:
                        base_y_path = os.path.join(base_x_path, y)
                        overlay_y_path = os.path.join(overlay_x_path, y)
                        # If both base and overlay tiles exist then composite them together with "convert"
                        if os.path.exists(base_y_path):
                            os.system(f'convert "{base_y_path}" "{overlay_y_path}" -composite "{base_y_path}"')
                        # Otherwise do a regular copy from overlay tile to base directory
                        else:
                            shutil.copy(overlay_y_path, base_y_path)

if __name__ == "__main__":   
    main()
