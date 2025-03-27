#!/usr/bin/perl

# Merge two tile sets, blending tiles together when both exist
# Copyright (C) 2013  Jesse McGraw (jlmcgraw@gmail.com)
#
#-----------------------------------------------------------------------------
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with this program.  If not, see [http://www.gnu.org/licenses/].

#Standard modules
use strict;
use warnings;
use autodie;
use Carp;

# Using this so users don't need to globally install modules
# allows using "carton install" instead
use FindBin '$Bin';
use lib "$FindBin::Bin/local/lib/perl5";

# Non-Standard modules that should be installed locally
use Modern::Perl;
use Params::Validate qw(:all);
use File::Slurp;
use File::Copy;

#Call the main routine and exit with its return code
exit main(@ARGV);

sub main {
    
    # Get the source tiles directory argument
    my $source_directory = $ARGV[0];
    
    # Get the merged tiles directory argument 
    my $base_directory    = $ARGV[1];

    print STDOUT "Merging tiles from $source_directory into $base_directory\n";

    my @areas = read_dir($source_directory);
   
    foreach my $area (@areas) {
        my $overlay_directory = "$source_directory/$area"; 

        print STDOUT "processing tiles: $area\n";
        
        # Get all of the zoom level subdirectories in the $overlay_directory
        my @overlay_zoom_levels = read_dir($overlay_directory);

        foreach my $zoomlevel (@overlay_zoom_levels) {
            
            if ( -d "$overlay_directory/$zoomlevel" ) {

                # Make the base/destination directory if it doesn't exist
                unless ( -e "$base_directory/$zoomlevel" ) {
                    mkdir "$base_directory/$zoomlevel";
                }

                # For each x level...
                my @overlay_x_levels = read_dir("$overlay_directory/$zoomlevel");

                foreach my $x (@overlay_x_levels) {
                    # Make the base/destination directory if it doesn't exist
                    if ( -d "$overlay_directory/$zoomlevel/$x" ) {
                        unless ( -e "$base_directory/$zoomlevel/$x" ) {
                            mkdir "$base_directory/$zoomlevel/$x";
                        }

                        # For each tile...
                        my @overlay_y_tiles = read_dir("$overlay_directory/$zoomlevel/$x");

                        foreach my $y (@overlay_y_tiles) {
                            # If the both base and overlay tiles exist, then call the ImageMagick "convert" function to composite the images. 
                            if ( -e "$base_directory/$zoomlevel/$x/$y" ) {
                                qx(convert "$base_directory/$zoomlevel/$x/$y" "$overlay_directory/$zoomlevel/$x/$y" -composite "$base_directory/$zoomlevel/$x/$y");
                            }
                            # Otherwise do a regular copy from overlay tile to base directory
                            else {
                                move("$overlay_directory/$zoomlevel/$x/$y", "$base_directory/$zoomlevel/$x/$y");
                            }
                        }
                    }
                }
            }     
        }
    }
}
