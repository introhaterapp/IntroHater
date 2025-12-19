const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const mongoService = require('./mongodb');
require('dotenv').config();

class ApiKeyService {
  constructor() {
    this.apiKeys = null;
    this.apiUsage = null;
  }

  async init() {
    if (this.apiKeys && this.apiUsage) return;
    
    try {
      this.apiKeys = await mongoService.getCollection('apiKeys');
      this.apiUsage = await mongoService.getCollection('apiUsage');
      
      // Create indexes
      await this.apiKeys.createIndex({ key: 1 }, { unique: true });
      await this.apiKeys.createIndex({ userId: 1 });
      await this.apiUsage.createIndex({ apiKeyId: 1, timestamp: 1 });
      
      console.log('API Key service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize API Key service:', error);
      throw error;
    }
  }

  async generateApiKey(userId, name, permissions = [], expiresAt = null, isAdminKey = false) {
    await this.init();
    
    // Check if user already has an active API key
    const existingKeys = await this.apiKeys.find({ 
      userId, 
      isActive: true 
    }).toArray();
    
    if (existingKeys.length > 0) {
      throw new Error('You already have an active API key. Please revoke your existing key before generating a new one.');
    }
    
    // Generate a secure random API key
    const keyLength = parseInt(process.env.API_KEY_LENGTH) || 32;
    const apiKey = crypto.randomBytes(keyLength).toString('hex');
    
    const keyDoc = {
      userId,
      name,
      key: apiKey,
      permissions,
      expiresAt,
      createdAt: new Date(),
      lastUsed: null,
      isActive: true,
      isAdminKey // New field for unlimited access
    };
    
    const result = await this.apiKeys.insertOne(keyDoc);
    return { ...keyDoc, _id: result.insertedId };
  }

  async validateApiKey(apiKey) {
    await this.init();
    
    const keyDoc = await this.apiKeys.findOne({ key: apiKey, isActive: true });
    
    if (!keyDoc) {
      return null;
    }
    
    // Check if key has expired
    if (keyDoc.expiresAt && new Date() > new Date(keyDoc.expiresAt)) {
      return null;
    }
    
    // Update last used timestamp
    await this.apiKeys.updateOne(
      { _id: keyDoc._id },
      { $set: { lastUsed: new Date() } }
    );
    
    return keyDoc;
  }

  async trackUsage(apiKeyId, endpoint, responseTime, statusCode) {
    await this.init();
    
    const usage = {
      apiKeyId,
      endpoint,
      timestamp: new Date(),
      responseTime,
      statusCode
    };
    
    await this.apiUsage.insertOne(usage);
  }

  async getKeysByUser(userId) {
    await this.init();
    return await this.apiKeys.find({ userId }).toArray();
  }

  async revokeKey(keyId) {
    await this.init();
    
    const objectId = new ObjectId(keyId);
    
    // Delete the API key
    const result = await this.apiKeys.deleteOne({ _id: objectId });
    
    // Also delete all associated usage data
    await this.apiUsage.deleteMany({ apiKeyId: objectId });
    
    return result.deletedCount > 0;
  }

  async getUsageStats(apiKeyId, startDate, endDate) {
    await this.init();
    
    const query = { apiKeyId: new ObjectId(apiKeyId) };
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    
    const stats = await this.apiUsage.aggregate([
      { $match: query },
      { $group: {
        _id: "$endpoint",
        count: { $sum: 1 },
        avgResponseTime: { $avg: "$responseTime" },
        statusCodes: { $push: "$statusCode" }
      }}
    ]).toArray();
    
    return stats;
  }

  async getAllKeys() {
    await this.init();
    return await this.apiKeys.find({}).toArray();
  }
  
  async getKeyDetails(keyId) {
    await this.init();
    return await this.apiKeys.findOne({ _id: new ObjectId(keyId) });
  }
  
  async getKeysWithUserInfo() {
    await this.init();
    
    // Aggregate to join with user info if available
    const keysWithUsers = await this.apiKeys.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "userId",
          as: "userInfo"
        }
      },
      {
        $project: {
          _id: 1,
          userId: 1,
          name: 1,
          key: { $concat: [{ $substr: ["$key", 0, 4] }, "...", { $substr: ["$key", { $subtract: [{ $strLenCP: "$key" }, 4] }, 4] }] },
          permissions: 1,
          createdAt: 1,
          lastUsed: 1,
          isActive: 1,
          expiresAt: 1,
          userEmail: { $arrayElemAt: ["$userInfo.email", 0] },
          userName: { $arrayElemAt: ["$userInfo.name", 0] }
        }
      }
    ]).toArray();
    
    return keysWithUsers;
  }
  
  async getUsageForAllKeys(startDate, endDate) {
    await this.init();
    
    const query = {};
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    
    const stats = await this.apiUsage.aggregate([
      { $match: query },
      { $group: {
        _id: "$apiKeyId",
        totalCalls: { $sum: 1 },
        avgResponseTime: { $avg: "$responseTime" },
        endpoints: { $addToSet: "$endpoint" }
      }},
      {
        $lookup: {
          from: "apiKeys",
          localField: "_id",
          foreignField: "_id",
          as: "keyInfo"
        }
      },
      {
        $project: {
          _id: 1,
          totalCalls: 1,
          avgResponseTime: 1,
          endpoints: 1,
          userId: { $arrayElemAt: ["$keyInfo.userId", 0] },
          keyName: { $arrayElemAt: ["$keyInfo.name", 0] },
          isActive: { $arrayElemAt: ["$keyInfo.isActive", 0] }
        }
      }
    ]).toArray();
    
    return stats;
  }
}

module.exports = new ApiKeyService();