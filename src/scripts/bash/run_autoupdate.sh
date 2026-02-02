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
    
    # Run Database Migrations
    if [ -f "src/sql/db_init.sql" ]; then
        echo "Running database migrations..."
        # Apply schema updates - MariaDB will ignore if tables/columns exist
        mariadb -u root mintdev_db < src/sql/db_init.sql 2>/dev/null || echo "Schema already up to date"
        
        # Apply additional migrations for new columns
        echo "Applying column migrations..."
        mariadb -u root mintdev_db -e "ALTER TABLE users ADD COLUMN IF NOT EXISTS decoration VARCHAR(50) DEFAULT NULL;" 2>/dev/null || true
        mariadb -u root mintdev_db -e "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(500) DEFAULT NULL;" 2>/dev/null || true
        mariadb -u root mintdev_db -e "ALTER TABLE users ADD COLUMN IF NOT EXISTS points INT DEFAULT 0;" 2>/dev/null || true
        mariadb -u root mintdev_db -e "ALTER TABLE users ADD COLUMN IF NOT EXISTS inventory JSON;" 2>/dev/null || true
        mariadb -u root mintdev_db -e "ALTER TABLE scores ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255);" 2>/dev/null || true
        mariadb -u root mintdev_db -e "ALTER TABLE scores ADD COLUMN IF NOT EXISTS avatar VARCHAR(255);" 2>/dev/null || true
        echo "Database migrations complete."
    fi
    
    echo "Update check complete."
    
    # Sleep for 60 seconds before next check
    echo "Waiting 60 seconds..."
    sleep 60
done
