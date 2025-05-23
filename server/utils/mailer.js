require('dotenv').config({
    path: '../server/.env',
});
const nodemailer = require('nodemailer');
const { SERVICE, CLIENT, PASS, HOST, MAILER_PORT } = process.env;

class MailClient {
    static getTransporter() {
        return nodemailer.createTransport({
            service: SERVICE,
            port: MAILER_PORT,
            secure: true,
            host: HOST,
            auth: {
                user: CLIENT,
                pass: PASS,
            },
        });
    }

    // Static method to send the reset token
    static async passwordResetToken(email, token) {
        const transporter = this.getTransporter(); // Call getTransporter to initialize transporter
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'Password Reset Token',
                html: `
                    <p>Dear ${fullName},</p>
                    <p>To reset your password, please use the following token:</p>
                    <h3>${token}</h3>
                    <p>This token is valid for 5 minutes. Do not share it with anyone.</p>
                    <p>If you did not request this token, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `,
            });
        } catch (error) {
            console.error('Error sending password reset email:', error);
            throw new Error('Failed to send email');
        }
    }


    // Static method to send the reset token
    static async sendEmailToken(email, token) {
        const transporter = this.getTransporter(); // Call getTransporter to initialize transporter
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'Email Verification Token',
                html: `
                    <h1>Welcome to AAngLogistics Service</h1>
                    <p>Please copy and paste this token to verify your email address:</p>
                    <h3>${token}</h3>
                    <p>This token will expire in 15 minutes.</p>
                    <p>If this request was not created by you, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `
            });
        } catch (error) {
            console.error('Error sending password reset email:', error);
            throw new Error('Failed to send email');
        }
    }
}

// Export the class itself, instead of an instance
module.exports = MailClient;