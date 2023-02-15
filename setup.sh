#!/bin/bash
sudo service codedeploy-agent status
chown -R ec2-user /home/ec2-user/nina-indexer
chmod +x /home/ec2-user/nina-indexer/run.sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
