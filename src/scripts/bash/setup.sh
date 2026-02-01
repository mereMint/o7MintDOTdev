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
# Install Dependencies
echo "Installing dependencies..."
pkg install nodejs git mariadb termux-api golang -y

# Install Cloudflared (Build from source for Termux)
if ! command -v cloudflared &> /dev/null; then
    echo "Cloudflared not found. Building from source..."
    
    # Create temp build dir
    BUILD_DIR=$(mktemp -d)
    echo "Cloning Cloudflared to $BUILD_DIR..."
    git clone https://github.com/cloudflare/cloudflared.git "$BUILD_DIR"
    
    # Build
    echo "Building Cloudflared (this may take a while)..."
    cd "$BUILD_DIR"
    go build -o cloudflared -ldflags "-s -w" ./cmd/cloudflared
    
    # Install
    echo "Installing binary..."
    mv cloudflared $PREFIX/bin/
    chmod +x $PREFIX/bin/cloudflared
    
    # Cleanup
    cd "$HOME"
    rm -rf "$BUILD_DIR"
    
    echo "Cloudflared installed successfully."
else
    echo "Cloudflared is already installed."
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
