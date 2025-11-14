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
                    <h1>AAngLogistics Service</h1>
                    <p>To reset your password, please use the following token:</p>
                    <h3>${token}</h3>
                    <p>This token is valid for 5 minutes. Do not share it with anyone.</p>
                    <p>If you did not request this token, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `,
            });
        } catch (error) {
            console.log('Error sending password reset email:', error);
            throw new Error('Failed to send email');
        }
    }

    // Static method to send the reset token
    static async sendEmailToken(email, token) {
        const transporter = this.getTransporter(); // Call getTransporter to initialize transporter
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,  // 'y.abdulwasiu@gmail.com ',
                subject: 'Email Verification Token',
                html: `
                    <h1>Welcome to AAngLogistics Service</h1>
                    <p>Please copy and paste this token to verify your email address:</p>
                    <h3>${token}</h3>
                    <p>This token will expire in 10 minutes.</p>
                    <p>If this request was not created by you, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `
            });
        } catch (error) {
            console.log('Error sending password reset email:', error);
            throw new Error('Failed to send email');
        }
    }

    // Static method to send the reset token
    static async authResetToken(email, token) {
        const transporter = this.getTransporter(); // Call getTransporter to initialize transporter
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'PIN Reset/Update Token',
                html: `
                    <h1>AAngLogistics Service</h1>
                    <p>To reset/update your PIN, please use the following token:</p>
                    <h3>${token}</h3>
                    <p>This token is valid for 5 minutes. Do not share it with anyone.</p>
                    <p>If you did not request this token, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `,
            });
        } catch (error) {
            console.log('Error sending password reset email:', error);
            throw new Error('Failed to send email');
        }
    }

    // static methods
    // when the driver arrives and will be requiring confirmation token
    // after a successful delivery  -- congratulations to client , congratulations to driver on his delivery
    static async driverArrivalToken(email, token, driverName, vehicleNumber) {
        const transporter = this.getTransporter();
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'Driver Arrival Confirmation - AAngLogistics',
                html: `
                    <h1>AAngLogistics Service</h1>
                    <p>Your driver has arrived at the location.</p>
                    <p><strong>Driver:</strong> ${driverName}</p>
                    <p><strong>Vehicle:</strong> ${vehicleNumber}</p>
                    <p>Please provide the following confirmation token to the driver:</p>
                    <h3>${token}</h3>
                    <p>Do not share it with anyone.</p>
                    <p>If you did not request this service, please ignore this email.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `,
            });
        } catch (error) {
            console.log('Error sending driver arrival email:', error);
            throw new Error('Failed to send driver arrival email');
        }
    }

    // Successful delivery notification to client
    static async deliverySuccessClient(email, orderRef, deliveryDate, driverName) {
        const transporter = this.getTransporter();
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'Delivery Completed Successfully - AAngLogistics',
                html: `
                    <h1>Delivery Completed Successfully!</h1>
                    <p>Your package has been delivered successfully.</p>
                    <p><strong>Tracking Number:</strong> ${orderRef}</p>
                    <p><strong>Delivered By:</strong> ${driverName}</p>
                    <p><strong>Delivery Date:</strong> ${deliveryDate}</p>
                    <p>Thank you for choosing AAngLogistics for your delivery needs.</p>
                    <p>If you have any questions about your delivery, please contact our support team.</p>
                    <p>Best regards,<br/>AAngLogistics Support</p>
                `,
            });
        } catch (error) {
            console.log('Error sending delivery success email to client:', error);
            throw new Error('Failed to send delivery success email');
        }
    }

    // Successful delivery notification to driver
    static async deliverySuccessDriver(email, orderRef, deliveryDate, clientName) {
        const transporter = this.getTransporter();
        try {
            await transporter.sendMail({
                from: 'isola.remilekun@gmail.com',
                to: email,
                subject: 'Delivery Completed Successfully - AAngLogistics',
                html: `
                    <h1>Delivery Completed Successfully!</h1>
                    <p>Congratulations on successfully completing the delivery.</p>
                    <p><strong>Tracking Number:</strong> ${orderRef}</p>
                    <p><strong>Client:</strong> ${clientName}</p>
                    <p><strong>Delivery Date:</strong> ${deliveryDate}</p>
                    <p>Thank you for your excellent service and professionalism.</p>
                    <p>Your commitment helps us maintain our high standards of service.</p>
                    <p>Best regards,<br/>AAngLogistics Management</p>
                `,
            });
        } catch (error) {
            console.log('Error sending delivery success email to driver:', error);
            throw new Error('Failed to send delivery success email');
        }
    }
}

// Export the class itself, instead of an instance
module.exports = MailClient;