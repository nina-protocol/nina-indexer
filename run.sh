#!/bin/bash
cd /home/ec2-user/nina-indexer
/home/ec2-user/.nvm/versions/node/v16.17.0/bin/pm2 stop nina-indexer && pm2 delete nina-indexer
/home/ec2-user/.nvm/versions/node/v16.17.0/bin/pm2 start yarn --interpreter bash --name nina-indexer -- start:indexer
/home/ec2-user/.nvm/versions/node/v16.17.0/bin/pm2 stop nina-api && pm2 delete nina-api
/home/ec2-user/.nvm/versions/node/v16.17.0/bin/pm2 start yarn --interpreter bash --name nina-api -- start:api
/home/ec2-user/.nvm/versions/node/v16.17.0/bin/pm2 status