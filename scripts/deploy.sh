#!/bin/bash
set -e

echo "Starting IntroHater deployment with MongoDB support..."

# Define directory paths
APP_DIR="/home/ubuntu/app"
SCRIPTS_DIR="$APP_DIR/scripts"

# Check if MongoDB is installed
if ! command -v mongod &> /dev/null; then
    echo "MongoDB not found. Installing..."
    # Make the installation script executable
    chmod +x $SCRIPTS_DIR/install_mongodb.sh
    $SCRIPTS_DIR/install_mongodb.sh
else
    echo "MongoDB is already installed."
fi

# Check if MongoDB is running
if ! systemctl is-active --quiet mongod; then
    echo "Starting MongoDB..."
    sudo systemctl start mongod
    sudo systemctl enable mongod
fi

# Install or update npm dependencies
echo "Installing NPM dependencies..."
cd $APP_DIR
npm install --production

# Check for and create .env file if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file..."
    cat > $APP_DIR/.env << EOL
TOKEN_SECRET=${TOKEN_SECRET:-"REDACTED"}
ORACLE_REGION=${ORACLE_REGION:-"us-phoenix-1"}
ORACLE_COMPARTMENT_ID=${ORACLE_COMPARTMENT_ID:-"REDACTED"}

# MongoDB Configuration
MONGODB_URI=mongodb://introhater_admin:REDACTED@localhost:27017/introHater?authSource=admin

# Auth0 Configuration
AUTH0_DOMAIN=${AUTH0_DOMAIN:-"your-tenant.auth0.com"}
AUTH0_AUDIENCE=${AUTH0_AUDIENCE:-"https://api.yourdomain.com"}
AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID:-"your-client-id"}
AUTH0_CLIENT_SECRET=${AUTH0_CLIENT_SECRET:-"your-client-secret"}

# API Configuration
API_KEY_LENGTH=32
API_RATE_LIMIT=100
API_RATE_WINDOW_MS=900000
ADMIN_EMAILS${ADMIN_EMAILS:-"your-email@gmail.com"}

EOL
    echo ".env file created."
else
    echo ".env file already exists."
    
    # Ensure MongoDB connection string exists in .env
    if ! grep -q "MONGODB_URI" "$APP_DIR/.env"; then
        echo "Adding MongoDB connection to .env..."
        echo "MONGODB_URI=mongodb://introhater_admin:REDACTED@localhost:27017/introHater?authSource=admin" >> $APP_DIR/.env
    fi
fi

# Set up the systemd service
echo "Setting up systemd service for IntroHater..."
sudo cp $SCRIPTS_DIR/introhater.service /etc/systemd/system/
sudo systemctl daemon-reload

# Start/restart the service
echo "Starting IntroHater service..."
sudo systemctl restart introhater
sudo systemctl enable introhater

# Check service status
echo "Service status:"
sudo systemctl status introhater --no-pager

echo "Deployment completed successfully!"
echo "IntroHater API is now available with MongoDB integration for external application access."
echo "API documentation is available at: http://your-server-ip/api/docs"