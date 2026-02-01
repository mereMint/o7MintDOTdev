#!/bin/bash

# MintDEV Setup Script

echo "Starting MintDEV Setup..."

# Update and Upgrade
# Update and Upgrade (Non-interactive)
echo "Updating system packages..."
pkg update -y
# Use apt-get directly with options to avoid prompts (confdef/confold keeps existing config)
apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade

# Install Dependencies
echo "Installing dependencies..."
pkg install nodejs git mariadb -y

# Check if Cloudflared is installed (Termux might need specific steps, this is a placeholder generic install)
if ! command -v cloudflared &> /dev/null; then
    echo "Cloudflared not found. Please install Cloudflared manually or via a separate script for your architecture."
    # Note: Cloudflared install on Android/Termux can vary. 
fi

# Clone/Pull Project
if [ -d ".git" ]; then
    echo "Already inside the repository."
else
    echo "Not in a git repository. Preparing to clone..."
    # Ensure git is installed
    if ! command -v git &> /dev/null; then
        echo "Git not found. Installing..."
        pkg install git -y
    fi

    TARGET_DIR="$HOME/MintDEV"
    
    if [ -d "$TARGET_DIR" ]; then
        echo "Directory $TARGET_DIR already exists."
        cd "$TARGET_DIR"
        echo "Pulling latest changes..."
        git pull origin main
    else
        echo "Cloning repository to $TARGET_DIR..."
        git clone https://github.com/mereMint/o7MintDOTdev.git "$TARGET_DIR"
        cd "$TARGET_DIR"
    fi
fi

# Install NPM dependencies
if [ -f "package.json" ]; then
    echo "Installing Node.js dependencies..."
    npm install
fi

# Initialize Database
echo "Initializing Database..."
# Start MariaDB server if not running
# Start MariaDB server if not running
mkdir -p $PREFIX/var/lib/mysql
mariadbd-safe &
sleep 5 # Wait for DB to start

# Run DB Init SQL
if [ -f "src/sql/db_init.sql" ]; then
    mariadb -u root < src/sql/db_init.sql
    echo "Database initialized."
else
    echo "db_init.sql not found."
fi

echo "Setup Complete!"
