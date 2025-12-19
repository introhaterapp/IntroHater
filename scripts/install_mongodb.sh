#!/bin/bash
set -e

echo "Installing MongoDB..."

# Determine Ubuntu version
OS_VERSION=$(lsb_release -rs)
OS_CODENAME=$(lsb_release -cs)
echo "Detected Ubuntu $OS_VERSION ($OS_CODENAME)"

# Check if MongoDB is already installed
if command -v mongod &> /dev/null; then
    echo "MongoDB is already installed. Checking version..."
    MONGO_VERSION=$(mongod --version | grep -oP "db version v\K[0-9\.]+")
    echo "Current MongoDB version: $MONGO_VERSION"
    
    read -p "Do you want to reinstall/upgrade MongoDB? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping MongoDB installation."
        exit 0
    fi
fi

# Import the MongoDB public GPG Key
echo "Importing MongoDB GPG key..."
curl -fsSL https://pgp.mongodb.com/server-6.0.asc | \
    sudo gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg --dearmor

# Create a list file for MongoDB
echo "Creating MongoDB repository list file..."
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${OS_CODENAME}/mongodb-org/6.0 multiverse" | \
    sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Reload local package database
echo "Updating package lists..."
sudo apt-get update

# Install the MongoDB packages
echo "Installing MongoDB packages..."
sudo apt-get install -y mongodb-org

# Enable MongoDB service
echo "Enabling MongoDB service..."
sudo systemctl daemon-reload
sudo systemctl enable mongod

# Start MongoDB service
echo "Starting MongoDB service..."
sudo systemctl start mongod
sleep 3  # Give MongoDB time to start

# Check if MongoDB is running
if ! systemctl is-active --quiet mongod; then
    echo "ERROR: MongoDB failed to start. Please check the logs:"
    echo "  sudo journalctl -u mongod.service"
    exit 1
fi

echo "MongoDB successfully installed and started."

# Create a MongoDB user for the application
echo "Configuring MongoDB security and creating application user..."

# Create a MongoDB admin user
cat > /tmp/mongo_setup.js << EOF
// Create admin user
db = db.getSiblingDB('admin');
try {
  db.createUser({
    user: "introhater_admin",
    pwd: "REDACTED",
    roles: [
      { role: "userAdminAnyDatabase", db: "admin" },
      { role: "readWriteAnyDatabase", db: "admin" }
    ]
  });
  print("Admin user created successfully");
} catch (e) {
  if (e.code === 51003) {
    print("Admin user already exists. Skipping creation.");
  } else {
    throw e;
  }
}

// Initialize the application database
db = db.getSiblingDB('introHater');
try {
  db.createCollection("apiKeys");
  print("Created collection: apiKeys");
} catch (e) {
  print("Collection apiKeys may already exist: " + e.message);
}

try {
  db.createCollection("apiUsage");
  print("Created collection: apiUsage");
} catch (e) {
  print("Collection apiUsage may already exist: " + e.message);
}

// Create indexes for performance
db.apiKeys.createIndex({ "key": 1 }, { unique: true });
db.apiKeys.createIndex({ "userId": 1 });
db.apiUsage.createIndex({ "apiKeyId": 1, "timestamp": 1 });

print("Database setup complete!");
EOF

# Run the MongoDB setup script
echo "Running MongoDB setup script..."
mongosh admin /tmp/mongo_setup.js

# Clean up
rm /tmp/mongo_setup.js

# Enable MongoDB authentication
echo "Configuring MongoDB to require authentication..."
if ! grep -q "^security:" /etc/mongod.conf; then
    echo "
security:
  authorization: enabled" | sudo tee -a /etc/mongod.conf
elif ! grep -q "^security:.* authorization:" /etc/mongod.conf; then
    sudo sed -i '/^security:/a \ \ authorization: enabled' /etc/mongod.conf
else
    sudo sed -i 's/^security:.* authorization:.*/security:\n  authorization: enabled/' /etc/mongod.conf
fi

# Restart MongoDB to apply the authentication changes
echo "Restarting MongoDB to apply security changes..."
sudo systemctl restart mongod

echo "MongoDB installation and setup completed successfully!"
echo "Connection string: mongodb://introhater_admin:REDACTED@localhost:27017/introHater?authSource=admin"