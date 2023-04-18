#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

echo "Running as `whoami` user"
source ~/.bashrc

if [ "$HOSTNAME" = "dev.api.ninaprotocol.com" ]; then
    source /home/ec2-user/.env.development
    echo "dev environment detected for host: $HOSTNAME"
else
    echo "non-dev environment detected for host: $HOSTNAME"
    source /home/ec2-user/.env.production
fi

cd /home/ec2-user/nina-indexer
pm2 --max-memory-restart 2048M start yarn --name nina-indexer -- start:indexer
pm2 --max-memory-restart 2048M start yarn --name nina-api -- start:api