#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

cd /home/ec2-user/nina-indexer

# Function to safely stop and delete a PM2 process
stop_pm2_process() {
    local process_name=$1
    if pm2 list | grep -q "$process_name"; then
        echo "Stopping and deleting $process_name..."
        pm2 stop "$process_name" && pm2 delete "$process_name"
    else
        echo "Process $process_name not found, skipping..."
    fi
}

# Stop processes if they exist
stop_pm2_process "nina-indexer"
stop_pm2_process "nina-api"
