import dotenv from 'dotenv';
dotenv.config({
    path: '.env',
});
const crypto = require('crypto');

class SecurityConfig {

    get corsOptions() {
        return {
            origin: [
                "http://localhost:3000",
                "http://localhost:8081"
            ],
            methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
            credentials: true,
            allowedHeaders: [
                'Origin',
                'X-Requested-With',
                'Content-Type',
                'Accept',
                'X-Auth-Token',
                'Authorization',
                'X-Token',
            ],
            preflightContinue: false, // Allow Express to handle preflight automatically
            optionsSuccessStatus: 200, // Ensure status 200 with headers for OPTIONS
        };
    }
}

export default SecurityConfig;