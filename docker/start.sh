#!/bin/bash

containers=$(docker ps -aqf "name=crypto-bot-surfer*")

if [ -n "$containers" ]; then
  docker rm $containers --force
else
  echo "No containers to remove."
fi

docker-compose up
