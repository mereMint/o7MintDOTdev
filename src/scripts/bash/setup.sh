#!/bin/bash

# MintDEV Setup Script

echo "Starting MintDEV Setup..."

# Update and Upgrade
echo "Updating system packages..."
pkg update -y && pkg upgrade -y

# Install Dependencies
echo "Installing dependencies..."
pkg install nodejs git mariadb -y

# Check if Cloudflared is installed (Termux might need specific steps, this is a placeholder generic install)
if ! command -v cloudflared &> /dev/null; then
    echo "Cloudflared not found. Please install Cloudflared manually or via a separate script for your architecture."
    # Note: Cloudflared install on Android/Termux can vary. 
fi

# Clone/Pull Project (Assuming this script is run from within the cloned repo or a bootstrap location)
# If this is a bootstrap script, it should clone the repo.
# If running inside repo, we skip cloning.

# Install NPM dependencies
if [ -f "package.json" ]; then
    echo "Installing Node.js dependencies..."
    npm install
fi

# Initialize Database
echo "Initializing Database..."
# Start MariaDB server if not running
mkdir -p $PREFIX/var/lib/mysql
mysqld_safe &
sleep 5 # Wait for DB to start

# Run DB Init SQL
if [ -f "src/sql/db_init.sql" ]; then
    mysql -u $(whoami) < src/sql/db_init.sql
    echo "Database initialized."
else
    echo "db_init.sql not found."
fi

echo "Setup Complete!"
