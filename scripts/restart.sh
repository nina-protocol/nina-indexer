#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

echo "Running as $(whoami)"

# Determine the environment
if [ "$(hostname)" == "dev.api.ninaprotocol.com" ]; then
    ENV="dev"
elif [ "$(hostname)" == "api.ninaprotocol.com" ]; then
    ENV="prod"
else
    ENV="local"
fi

# Set the project directory
if [ "$ENV" == "local" ]; then
    PROJECT_DIR="$PWD"
else
    PROJECT_DIR="/home/ec2-user/nina-indexer"
fi

# Load environment variables
if [ "$ENV" != "local" ]; then
    ENV_VARS_FILE="$PROJECT_DIR/env_vars.sh"
    if [ -f "$ENV_VARS_FILE" ]; then
        set -a
        source "$ENV_VARS_FILE"
        set +a
    else
        echo "Environment variables file not found: $ENV_VARS_FILE"
        exit 1
    fi
else
    # For local development, assume .env file is in the project root
    if [ -f "$PROJECT_DIR/.env" ]; then
        set -a
        source "$PROJECT_DIR/.env"
        set +a
    else
        echo "Local .env file not found in $PROJECT_DIR"
        exit 1
    fi
fi

# Change to the project directory
cd "$PROJECT_DIR"

# Stop and delete existing PM2 processes
pm2 stop nina-indexer nina-api 2>/dev/null || true
pm2 delete nina-indexer nina-api 2>/dev/null || true

# Start the processes using PM2
pm2 start ecosystem.config.cjs

echo "Nina Indexer and API have been restarted."