#!/bin/bash

docker rm $(docker ps -aqf "name=crypto-bot-surfer*") --force

docker compose up