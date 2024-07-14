#!/bin/bash

# install all required programs/utilities
sudo apt install -y sqlite3 curl unzip pngquant imagemagick build-essential libgdal-dev libssl-dev gdal-bin

# install perl dependencies
perl -MCPAN -e "CPAN::Shell->notest('install', 'strict')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'warnings')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'autodie')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Carp')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Modern::Perl')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Params::Validate')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'File::Slurp')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'File::Copy')"
