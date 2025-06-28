#!/bin/bash

# Remove old containers if any
containers=$(docker ps -aqf "name=crypto-bot-surfer*")
[ -n "$containers" ] && docker rm $containers --force > /dev/null 2>&1

# Get list of services from docker-compose.yml
mapfile -t services < <(docker compose config --services)

# Check if there are any services defined
if [ ${#services[@]} -eq 0 ]; then
  echo "? No services found in docker-compose.yml"
  exit 1
fi

# Start each service with a delay to avoid overload
for service in "${services[@]}"; do
  echo "?? Starting service: $service"
  docker compose up -d "$service"
  echo "?? Waiting 60 seconds before next service..."
  sleep 60
done

# Attach to logs
echo "?? Attaching to logs (Ctrl+C to exit)"
docker compose logs -f