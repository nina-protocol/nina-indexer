#!/bin/bash
cd /home/ec2-user/nina-indexer
pm2 stop nina-indexer && pm2 delete nina-indexer
pm2 start yarn --interpreter bash --name nina-indexer -- start:indexer
pm2 stop nina-api && pm2 delete nina-api
pm2 start yarn --interpreter bash --name nina-api -- start:api
pm2 status