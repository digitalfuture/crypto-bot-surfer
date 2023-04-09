#!/bin/bash
docker rm $(docker ps -aqf "name=mytest*") --force
docker rmi $(docker ps -aqf "name=mytest*") --force

docker compose up