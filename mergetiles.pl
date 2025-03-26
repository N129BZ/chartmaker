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

#-----------------------------------------------------------------------------
# Modified March 20, 2025 by Brian A. Manlove to make Area folder tile 
# manipulation a multiprocess operation, using the Parallel::ForkManager 
# module. (See https://metacpan.org/pod/Parallel::ForkManager for info.)
# The calling program passes a new max_processes argument which is used 
# as the limit of how many processes will be used at a time. 
# ----------------------------------------------------------------------------

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
use Parallel::ForkManager;

#Call the main routine and exit with its return code
exit main(@ARGV);

sub main {
    
    # Number of arguments supplied on command line
    my $num_args = $#ARGV + 1;

    # Get the passed in maximum number of processes argument
    my $max_processes = $ARGV[0];

    # Get the source tiles directory argument
    my $source_tiles_directory = $ARGV[1];
    
    # Get the merged tiles directory argument 
    my $base_tiles_directory    = $ARGV[2];

    # Set up the number of processes ForkManager will use 
    my $pm = Parallel::ForkManager->new($max_processes);

    # Read the source tiles directory
    my @areas = read_dir($source_tiles_directory);

    AREA_LOOP:
    foreach my $area (@areas) {
        my $overlay_tiles_directory = "$source_tiles_directory/$area"; 

        print STDOUT "processing tiles: $area\n";
        
        # Call the processZoomLevels subroutine, with parent directory arguments
        # Note: These arguments will be copied by value in the subroutine!
        processZoomLevels($base_tiles_directory, $overlay_tiles_directory);

        # Go on to another thread if one is available
        my $pid = $pm->start and next AREA_LOOP;

        $pm->finish; # Terminate this child process when finished
    }
    $pm->wait_all_children; # Ensure all child processes have exited
}

sub processZoomLevels() {
    # Get the passed in arguments as local variables only.
    my ($base_directory, $overlay_directory) = @_;

    # Get all of the zoom level subdirectories in the $overlay_directory
    my @overlay_tiles_zoom_levels = read_dir($overlay_directory);

    foreach my $zoomlevel (@overlay_tiles_zoom_levels) {
        
        if ( -d "$overlay_directory/$zoomlevel" ) {

            # Make the base/destination directory if it doesn't exist
            unless ( -e "$base_directory/$zoomlevel" ) {
                mkdir "$base_directory/$zoomlevel";
            }

            # For each column...
            my @overlay_tiles_x_levels = read_dir("$overlay_directory/$zoomlevel");

            foreach my $x (@overlay_tiles_x_levels) {
                # Make the base/destination directory if it doesn't exist
                if ( -d "$overlay_directory/$zoomlevel/$x" ) {
                    unless ( -e "$base_directory/$zoomlevel/$x" ) {
                        mkdir "$base_directory/$zoomlevel/$x";
                    }

                    # For each tile...
                    my @overlay_tiles_y_tiles = read_dir("$overlay_directory/$zoomlevel/$x");

                    foreach my $y (@overlay_tiles_y_tiles) {
                        # If both base and overlay tiles exist then composite them together with "convert"
                        if ( -e "$base_directory/$zoomlevel/$x/$y" ) {
                            qx(convert "$base_directory/$zoomlevel/$x/$y" "$overlay_directory/$zoomlevel/$x/$y" -composite "$base_directory/$zoomlevel/$x/$y");
                        }
                        # Otherwise do a regular copy from overlay tile to base directory
                        else {
                            copy(
                                "$overlay_directory/$zoomlevel/$x/$y",
                                "$base_directory/$zoomlevel/$x/$y"
                            );
                        }
                    }
                }
            }
        }     
    }
}
