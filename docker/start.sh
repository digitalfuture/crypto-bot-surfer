#!/bin/bash

# ANSI color codes for output formatting
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Remove old containers if any
echo -e "${YELLOW}🧹 Removing old containers...${NC}"
containers=$(docker ps -aqf "name=crypto-bot-surfer*")
if [ -n "$containers" ]; then
  docker rm $containers --force > /dev/null 2>&1
  echo -e "${GREEN}✅ Old containers removed.${NC}"
else
  echo -e "${GREEN}No old containers found.${NC}"
fi

# Start containers one by one with delay to avoid system overload
for i in {1..8}; do
  service="crypto-bot-surfer-$i"
  echo -e "${YELLOW}🚀 Starting container: $service...${NC}"
  docker compose up -d $service

  echo -e "${YELLOW}💤 Waiting 30 seconds before starting next container...${NC}"
  sleep 30
done

# Attach to logs of all containers in real-time
echo -e "${YELLOW}📊 Attaching to logs (Ctrl+C to exit)...${NC}"
docker compose logs -f