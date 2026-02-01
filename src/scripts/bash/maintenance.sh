#!/bin/bash

# MintDEV Maintenance Script

echo "Checking for updates..."

# Pull latest changes
git pull origin main

# Update dependencies
if [ -f "package.json" ]; then
    echo "Updating Node.js dependencies..."
    npm install
fi

# Run Database Migrations (Placeholder - assumes simple SQL file execution for now)
# In a real app, use a migration tool.
if [ -d "migrations" ]; then
   echo "Running migrations..."
   # Logic to apply new SQL files would go here
fi


echo "Maintenance complete. Starting web server..."
npm start
