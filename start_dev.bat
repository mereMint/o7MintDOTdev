@echo off
TITLE MintDEV Server
ECHO Starting MintDEV Development Environment...
ECHO ----------------------------------------

:: Check if Node is installed
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO Error: Node.js is not installed. Please install it from nodejs.org.
    PAUSE
    EXIT /B
)

:: Check dependencies
IF NOT EXIST "node_modules" (
    ECHO Installing dependencies...
    npm install
)

:: Check for Database (Warning only)
ECHO.
ECHO NOTE: Ensure MariaDB is running on localhost (User: root, Pass: empty, DB: mintdev_db)
ECHO If you haven't set up the DB on Windows, the API endpoints might fail.
ECHO.

:: Start Server
ECHO Starting Server...
npm start

PAUSE
