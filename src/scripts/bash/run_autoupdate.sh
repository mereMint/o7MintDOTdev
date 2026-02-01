#!/bin/bash
# Run Auto-Update Script
echo "Starting Auto-Update Loop..."

while true; do
    echo "--------------------------"
    date
    echo "Checking for updates..."
    
    # Forcefully reset to remote state (Destructive but ensures sync)
    echo "Resetting to match remote..."
    git fetch --all
    git reset --hard origin/main
    git clean -fd
    
    # Update dependencies
    if [ -f "package.json" ]; then
        echo "Updating Node.js dependencies..."
        npm install
    fi
    
    # Run Database Migrations (Placeholder)
    if [ -d "migrations" ]; then
       echo "Running migrations..."
       # Logic to apply new SQL files would go here
    fi
    
    echo "Update check complete."
    
    # Sleep for 60 seconds before next check
    echo "Waiting 60 seconds..."
    sleep 60
done
