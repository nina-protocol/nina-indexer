#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

cd /home/ec2-user/nina-indexer
pm2 start /home/ec2-user/.yarn/bin/yarn --interpreter bash --name nina-indexer -- start:indexer --no-autorestart
pm2 start /home/ec2-user/.yarn/bin/yarn --interpreter bash --name nina-api -- start:api --no-autorestart