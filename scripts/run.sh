#!/bin/bash

# Load NVM and its bash completion
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

nvm use 20.18.0

pm2 update

echo "Running as $(whoami)"
source ~/.bashrc

ENV_VARS_FILE="/home/ec2-user/nina-indexer/env_vars.sh"
if [ -f "$ENV_VARS_FILE" ]; then
    set -a # Automatically export all variables
    source "$ENV_VARS_FILE"
    set +a
else
    echo "Environment variables file not found: $ENV_VARS_FILE"
fi

cd /home/ec2-user/nina-indexer

if [ "$1" == "--only" ] && [ "$2" == "nina-api" ]; then
    pm2 start ecosystem.config.cjs --only nina-api
else
    pm2 start ecosystem.config.cjs
fi