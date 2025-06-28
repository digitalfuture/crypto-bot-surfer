#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting crypto-bot-surfer setup...${NC}"

# Stop and remove existing containers
echo -e "${YELLOW}🧹 Checking for old containers...${NC}"
containers=$(docker ps -aqf "name=crypto-bot-surfer*")

if [ -n "$containers" ]; then
  echo -e "${YELLOW}Stopping and removing old containers...${NC}"
  docker rm $containers --force > /dev/null 2>&1
  echo -e "${GREEN}✅ Old containers removed.${NC}"
else
  echo -e "${GREEN}No old containers found. Clean environment.${NC}"
fi

# Remove dangling images (optional, if you want to rebuild cleanly)
echo -e "${YELLOW}🧹 Removing dangling images...${NC}"
docker images -f "dangling=true" -q | xargs --no-run-if-empty docker rmi > /dev/null 2>&1
echo -e "${GREEN}✅ Dangling images cleaned.${NC}"

# Build the new image
echo -e "${YELLOW}🏗️ Building Docker image...${NC}"
docker build -t crypto-bot-surfer .
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Docker image built successfully.${NC}"
else
  echo -e "${RED}❌ Failed to build Docker image.${NC}"
  exit 1
fi

# Start services
echo -e "${YELLOW}🐳 Starting containers with docker-compose...${NC}"
docker compose up -d
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ All containers started successfully.${NC}"
else
  echo -e "${RED}❌ Failed to start containers.${NC}"
  exit 1
fi

# Optional: show logs in real-time
echo -e "\n📊 ${YELLOW}Showing logs (Ctrl+C to exit):${NC}"
docker compose logs -f
