#!/bin/bash
cd /home/ec2-user/nina-indexer
$NVM_BIN/pm2 stop nina-indexer && pm2 delete nina-indexer
$NVM_BIN/pm2 start yarn --interpreter bash --name nina-indexer -- start:indexer
$NVM_BIN/pm2 stop nina-api && pm2 delete nina-api
$NVM_BIN/pm2 start yarn --interpreter bash --name nina-api -- start:api