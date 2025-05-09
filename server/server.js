                  import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import SecurityConfig from './utils/config';

//  import router from './routes/router';
import redisClient from './utils/redis';
import dbClient from '../server/database/mongoDB';

const router = require('./routes/router');

dotenv.config({ path: '.env' });

const app = express();
const securityConfig = new SecurityConfig();
const { corsOptions } = securityConfig;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Routes
app.use(router);
const port = process.env.EXPRESS_PORT;

// Initial check for Redis and MongoDB
(async function startServer() {
   
    try {
        const redisStatus = await redisClient.isAlive();
        if (!redisStatus) {
            console.error('Failed to initialize Redis');
            process.exit(1);
        }
        await dbClient.connect(); // Ensure DB connection
        if (await dbClient.isAlive()) {
            console.log('Database connection established successfully!');
        } else {
            console.error('Database connection failed!');
            process.exit(1);
        }
        app.listen(port, () => {
            console.log(`Server is listening on http://localhost:${port}`);
        });
    } catch (error) {
        console.error({
            info: 'Server failed to start',
            error,
            details: error.message,
        });
        process.exit(1);
    }
}());

module.exports = app;