#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

cd /home/ec2-user/nina-indexer
nvm version
pm2 stop nina-indexer && pm2 delete nina-indexer
pm2 start yarn --interpreter bash --name nina-indexer -- start:indexer
pm2 stop nina-api && pm2 delete nina-api
pm2 start yarn --interpreter bash --name nina-api -- start:api
pm2 status