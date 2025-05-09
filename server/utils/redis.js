import dotenv from 'dotenv';
dotenv.config({ path: '.env'});
const Redis = require('ioredis');

// const redisURL = `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
const redisURL = process.env.REDIS_URI
const msg = 'Redis connection is not alive';

class RedisClient {
    constructor() {
        if (!RedisClient.instance) {
            this.client = new Redis(redisURL);
            this.client.on('error', (error) => {
                console.error('Redis connection error:', error);
            });
            this.client.on('connect', () => {
                console.log('Redis client connected to the server');
            });
            RedisClient.instance = this; // Singleton instance for reuse
        }
        return RedisClient.instance;
    }

    async isAlive() {
        try {
            const pingResult = await this.client.ping();
            return pingResult === 'PONG';
        } catch (error) {
            console.error(msg, error);
            return false;
        }
    }

    async get(key) {
        if (await this.isAlive()) {
            return this.client.get(key);
        }
        throw new Error(msg);
    }

    async set(key, value, duration) {
        if (await this.isAlive()) {
            await this.client.set(key, value, 'EX', duration);
            return true;
        }
        throw new Error(msg);
    }

    async del(key) {
        if (await this.isAlive()) {
            return this.client.del(key);
        }
        throw new Error(msg);
    }

    // Blacklist methods for token management
    async addToBlacklist(staffId, tokenId) {
        if (await this.isAlive()) {
            await this.client.sadd(`blacklistedTokens:${staffId}`, tokenId);
            return true;
        }
        throw new Error(msg);
    }

    async isInBlacklist(staffId, tokenId) {
        if (await this.isAlive()) {
            return this.client.sismember(`blacklistedTokens:${staffId}`, tokenId);
        }
        throw new Error(msg);
    }

    async removeFromBlacklist(staffId, tokenId) {
        if (await this.isAlive()) {
            await this.client.srem(`blacklistedTokens:${staffId}`, tokenId);
            return true;
        }
        throw new Error(msg);
    }
}

const redisClient = new RedisClient();
module.exports = redisClient;
