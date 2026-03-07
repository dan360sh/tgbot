#!/bin/bash
set -e

echo "Pulling latest code..."
git pull

echo "Building app..."
docker compose build app

echo "Restarting app..."
docker compose up -d app

echo "Done."
