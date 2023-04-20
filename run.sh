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
pm2 start ecosystem.config.cjs

# The following heapstats logs far more verbose memory diagnostics
# pm2 start ecosystem.config.cjs -- start:indexer:heapstats