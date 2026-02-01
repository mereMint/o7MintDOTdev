#!/bin/bash
# Run Tunnel Script
echo "Starting Cloudflare Tunnel..."
# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Error: cloudflared not found. Please run setup.sh first."
    exit 1
fi

# Run tunnel for local port 8000
cloudflared tunnel --url http://localhost:8000
