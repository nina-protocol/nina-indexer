#!/bin/bash

# Enable script debugging for deployment debugging
set -ex

sudo chown -R ec2-user /home/ec2-user/nina-indexer
chmod +x /home/ec2-user/nina-indexer/run.sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

ENV_VARS_FILE="/home/ec2-user/nina-indexer/env_vars.sh"

> "$ENV_VARS_FILE" # Overwrite any pre-existing env_vars.sh file

if [ "$(hostname)" == "dev.api.ninaprotocol.com" ]; then
  aws ssm get-parameters-by-path \
    --path "/indexer/dev/" \
    --with-decryption \
    --recursive \
    --region us-east-2 \
    --query "Parameters[*].[Name,Value]" \
    --output text | \
    while IFS=$'\t' read -r name value; do
      var_name=$(basename "$name")
      echo "$var_name=\"$value\"" >> "$ENV_VARS_FILE"
    done
elif [ "$(hostname)" == "api.ninaprotocol.com" ]; then
  aws ssm get-parameters-by-path \
    --path "/indexer/prod/" \
    --with-decryption \
    --recursive \
    --region us-east-2 \
    --query "Parameters[*].[Name,Value]" \
    --output text | \
    while IFS=$'\t' read -r name value; do
      var_name=$(basename "$name")
      echo "$var_name=\"$value\"" >> "$ENV_VARS_FILE"
    done
fi

# Check if environment variables file is created successfully
if [ -s "$ENV_VARS_FILE" ]; then
  echo "Environment variables file created."
else
  echo "No environment variables were written to the file."
fi

# Disable script debugging
set +x

cd /home/ec2-user/nina-indexer
yarn