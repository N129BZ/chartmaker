#!/bin/bash

# install perl dependencies
perl -MCPAN -e "CPAN::Shell->notest('install', 'strict')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'warnings')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'autodie')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Carp')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Modern::Perl')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Params::Validate')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'File::Slurp')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'File::Copy')"
perl -MCPAN -e "CPAN::Shell->notest('install', 'Parallel::ForkManager')"
