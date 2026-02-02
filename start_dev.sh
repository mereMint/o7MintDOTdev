#!/bin/bash

echo "Starting MintDEV Development Environment..."
echo "----------------------------------------"

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install it from nodejs.org."
    exit 1
fi

echo "Node.js version: $(node -v)"

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Check for Database (Warning only)
echo ""
echo "NOTE: Ensure MariaDB is running on localhost (User: root, Pass: empty, DB: mintdev_db)"
echo "If you haven't set up the DB, the API endpoints might fail (will use in-memory mode)."
echo ""

# Start Server
echo "Starting Server..."
npm start
