import AuthController from "./AuthController";
import {profileUpdateSchema, validateSchema, avatarSchema} from "../validators/validateAuth";
import getModels from "../models/AAng/AAngLogistics";
import locationSchema from "../validators/locationValidator";
import mongoose from "mongoose";
import getOrderModels from "../models/Order";
import getAnalyticsModels from "../models/Analytics/DriverAnalytics";
import AnalyticsMigration from '../utils/migrateAnalytics.js';
import MailClient from "../utils/mailer";
import NotificationService from "../services/NotificationService";
import Notification from '../models/Notification';

const DELIVERY_STAGES = {
    DISCOVERING: 'discovering',
    ACCEPTED: 'accepted',
    ARRIVED_PICKUP: 'arrived_pickup',
    PICKED_UP: 'picked_up',
    ARRIVED_DROPOFF: 'arrived_dropoff',
    DELIVERED: 'delivered',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};


class DriverController {

    static async updateOnlineStatus(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {status} = req.body;

        if (!status) {
            return res.status(400).json({error: "Missing required fields"});
        }

        const dbStatus = ["online", "offline", "on-delivery", "break", "maintenance"];

        if (!dbStatus.includes(status)) {
            return res.status(400).json({error: "Unknown status instruction"});
        }

        try {
            const {Driver} = await getModels();


            // Enhanced update with operational status
            const updateData = {
                'availabilityStatus': status,
                'operationalStatus.isActive': status === 'online',
                'operationalStatus.lastActiveAt': new Date()
            };

            // If going offline, clear current order if not on-delivery
            if (status === 'offline' && userData.availabilityStatus !== 'on-delivery') {
                updateData['operationalStatus.currentOrderId'] = null;
            }

            const updatedUser = await Driver.findByIdAndUpdate(
                userData._id,
                {$set: updateData},
                {new: true}
            );

            if (!updatedUser) {
                return res.status(404).json({error: "User not found"});
            }

            console.log('Driver status updated successfully');

            // Get comprehensive dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);

            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(201).json({
                success: true,
                driverData: dashboardData
            });

        } catch (error) {
            console.log("Status update error:", error);
            return res.status(500).json({
                error: "An error occurred while updating status"
            });
        }
    }

    static async tcsAcceptance(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {acceptedTcs} = req.body;
        if (typeof acceptedTcs !== 'boolean') {
            return res.status(400).json({error: 'acceptedTcs must be a boolean'});
        }
        if (!acceptedTcs) {
            return res.status(400).json({error: 'You must accept the terms and conditions'});
        }
        const {userData} = preCheckResult;
        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // set tcs to true
            user.tcs.isAccepted = true
            user.tcs.acceptedAt = new Date();

            await user.save();

            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(user);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(200).json({
                message: "Profile updated successfully",
                user: dashboardData
            });
        } catch (err) {
            console.log('Change password error:', err);
            return res.status(500).json({error: 'Failed to change password'});
        }

    }

    static async userDashBoardData(userObject, flag = null) {
        let orderData, orderAssignments, activeOrder, recentOrders;
        const {AAngBase} = await getModels();
        const {Order, OrderAssignment} = await getOrderModels();

        // Populate user with all necessary data
        const user = await AAngBase.findById(userObject._id)
            .populate('operationalStatus.currentOrderId')
            .populate('wallet.recentTransactions.orderId')
            .lean();

        if (!user) {
            throw new Error('User not found');
        }

        // Get order-related data for drivers
        if (user.role === 'Driver') {
            // Get active order if exists
            if (user.operationalStatus?.currentOrderId) {
                activeOrder = await Order.findById(user.operationalStatus.currentOrderId)
                    .populate('clientId', 'fullName phoneNumber avatar')
                    .lean();
            }

            // Get recent completed orders (last 10)
            recentOrders = await Order.find({
                'driverAssignment.driverId': user._id,
                status: 'delivered'
            })
                .sort({'driverAssignment.actualTimes.deliveredAt': -1})
                .limit(10)
                .populate('clientId', 'fullName phoneNumber')
                .select('orderRef status pricing package location driverAssignment rating createdAt')
                .lean();

            // Get pending order assignments
            orderAssignments = await OrderAssignment.find({
                'availableDrivers.driverId': user._id,
                status: 'broadcasting'
            })
                .populate('orderId')
                .lean();
        }

        // Enhanced verification checks for drivers
        const verificationChecks = {
            Client: () => user.emailVerified === true && user.nin?.verified === true,

            Driver: () => {
                const basicChecks = user.emailVerified === true && user.nin?.verified === true;

                // Document verification status
                const documentChecks = {
                    license: user.verification?.documentsStatus?.license === 'approved',
                    vehicleRegistration: user.verification?.documentsStatus?.vehicleRegistration === 'approved',
                    insurance: user.verification?.documentsStatus?.insurance === 'approved',
                    roadWorthiness: user.verification?.documentsStatus?.roadWorthiness === 'approved',
                    profilePhoto: user.verification?.documentsStatus?.profilePhoto === 'approved',
                    backgroundCheck: user.verification?.documentsStatus?.backgroundCheck === 'approved'
                };

                const allDocumentsApproved = Object.values(documentChecks).every(status => status === true);

                return basicChecks && allDocumentsApproved;
            },

            Admin: () => true,
        };

        const isFullyVerified = verificationChecks[user.role]?.() || false;

        // Calculate profile completion percentage for drivers
        let profileCompletion = 100;
        if (user.role === 'Driver') {
            const completionChecks = [
                user.emailVerified,
                user.phoneNumber,
                user.fullName,
                user.vehicleDetails?.plateNumber,
                user.vehicleDetails?.type,
                user.verification?.documentsStatus?.license === 'approved',
                user.verification?.documentsStatus?.vehicleRegistration === 'approved',
                user.verification?.documentsStatus?.insurance === 'approved',
                user.wallet?.bankDetails?.accountNumber,
            ].filter(Boolean).length;

            profileCompletion = Math.round((completionChecks / 9) * 100);
        }

        // Enhanced dashboard data structure
        return {
            // Basic user info
            id: user._id.toString(),
            email: user.email,
            fullName: user.fullName,
            avatar: user.avatar,
            role: user.role.toLowerCase(),
            phoneNumber: user.phoneNumber,
            gender: user.gender,
            dob: user.dob ? new Date(user.dob).toISOString() : null,
            savedLocations: user.savedLocations || [],
            address: user.address,
            state: user.state,
            lga: user.lga,

            // Authentication & Verification
            emailVerified: user.emailVerified,
            ninVerified: user.nin?.verified || false,
            isFullyVerified,
            profileCompletion,

            // Driver-specific operational data
            availabilityStatus: user.availabilityStatus || 'offline',
            operationalStatus: user.operationalStatus ? {
                currentOrderId: user.operationalStatus.currentOrderId?._id || null,
                lastLocationUpdate: user.operationalStatus.lastLocationUpdate,
                connectionQuality: user.operationalStatus.connectionQuality,
                isActive: user.operationalStatus.isActive,
                lastActiveAt: user.operationalStatus.lastActiveAt
            } : null,

            currentLocation: user.currentLocation ? {
                coordinates: user.currentLocation.coordinates,
                address: user.currentLocation.address,
                timestamp: user.currentLocation.timestamp,
                isMoving: user.currentLocation.isMoving
            } : null,

            // Vehicle details
            vehicleDetails: user.vehicleDetails ? {
                type: user.vehicleDetails.type,
                plateNumber: user.vehicleDetails.plateNumber,
                model: user.vehicleDetails.model,
                year: user.vehicleDetails.year,
                color: user.vehicleDetails.color,
                capacity: user.vehicleDetails.capacity,
                insuranceExpiry: user.vehicleDetails.insuranceExpiry,
                registrationExpiry: user.vehicleDetails.registrationExpiry
            } : null,

            // Performance metrics
            performance: user.performance ? {
                totalDeliveries: user.performance.totalDeliveries || 0,
                completionRate: user.performance.completionRate || 0,
                averageRating: user.performance.averageRating || 0,
                averageDeliveryTime: user.performance.averageDeliveryTime || 0,
                onTimeDeliveryRate: user.performance.onTimeDeliveryRate || 0,
                cancellationRate: user.performance.cancellationRate || 0,
                averageResponseTime: user.performance.averageResponseTime || 0,

                weeklyStats: user.performance.weeklyStats || {
                    deliveries: 0,
                    earnings: 0,
                    hoursOnline: 0,
                    distance: 0,
                    fuelCost: 0,
                    rating: 0
                },

                monthlyStats: user.performance.monthlyStats || {
                    deliveries: 0,
                    earnings: 0,
                    hoursOnline: 0,
                    distance: 0,
                    fuelCost: 0,
                    rating: 0
                }
            } : null,

            // Wallet and financial data
            wallet: user.wallet ? {
                balance: user.wallet.balance || 0,
                pendingEarnings: user.wallet.pendingEarnings || 0,
                totalEarnings: user.wallet.totalEarnings || 0,
                totalWithdrawn: user.wallet.totalWithdrawn || 0,

                bankDetails: user.wallet.bankDetails ? {
                    accountName: user.wallet.bankDetails.accountName,
                    accountNumber: user.wallet.bankDetails.accountNumber,
                    bankName: user.wallet.bankDetails.bankName,
                    verified: user.wallet.bankDetails.verified
                } : null,

                recentTransactions: user.wallet.recentTransactions?.map(tx => ({
                    type: tx.type,
                    amount: tx.amount,
                    description: tx.description,
                    timestamp: tx.timestamp,
                    reference: tx.reference
                })) || []
            } : null,

            // Verification and compliance
            verification: user.verification ? {
                documentsStatus: user.verification.documentsStatus || {},
                overallStatus: user.verification.overallStatus || 'pending',
                complianceScore: user.verification.complianceScore || 100
            } : null,

            // Schedule and availability
            schedule: user.schedule ? {
                preferredWorkingHours: user.schedule.preferredWorkingHours,
                currentShift: user.schedule.currentShift,
                timeOff: user.schedule.timeOff
            } : null,

            // Order data (crucial for driver operations)
            orderData: {
                activeOrder: activeOrder ? {
                    id: activeOrder._id,
                    orderRef: activeOrder.orderRef,
                    status: activeOrder.status,
                    client: {
                        id: activeOrder.clientId?._id,
                        name: activeOrder.clientId?.fullName,
                        phone: activeOrder.clientId?.phoneNumber
                    },
                    package: activeOrder.package,
                    location: activeOrder.location,
                    pricing: activeOrder.pricing,
                    deliveryWindow: activeOrder.deliveryWindow,
                    trackingHistory: activeOrder.orderTrackingHistory
                } : null,

                recentOrders: recentOrders?.map(order => ({
                    id: order._id,
                    orderRef: order.orderRef,
                    status: order.status,
                    clientName: order.clientId?.fullName,
                    pickupLocation: order.location?.pickUp?.address,
                    dropoffLocation: order.location?.dropOff?.address,
                    earnings: order.pricing?.totalAmount || 0,
                    completedAt: order.driverAssignment?.actualTimes?.deliveredAt,
                    rating: order.rating?.clientRating?.stars,
                    clientFeedback: order.rating?.clientRating?.feedback
                })) || [],

                pendingAssignments: orderAssignments?.map(assignment => ({
                    id: assignment._id,
                    orderId: assignment.orderId?._id,
                    orderRef: assignment.orderId?.orderRef,
                    broadcastRadius: assignment.broadcastRadius,
                    timeoutDuration: assignment.timeoutDuration,
                    notifiedAt: assignment.availableDrivers?.find(d => d.driverId.toString() === user._id.toString())?.notifiedAt
                })) || []
            },

            // Emergency and safety
            emergency: user.emergency ? {
                emergencyContact: user.emergency.emergencyContact,
                safetyFeatures: user.emergency.safetyFeatures
            } : null,

            // Additional metadata
            authPin: user.authPin ? {
                isEnabled: user.authPin.isEnabled
            } : null,

            authMethods: user.authMethods?.map(method => ({
                type: method.type,
                verified: method.verified,
                lastUsed: method.lastUsed
            })) || [],

            primaryProvider: user.provider || user.preferredAuthMethod,
            tcs: {
                isAccepted: user.tcs?.isAccepted || false
            },

            // Timestamps
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
    }

    static async getDashboardData(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {AAngBase} = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({error: 'User not found'});
            }

            // Get comprehensive dashboard data with order information
            const userDashboard = await DriverController.userDashBoardData(user);

            return res.status(200).json({
                success: true,
                user: userDashboard,
                timestamp: new Date().toISOString()
            });

        } catch (err) {
            console.log('Dashboard data error:', err);
            return res.status(500).json({
                error: 'Failed to fetch dashboard data',
                details: err.message
            });
        }
    }

    static async updateProfile(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        // Extract user data from request body

        const {address, avatar, dob, fullName, gender, lga, phoneNumber, state} = req.body;

        if (!address || !dob || !fullName || !gender || !lga || !state || !phoneNumber) {
            return res.status(400).json({error: "All fields are required."});
        }

        // run the update logic with validation
        try {
            // Validate the request body against the schema
            const validation = await validateSchema(profileUpdateSchema, req.body);
            if (!validation.valid) {
                return res.status(400).json({errors: validation.errors});
            }

            // Extract validated data (avatar is optional)
            const {
                address,
                avatar, // This is now optional
                dob,
                fullName,
                gender,
                lga,
                phoneNumber,
                state
            } = req.body;

            // Prepare update object (only include avatar if it exists)
            const updateData = {
                address,
                dob,
                fullName,
                gender,
                lga,
                phoneNumber,
                state,
                ...(avatar && {avatar}) // Only add avatar if provided
            };

            const {AAngBase} = await getModels();

            // Your update logic here (e.g., MongoDB update)
            const updatedUser = await AAngBase.findByIdAndUpdate(
                userData._id,
                {$set: updateData},
                {new: true}
            );
            if (!updatedUser) {
                return res.status(404).json({error: "User not found"});
            }

            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(200).json({
                message: "Profile updated successfully",
                user: dashboardData
            });

        } catch (error) {
            console.log("Profile update error:", error);
            return res.status(500).json({
                error: "An error occurred while updating profile"
            });
        }

    }

    static async updateAvatar(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        // Extract user data from request body

        const {avatar} = req.body;

        if (!avatar) {
            return res.status(400).json({error: "Invalid credentials."});
        }

        // run the update logic with validation
        try {
            // Validate the request body against the schema
            const validation = await validateSchema(avatarSchema, req.body);
            if (!validation.valid) {
                return res.status(400).json({errors: validation.errors});
            }

            // Prepare update object (only include avatar if it exists)
            const updateData = {
                avatar
            };

            const {AAngBase} = await getModels();

            // Your update logic here (e.g., MongoDB update)
            const updatedUser = await AAngBase.findByIdAndUpdate(
                userData._id,
                {$set: updateData},
                {new: true}
            );
            if (!updatedUser) {
                return res.status(404).json({error: "User not found"});
            }

            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(200).json({
                message: "Avatar updated Successfully",
                user: dashboardData
            });

        } catch (error) {
            console.log("Profile update error:", error);
            return res.status(500).json({
                error: "An error occurred while updating avatar"
            });
        }

    }

    static async generateVerificationToken({length = 6, numericOnly = false} = {}) {
        const digits = '0123456789';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        if (numericOnly) {
            return Array.from({length}, () => digits[Math.floor(Math.random() * digits.length)]).join('');
        }

        if (length < 4) {
            throw new Error('Length must be at least 4 to satisfy 2 letters and 2 digits.');
        }

        // 2 letters
        const tokenParts = [
            ...Array.from({length: 2}, () => letters[Math.floor(Math.random() * letters.length)]),
            ...Array.from({length: 2}, () => digits[Math.floor(Math.random() * digits.length)])
        ];

        // Fill remaining with mixed letters/digits
        const mix = letters + digits;
        const remainingLength = length - tokenParts.length;
        for (let i = 0; i < remainingLength; i++) {
            tokenParts.push(mix[Math.floor(Math.random() * mix.length)]);
        }

        // Shuffle the final array
        for (let i = tokenParts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tokenParts[i], tokenParts[j]] = [tokenParts[j], tokenParts[i]];
        }

        return tokenParts.join('');
    }

    // Verification
    static async getToken(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {email, reqType} = req.body;
        const user = userData;
        if (!email) {
            return res.status(400).json({error: "Email is required."});
        }
        if (email !== userData.email) {
            return res.status(400).json({error: "Forbidden request."});
        }
        const validReqTypes = ['EmailVerification', 'PasswordReset', 'PinVerification'];
        if (!reqType || !validReqTypes.includes(reqType)) {
            return res.status(400).json({error: 'Invalid reqType of token request'});
        }
        if (reqType === 'EmailVerification' && user.emailVerified) {
            return res.status(400).json({error: 'Email is already verified'});
        }
        try {
            // Generate new verification token
            const verificationToken = await DriverController.generateVerificationToken({numericOnly: true});
            // Set token expiry to 10 mins
            const verificationTokenExpiry = Date.now() + 600000; // 10 minutes

            if (reqType === 'PinVerification') {
                user.authPinResetToken = verificationToken;
                user.authPinResetExpiry = verificationTokenExpiry;
            } else if (reqType === 'PasswordReset') {
                user.resetPasswordToken = verificationToken;
                user.resetPasswordExpiry = verificationTokenExpiry;
            } else if (reqType === 'EmailVerification') {
                user.emailVerificationToken = verificationToken;
                user.emailVerificationExpiry = verificationTokenExpiry;
            }
            await user.save();

            // Send verification email token according to the reqType
            switch (reqType) {
                case "EmailVerification":
                    await MailClient.sendEmailToken(user.email, verificationToken);
                    break;
                case "PasswordReset":
                    await MailClient.passwordResetToken(user.email, verificationToken);
                    break;
                case "PinVerification":
                    await MailClient.authResetToken(user.email, verificationToken);
                    break;
                default:
                    break;
            }

            // await MailClient.sendEmailToken(user.email, verificationToken);
            console.log('Operation Successful');

            return res.status(201).json({message: 'Verification Token sent successfully'});

        } catch (error) {
            console.log('Operation Failed: ', error);
            return res.status(500).json({error: 'Failed to send verification token'});
        }
    }

    static async verifyEmail(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }
        const {email, token, reqType} = req.body;
        if (!email || !token || reqType !== 'EmailVerification') {
            return res.status(400).json({error: 'Invalid request format or type'});
        }

        try {
            const user = await DriverController.verifyToken(reqType, token);

            user.emailVerified = true;
            user.emailVerificationToken = undefined;
            user.emailVerificationExpiry = undefined;

            const credentialsIndex = user.authMethods.findIndex(m => m.type === 'Credentials');
            if (credentialsIndex !== -1) {
                user.authMethods[credentialsIndex].verified = true;
            }

            await user.save();

            // get userDashboard data
            const userDashboard = await DriverController.userDashBoardData(user)


            return res.status(201).json({
                message: 'Email verified successfully',
                user: userDashboard,
            });
        } catch (err) {
            console.log('Email verification failed:', err.message);
            return res.status(400).json({error: err.message});
        }
    }

    static async resetPassword(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }
        const {email, token, newPassword, reqType} = req.body;
        if (!email || !token || !newPassword || !reqType) {
            return res.status(400).json({error: 'Invalid request format or type'});
        }
        if (reqType !== 'PasswordReset') {
            return res.status(400).json({error: 'Invalid reqType'});
        }

        try {
            const user = await DriverController.verifyToken('PasswordReset', token);
            // ensure the email is from the user
            if (user.email.toLowerCase() !== email.toLowerCase()) {
                return res.status(400).json({error: 'Forbidden request'});
            }

            // Hash and update the new password
            user.password = await AuthController.hashPassword(newPassword);

            user.resetPasswordToken = undefined;
            user.resetPasswordExpiry = undefined;

            await user.save();

            // get userDashboard data
            const userDashboard = await DriverController.userDashBoardData(user)


            return res.status(201).json({
                message: 'Password reset successfully',
                user: userDashboard,
            });
        } catch (err) {
            console.log('Password reset failed:', err.message);
            return res.status(400).json({error: err.message});
        }
    }

    static async verifyToken(reqType, token) {
        const {AAngBase} = await getModels();

        switch (reqType) {
            case 'EmailVerification': {
                const user = await AAngBase.findOne({
                    emailVerificationToken: token,
                    emailVerificationExpiry: {$gt: Date.now()},
                });
                if (!user) throw new Error('Invalid or expired email verification token');
                return user;
            }
            case 'PasswordReset': {
                const user = await AAngBase.findOne({
                    resetPasswordToken: token,
                    resetPasswordExpiry: {$gt: Date.now()},
                });
                if (!user) throw new Error('Invalid or expired password reset token');
                return user;
            }
            case 'SetAuthorizationPin':
            case 'PinVerification': {
                const user = await AAngBase.findOne({
                    authPinResetToken: token,
                    authPinResetExpiry: {$gt: Date.now()},
                });
                if (!user) throw new Error('Invalid or expired pin verification token');
                return user;
            }
            default:
                throw new Error('Unsupported verification type');
        }
    }

    static async setAuthPin(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {email, pin, reqType, token} = req.body;
        if (!email || !pin) {
            return res.status(400).json({error: "Email and pin are required."});
        }
        if (email !== userData.email) {
            return res.status(400).json({error: "Forbidden request."});
        }
        if (reqType !== 'SetAuthorizationPin') {
            return res.status(400).json({error: "Invalid request type."});
        }
        if (!token) {
            return res.status(400).json({error: "Token is required."});
        }
        try {
            const user = await DriverController.verifyToken('SetAuthorizationPin', token);

            user.pinVerified = true;
            user.pinVerificationToken = undefined;
            user.pinVerificationExpiry = undefined;

            // Determine if this is SET or RESET
            const isReset = user.authPin?.isEnabled || false;
            const action = isReset ? 'reset' : 'set';

            // Hash the PIN
            const hashedPin = AuthController.hashPassword(pin);

            // Update PIN
            user.authPin = {
                pin: hashedPin,
                isEnabled: true,
                createdAt: isReset ? user.authPin.createdAt : new Date(),
                lastUsed: null,
                failedAttempts: 0,
                lockedUntil: null
            };

            // Mark token as used
            // user.pinVerificationToken.used = true;

            // Add/Update AuthPin in auth methods
            const authPinIndex = user.authMethods?.findIndex(m => m.type === 'AuthPin');

            if (authPinIndex !== -1) {
                user.authMethods[authPinIndex].verified = true;
                user.authMethods[authPinIndex].lastUsed = new Date();
            } else {
                if (!user.authMethods) user.authMethods = [];
                user.authMethods.push({
                    type: 'AuthPin',
                    verified: true,
                    lastUsed: new Date()
                });
            }
            await user.save();
            // Create notification
            await NotificationService.createNotification({
                userId: user._id,
                type: `security.pin_${action}`
            });

            console.log(`✅ PIN ${action} successfully`);

            // Get user dashboard data
            const userDashboard = await DriverController.userDashBoardData(user);

            return res.status(200).json({
                message: `PIN ${action} successfully`,
                user: userDashboard
            });

        } catch (err) {
            console.log('Pin verification failed:', err.message);
            return res.status(400).json({error: err.message});
        }
    }

    static async verifyAuthPinToken(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {email, token} = req.body;
        if (!email || !token) {
            return res.status(400).json({error: "Email and token are required."});
        }
        if (email !== userData.email) {
            return res.status(400).json({error: "Forbidden request."});
        }
        try {
            const user = await DriverController.verifyToken('PinVerification', token);

            await user.save();

            return res.status(201).json({
                message: 'Pin verified successfully',
            });
        } catch (err) {
            console.log('Pin verification failed:', err.message);
            return res.status(400).json({error: err.message});
        }
    }

    // Enhanced Location CRUD operations

    static async createLocation(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const locationData = req.body;
        if (!locationData) {
            return res.status(400).json({error: "Location data is required."});
        }

        try {
            // Validate the request body against the schema
            const validation = await validateSchema(locationSchema, locationData);
            if (!validation.valid) {
                return res.status(400).json({errors: validation.errors});
            }
            const {AAngBase} = await getModels();

            // Let MongoDB auto-generate the _id
            const updatedUser = await AAngBase.findOneAndUpdate(
                {
                    _id: userData._id,
                },
                {
                    $push: {
                        savedLocations: locationData // MongoDB will auto-generate _id
                    }
                },
                {
                    new: true, // Return the updated document
                }
            );
            if (!updatedUser) {
                return res.status(404).json({error: "User not found"});
            }

            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(201).json({
                message: "Location created successfully",
                user: dashboardData
            });

        } catch (error) {
            console.log("Location creation error:", error);

            // Handle specific MongoDB errors
            if (error.name === 'ValidationError') {
                return res.status(400).json({
                    error: "Validation failed",
                    details: Object.values(error.errors).map(err => err.message)
                });
            }

            return res.status(500).json({
                error: "An error occurred while creating location"
            });
        }
    }

    static async updateLocation(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const updateData = req.body;
        if (!updateData) {
            return res.status(400).json({error: "Location data is required."});
        }
        const locationData = {
            _id: updateData.locationId,
            ...updateData,
        }
        delete locationData.locationId;

        // Validate input parameters
        if (!locationData) {
            return res.status(400).json({error: "Location data is required."});
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(locationData._id)) {
            return res.status(400).json({error: "Invalid location ID format."});
        }

        try {
            // Validate the request body against the schema
            const validation = await validateSchema(locationSchema, locationData);
            if (!validation.valid) {
                return res.status(400).json({errors: validation.errors});
            }
            const {AAngBase} = await getModels();
            const updatedUser = await AAngBase.findOneAndUpdate(
                {_id: userData._id, 'savedLocations._id': locationData._id},
                {$set: {'savedLocations.$': locationData}},
                {new: true}
            );
            if (!updatedUser) {
                return res.status(404).json({error: "User or location not found"});
            }
            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }
            return res.status(200).json({
                message: "Location updated successfully",
                user: dashboardData
            });

        } catch (error) {
            console.log("Location update error:", error);

            // Handle specific MongoDB errors
            if (error.name === 'ValidationError') {
                return res.status(400).json({
                    error: "Validation failed",
                    details: Object.values(error.errors).map(err => err.message)
                });
            }

            return res.status(500).json({
                error: "An error occurred while updating location"
            });
        }
    }

    static async deleteLocation(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const locationData = req.body;

        if (!locationData) {
            return res.status(400).json({error: "Location data is required."});
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(locationData.locationId)) {
            return res.status(400).json({error: "Invalid location ID format."});
        }

        try {
            const {AAngBase} = await getModels();

            // First, check if the location exists and belongs to the user
            const userWithLocation = await AAngBase.findOne({
                _id: userData._id,
                'savedLocations._id': locationData.locationId,
                role: 'Driver'
            }, {
                'savedLocations.$': 1
            });

            if (!userWithLocation) {
                return res.status(404).json({
                    error: "Location not found or unauthorized access"
                });
            }

            // Use atomic operation to remove the location
            const updatedUser = await AAngBase.findOneAndUpdate(
                {
                    _id: userData._id,
                    role: 'Driver'
                },
                {
                    $pull: {
                        savedLocations: {_id: locationData.locationId}
                    }
                },
                {
                    new: true,
                }
            );

            if (!updatedUser) {
                return res.status(404).json({error: "User not found"});
            }

            // get dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            return res.status(200).json({
                message: "Location deleted successfully",
                user: dashboardData
            });

        } catch (error) {
            console.log("Location delete error:", error);
            return res.status(500).json({
                error: "An error occurred while deleting location"
            });
        }
    }

    // New method to get all user locations
    static async getUserLocations(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {AAngBase} = await getModels();

            // Efficiently fetch only the locations
            const user = await AAngBase.findOne(
                {
                    _id: userData._id,
                    role: 'Driver'
                },
                {
                    savedLocations: 1,
                    _id: 0
                }
            );

            if (!user) {
                return res.status(404).json({error: "User not found"});
            }

            return res.status(200).json({
                message: "Locations retrieved successfully",
                locations: user.savedLocations || [],
                totalLocations: user.savedLocations?.length || 0
            });

        } catch (error) {
            console.log("Get locations error:", error);
            return res.status(500).json({
                error: "An error occurred while fetching locations"
            });
        }
    }

    // New method to get a specific location by ID
    static async getLocationById(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {locationId} = req.params; // Assuming this comes from URL params

        if (!locationId) {
            return res.status(400).json({error: "Location ID is required."});
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(locationId)) {
            return res.status(400).json({error: "Invalid location ID format."});
        }

        try {
            const {AAngBase} = await getModels();

            // Use projection to get only the specific location
            const user = await AAngBase.findOne(
                {
                    _id: userData._id,
                    'savedLocations._id': locationId,
                    role: 'Driver'
                },
                {
                    'savedLocations.$': 1
                }
            );

            if (!user || !user.savedLocations || user.savedLocations.length === 0) {
                return res.status(404).json({
                    error: "Location not found or unauthorized access"
                });
            }

            return res.status(200).json({
                message: "Location retrieved successfully",
                location: user.savedLocations[0]
            });

        } catch (error) {
            console.log("Get location by ID error:", error);
            return res.status(500).json({
                error: "An error occurred while fetching location"
            });
        }
    }

    // data validation
    static async verificationStatus(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {Driver} = await getModels();
            const driver = await Driver.findById(userData._id).select('verification');

            if (!driver) {
                return res.status(404).json({message: 'Driver not found'});
            }

            return res.status(200).json({
                success: true,
                verification: driver.verification,
            });
        } catch (error) {
            console.log("Status update error:", error);
            return res.status(500).json({
                error: "An error occurred while updating status"
            });
        }

    }

    // Helper function to determine vehicle verification type
    static getVerificationType(vehicleType) {
        const typeMap = {
            'bicycle': 'bicycle',
            'tricycle': 'tricycle',
            'motorcycle': 'motorcycle',
            'car': 'vehicle',
            'van': 'vehicle',
            'truck': 'vehicle'
        };
        return typeMap[vehicleType] || null;
    }

// Helper to parse date strings (DD/MM/YYYY) to Date objects
    static parseDate(dateString) {
        if (!dateString) return null;
        const [day, month, year] = dateString.split('/');
        return new Date(year, month - 1, day);
    }

    // Main submission handler
    static async submitVerification(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {Driver} = await getModels();
            const driver = await Driver.findById(userData._id);

            if (!driver) {
                return res.status(404).json({message: 'Driver not found'});
            }

            // Extract and validate payload
            const {basicInfo, specificDocs} = req.body;

            // Validate required fields
            if (!basicInfo || !specificDocs) {
                return res.status(400).json({
                    error: 'Missing required fields: basicInfo and specificDocs are required'
                });
            }

            // Determine if Lagos-specific docs are required
            const isLagosDriver = basicInfo.operationalArea?.state?.toLowerCase() === 'lagos';
            const vehicleType = basicInfo.vehicleType;

            // ============================================
            // UPDATE BASIC VERIFICATION
            // ============================================
            driver.verification.basicVerification = {
                identification: {
                    type: basicInfo.identification.type,
                    number: basicInfo.identification.number,
                    expiryDate: DriverController.parseDate(basicInfo.identification.expiry),
                    frontImageUrl: basicInfo.identification.frontImage,
                    backImageUrl: basicInfo.identification.backImage || null,
                    verified: false,
                    status: 'pending'
                },
                passportPhoto: {
                    imageUrl: basicInfo.passportPhoto,
                    uploadedAt: new Date(),
                    verified: false,
                    status: 'pending'
                },
                operationalArea: {
                    state: basicInfo.operationalArea.state,
                    lga: basicInfo.operationalArea.lga,
                    verified: false
                },
                bankAccounts: basicInfo.bankAccounts?.map(account => ({
                    accountName: account.accountName,
                    accountNumber: account.accountNumber,
                    bankName: account.bankName,
                    bankCode: account.bankCode,
                    isPrimary: account.isPrimary || false,
                    verified: false,
                    addedAt: new Date()
                })) || [],
                isComplete: true,
                completedAt: new Date()
            };

            // ============================================
            // UPDATE VEHICLE TYPE AND DETAILS
            // ============================================
            driver.vehicleType = vehicleType;
            driver.vehicleDetails = {
                ...driver.vehicleDetails,
                type: vehicleType,
                plateNumber: specificDocs.plateNumber || null,
                model: specificDocs.model || null,
                year: specificDocs.year ? parseInt(specificDocs.year) : null,
                color: specificDocs.color || null,
                capacity: specificDocs.capacity || {
                    weight: 0,
                    volume: 0,
                    passengers: 0
                }
            };

            // ============================================
            // UPDATE SPECIFIC VERIFICATION
            // ============================================
            driver.verification.specificVerification.activeVerificationType = DriverController.getVerificationType(vehicleType);

            // Clear all vehicle-specific verification fields first
            driver.verification.specificVerification.bicycle = undefined;
            driver.verification.specificVerification.tricycle = undefined;
            driver.verification.specificVerification.motorcycle = undefined;
            driver.verification.specificVerification.vehicle = undefined;

            // Populate based on vehicle type
            switch (vehicleType) {
                case 'bicycle':
                    driver.verification.specificVerification.bicycle = {
                        hasHelmet: specificDocs.hasHelmet || false,
                        helmetNote: specificDocs.hasHelmet ? null : 'Driver advised to get helmet for safety',
                        backpackEvidence: {
                            imageUrl: specificDocs.backpackEvidence,
                            uploadedAt: new Date(),
                            verified: false,
                            status: 'submitted'
                        },
                        bicyclePictures: {
                            front: {
                                imageUrl: specificDocs.bicyclePictures?.front,
                                uploadedAt: new Date()
                            },
                            rear: {
                                imageUrl: specificDocs.bicyclePictures?.rear,
                                uploadedAt: new Date()
                            },
                            side: {
                                imageUrl: specificDocs.bicyclePictures?.side,
                                uploadedAt: new Date()
                            },
                            verified: false
                        }
                    };
                    break;

                case 'tricycle':
                    driver.verification.specificVerification.tricycle = {
                        pictures: {
                            front: {
                                imageUrl: specificDocs.pictures?.front,
                                uploadedAt: new Date()
                            },
                            rear: {
                                imageUrl: specificDocs.pictures?.rear,
                                uploadedAt: new Date()
                            },
                            side: {
                                imageUrl: specificDocs.pictures?.side,
                                uploadedAt: new Date()
                            },
                            inside: {
                                imageUrl: specificDocs.pictures?.inside,
                                uploadedAt: new Date()
                            },
                            verified: false
                        },
                        driversLicense: {
                            number: specificDocs.driversLicense?.number,
                            expiryDate: DriverController.parseDate(specificDocs.driversLicense?.expiryDate),
                            imageUrl: specificDocs.driversLicense?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        ...(isLagosDriver && {
                            hackneyPermit: {
                                number: specificDocs.hackneyPermit?.number,
                                expiryDate: DriverController.parseDate(specificDocs.hackneyPermit?.expiryDate),
                                imageUrl: specificDocs.hackneyPermit?.imageUrl,
                                verified: false,
                                required: true
                            },
                            lasdriCard: {
                                number: specificDocs.lasdriCard?.number,
                                expiryDate: DriverController.parseDate(specificDocs.lasdriCard?.expiryDate),
                                imageUrl: specificDocs.lasdriCard?.imageUrl,
                                verified: false,
                                required: true
                            }
                        })
                    };
                    break;

                case 'motorcycle':
                    driver.verification.specificVerification.motorcycle = {
                        pictures: {
                            front: {
                                imageUrl: specificDocs.pictures?.front,
                                uploadedAt: new Date()
                            },
                            rear: {
                                imageUrl: specificDocs.pictures?.rear,
                                uploadedAt: new Date()
                            },
                            side: {
                                imageUrl: specificDocs.pictures?.side,
                                uploadedAt: new Date()
                            },
                            verified: false
                        },
                        ridersPermit: {
                            cardNumber: specificDocs.ridersPermit?.cardNumber,
                            expiryDate: DriverController.parseDate(specificDocs.ridersPermit?.expiryDate),
                            imageUrl: specificDocs.ridersPermit?.imageUrl,
                            issuingOffice: specificDocs.ridersPermit?.issuingOffice,
                            verified: false,
                            status: 'submitted'
                        },
                        commercialLicense: {
                            licenseNumber: specificDocs.commercialLicense?.licenseNumber,
                            class: specificDocs.commercialLicense?.class || 'A',
                            expiryDate: DriverController.parseDate(specificDocs.commercialLicense?.expiryDate),
                            imageUrl: specificDocs.commercialLicense?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        proofOfAddress: {
                            documentType: specificDocs.proofOfAddress?.documentType || 'utility_bill',
                            imageUrl: specificDocs.proofOfAddress?.imageUrl,
                            uploadedAt: new Date(),
                            verified: false
                        },
                        proofOfOwnership: {
                            documentType: specificDocs.proofOfOwnership?.documentType || 'receipt',
                            imageUrl: specificDocs.proofOfOwnership?.imageUrl,
                            uploadedAt: new Date(),
                            verified: false
                        },
                        roadWorthiness: {
                            certificateNumber: specificDocs.roadWorthiness?.certificateNumber,
                            expiryDate: DriverController.parseDate(specificDocs.roadWorthiness?.expiryDate),
                            imageUrl: specificDocs.roadWorthiness?.imageUrl,
                            verified: false
                        },
                        ...(specificDocs.bvnNumber?.number && {
                            bvnNumber: {
                                number: specificDocs.bvnNumber.number,
                                verified: false,
                                optional: true
                            }
                        }),
                        ...(isLagosDriver && {
                            hackneyPermit: {
                                number: specificDocs.hackneyPermit?.number,
                                expiryDate: DriverController.parseDate(specificDocs.hackneyPermit?.expiryDate),
                                imageUrl: specificDocs.hackneyPermit?.imageUrl,
                                verified: false,
                                required: true
                            },
                            lasdriCard: {
                                number: specificDocs.lasdriCard?.number,
                                expiryDate: DriverController.parseDate(specificDocs.lasdriCard?.expiryDate),
                                imageUrl: specificDocs.lasdriCard?.imageUrl,
                                verified: false,
                                required: true
                            }
                        })
                    };
                    break;

                case 'car':
                case 'van':
                case 'truck':
                    driver.verification.specificVerification.vehicle = {
                        pictures: {
                            front: {
                                imageUrl: specificDocs.pictures?.front,
                                uploadedAt: new Date()
                            },
                            rear: {
                                imageUrl: specificDocs.pictures?.rear,
                                uploadedAt: new Date()
                            },
                            side: {
                                imageUrl: specificDocs.pictures?.side,
                                uploadedAt: new Date()
                            },
                            inside: {
                                imageUrl: specificDocs.pictures?.inside,
                                uploadedAt: new Date()
                            },
                            verified: false
                        },
                        driversLicense: {
                            number: specificDocs.driversLicense?.number,
                            class: specificDocs.driversLicense?.class,
                            expiryDate: DriverController.parseDate(specificDocs.driversLicense?.expiryDate),
                            imageUrl: specificDocs.driversLicense?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        vehicleRegistration: {
                            registrationNumber: specificDocs.vehicleRegistration?.registrationNumber,
                            expiryDate: DriverController.parseDate(specificDocs.vehicleRegistration?.expiryDate),
                            imageUrl: specificDocs.vehicleRegistration?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        insurance: {
                            policyNumber: specificDocs.insurance?.policyNumber,
                            provider: specificDocs.insurance?.provider,
                            expiryDate: DriverController.parseDate(specificDocs.insurance?.expiryDate),
                            imageUrl: specificDocs.insurance?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        roadWorthiness: {
                            certificateNumber: specificDocs.roadWorthiness?.certificateNumber,
                            expiryDate: DriverController.parseDate(specificDocs.roadWorthiness?.expiryDate),
                            imageUrl: specificDocs.roadWorthiness?.imageUrl,
                            verified: false,
                            status: 'submitted'
                        },
                        ...(isLagosDriver && {
                            hackneyPermit: {
                                number: specificDocs.hackneyPermit?.number,
                                expiryDate: DriverController.parseDate(specificDocs.hackneyPermit?.expiryDate),
                                imageUrl: specificDocs.hackneyPermit?.imageUrl,
                                verified: false,
                                required: true
                            },
                            lasdriCard: {
                                number: specificDocs.lasdriCard?.number,
                                expiryDate: DriverController.parseDate(specificDocs.lasdriCard?.expiryDate),
                                imageUrl: specificDocs.lasdriCard?.imageUrl,
                                verified: false,
                                required: true
                            }
                        })
                    };
                    break;

                default:
                    return res.status(400).json({
                        error: 'Invalid vehicle type provided'
                    });
            }

            // ============================================
            // UPDATE COMPLETION STATUS
            // ============================================
            driver.verification.specificVerification.isComplete = true;
            driver.verification.specificVerification.completedAt = new Date();

            // Update overall verification status
            driver.verification.overallStatus = 'submitted';
            driver.verification.lastReviewDate = new Date();

            // Calculate progress
            driver.verification.progress = {
                basicVerificationProgress: 100,
                specificVerificationProgress: 100,
                overallProgress: 100,
                lastUpdated: new Date()
            };

            // Add submission record
            const isResubmission = driver.verification.submissions.length > 0;
            driver.verification.submissions.push({
                submittedAt: new Date(),
                submissionType: isResubmission ? 'resubmission' : 'initial',
                status: 'submitted'
            });

            // Save driver document
            await driver.save();

            const dashboardData = await DriverController.userDashBoardData(driver);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            // TODO: Trigger admin notification
            // TODO: Send confirmation to driver via SMS/Email
            // TODO: Log submission for analytics

            return res.status(200).json({
                success: true,
                message: 'Verification documents submitted successfully',
                dashboardData,
            });

        } catch (error) {
            console.log("Verification submission error:", error);
            return res.status(500).json({
                error: "An error occurred while submitting verification",
                message: error.message
            });
        }
    }


    static async getDriverNotification(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id;

            const notifications = await NotificationService.getUserNotifications(userId, {
                limit: 200,
                offset: 0
            });

            const stats = await NotificationService.getNotificationStats(userId);

            return res.status(200).json({notifications, stats});
        } catch (err) {
            console.log('Fetch notifications error:', err);
            return res.status(500).json({error: 'Failed to fetch notifications'});
        }
    }

    static async getNotificationStats(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const userId = userData._id;

            const stats = await NotificationService.getNotificationStats(userId);

            return res.status(200).json({stats});
        } catch (err) {
            console.log('Fetch notification stats error:', err);
            return res.status(500).json({error: 'Failed to fetch notification stats'});
        }
    }


    static async markAsRead(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const {id} = req.body;
            if (!id) return res.status(400).json({error: 'Notification ID is required'});

            const notification = await Notification.findById(id);
            if (!notification) return res.status(404).json({error: 'Notification not found'});

            await notification.markAsRead();
            return res.status(200).json({message: 'Notification marked as read'});
        } catch (err) {
            console.log('Mark as read error:', err);
            return res.status(500).json({error: 'Failed to mark notification as read'});
        }

    }

    static async markAllAsRead(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const result = await NotificationService.markAllAsRead(userId);
            if (!result) return res.status(404).json({error: 'No unread notifications found'});

            return res.status(200).json({message: 'All notifications marked as read'});
        } catch (err) {
            console.log('Mark all as read error:', err);
            return res.status(500).json({error: 'Failed to mark all notifications as read'});
        }
    }

    static async getUnreadCount(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const unreadCount = await NotificationService.getUnreadCount(userId);
            return res.status(200).json({unreadCount});
        } catch (err) {
            console.log('Get unread count error:', err);
            return res.status(500).json({error: 'Failed to get unread count'});
        }
    }

    static async deleteNotification(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {id} = req.body;
        if (!id) {
            return res.status(400).json({error: 'Notification ID is required'});
        }
        try {
            const notification = await Notification.findById(id);
            if (!notification) return res.status(404).json({error: 'Notification not found'});

            await notification.softDelete();
            return res.status(200).json({message: 'Notification deleted'});
        } catch (err) {
            console.log('Delete notification error:', err);
            return res.status(500).json({error: 'Failed to delete notification'});
        }
    }

    static async deleteAllNotifications(req, res) {
        // Perform API pre-check
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        try {
            const userId = userData._id;

            const result = await NotificationService.deleteAllNotifications(userId);
            if (!result) return res.status(404).json({error: 'No notifications found'});

            return res.status(200).json({message: 'All notifications deleted'});
        } catch (err) {
            console.log('Delete all notifications error:', err);
            return res.status(500).json({error: 'Failed to delete all notifications'});
        }
    }


    /**
     * Haversine formula to calculate distance between two coordinates
     * Returns distance in kilometers
     */
    static calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Calculate ETA based on distance and traffic conditions
     * Returns estimated time in minutes
     */
    static calculateETA(distanceKm, trafficFactor = 1.2) {
        // Average speeds by vehicle type (km/h)
        const averageSpeeds = {
            bicycle: 15,
            motorcycle: 35,
            tricycle: 30,
            car: 40,
            van: 35,
            truck: 30
        };

        // Use motorcycle speed as default
        const avgSpeed = averageSpeeds.motorcycle || 35;

        // Base time + traffic factor + buffer
        const baseTime = (distanceKm / avgSpeed) * 60; // Convert to minutes
        const withTraffic = baseTime * trafficFactor;
        const withBuffer = withTraffic * 1.15; // 15% buffer

        return Math.ceil(withBuffer);
    }

    /**
     * GET /driver/available-orders
     * Fetch available orders based on driver's location and preferences
     */
    static async getAvailableOrders(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        // Extract query parameters
        const {
            lat,
            lng,
            area = 'territorial', // 'current' | 'territorial'
            radius = 15, // km (for 'current' mode)
            vehicleFilter,
            priorityFilter = 'all',
            maxDistance = 10
        } = req.query;

        // Validate required fields
        if (!lat || !lng) {
            return res.status(400).json({
                error: "Driver location (lat, lng) is required"
            });
        }
        const driverLat = parseFloat(lat);
        const driverLng = parseFloat(lng);

        if (isNaN(driverLat) || isNaN(driverLng)) {
            return res.status(400).json({
                error: "Invalid coordinates"
            });
        }

        try {
            const {Order} = await getOrderModels();

            // Get driver's operational areas
            const operationalLGA = userData.verification?.basicVerification?.operationalArea?.lga;
            const operationalState = userData.verification?.basicVerification?.operationalArea?.state;

            if (!operationalLGA || !operationalState) {
                return res.status(400).json({
                    error: "Driver operational area (LGA and State) not properly configured"
                });
            }

            // Build base query
            const query = {
                status: 'broadcast',
                'payment.status': 'paid'
            };

            // AREA FILTERING - INTELLIGENT MATCHING
            if (area === 'current') {
                // CURRENT MODE: Match orders within radius AND same LGA
                const radiusInMeters = parseFloat(radius) * 1000;

                query['location.pickUp.coordinates'] = {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [driverLng, driverLat]
                        },
                        $maxDistance: radiusInMeters
                    }
                };

                // Additional LGA matching for precision
                query['location.pickUp.lga'] = operationalLGA;

            } else if (area === 'territorial') {
                // TERRITORIAL MODE: Match orders within entire state
                query['location.pickUp.state'] = operationalState;

                // Optional: Add LGA preference for territorial mode
                // This gives priority to orders in driver's preferred LGA
                // query['location.pickUp.lga'] = operationalLGA;
            }

            // VEHICLE FILTER
            if (vehicleFilter) {
                const vehicles = Array.isArray(vehicleFilter)
                    ? vehicleFilter
                    : vehicleFilter.split(',').map(v => v.trim());

                if (vehicles.length > 0) {
                    query.vehicleRequirements = {$in: vehicles};
                }
            }

            // PRIORITY FILTER
            if (priorityFilter === 'urgent') {
                query.priority = 'urgent';
            } else if (priorityFilter === 'high_priority') {
                query.priority = {$in: ['high', 'urgent']};
            }

            // FETCH ORDERS
            const orders = await Order.find(query)
                .sort({
                    priority: -1,  // Urgent first
                    createdAt: 1   // Oldest first
                })
                .limit(50)
                .select([
                    '_id',
                    'orderRef',
                    'clientId',
                    'priority',
                    'orderType',
                    'vehicleRequirements',
                    'location.pickUp',
                    'location.dropOff',
                    'package.category',
                    'package.weight',
                    'package.isFragile',
                    'pricing.totalAmount',
                    'pricing.currency',
                    'createdAt',
                    'scheduledPickup'
                ])
                .lean();

            // CALCULATE DISTANCES AND ENHANCE ORDER DATA
            const ordersWithDistance = orders.map(order => {
                const pickupLng = order.location.pickUp.coordinates.coordinates[0];
                const pickupLat = order.location.pickUp.coordinates.coordinates[1];

                const distance = DriverController.calculateDistance(
                    driverLat,
                    driverLng,
                    pickupLat,
                    pickupLng
                );

                const estimatedETA = DriverController.calculateETA(
                    distance,
                    1.2 // Traffic factor
                );

                // Determine area match type for frontend display
                let areaMatchType;

                if (area === 'current') {
                    // Query: radius + LGA filter
                    areaMatchType = 'local_lga';
                } else if (area === 'territorial') {
                    // Query: state filter only
                    if (order.location.pickUp.lga === operationalLGA) {
                        areaMatchType = 'same_lga'; // Bonus - same LGA within state
                    } else {
                        areaMatchType = 'same_state'; // Different LGA but same state
                    }
                }

                return {
                    ...order,
                    distance: parseFloat(distance.toFixed(2)),
                    estimatedPickupTime: estimatedETA,
                    areaMatchType,
                    canAcceptFromCurrentLocation: distance <= parseFloat(maxDistance),
                    warningMessage: distance > parseFloat(maxDistance)
                        ? `Order is ${distance.toFixed(1)}km away. Move closer to accept.`
                        : null
                };
            })
                .filter(order => order.distance <= parseFloat(maxDistance) * 1.5)
                .sort((a, b) => {
                    // Sort by: 1. Area match type, 2. Distance
                    const areaPriority = {
                        'local_lga': 1,
                        'preferred_lga': 2,
                        'state_wide': 3
                    };

                    if (areaPriority[a.areaMatchType] !== areaPriority[b.areaMatchType]) {
                        return areaPriority[a.areaMatchType] - areaPriority[b.areaMatchType];
                    }
                    return a.distance - b.distance;
                });


            return res.status(200).json({
                success: true,
                orders: ordersWithDistance,
                count: ordersWithDistance.length,
                metadata: {
                    driverLocation: {lat: driverLat, lng: driverLng},
                    operationalArea: {
                        lga: operationalLGA,
                        state: operationalState
                    },
                    searchMode: area,
                    searchRadius: area === 'current' ? parseFloat(radius) : null,
                    maxDistance: parseFloat(maxDistance),
                    filters: {
                        vehicles: vehicleFilter || 'all',
                        priority: priorityFilter
                    }
                }
            });

        } catch (error) {
            console.log('Get available orders error:', error);
            return res.status(500).json({
                error: "An error occurred while fetching orders"
            });
        }
    }

    /**
     * POST /driver/accept-order
     * Driver accepts an order with location verification
     */
    static async acceptOrder(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, currentLocation} = req.body;

        // Validate input
        if (!orderId || !currentLocation?.lat || !currentLocation?.lng) {
            return res.status(400).json({
                error: "Order ID and current location are required"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver} = await getModels();

            // Fetch order
            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Check if order is still available
            if (order.status !== 'broadcast') {
                return res.status(400).json({
                    error: "Order is no longer available",
                    currentStatus: order.status
                });
            }

            // Check if payment is confirmed
            if (order.payment.status !== 'paid') {
                return res.status(400).json({
                    error: "Order payment not confirmed"
                });
            }

            // Calculate distance from driver to pickup
            const pickupLng = order.location.pickUp.coordinates.coordinates[0];
            const pickupLat = order.location.pickUp.coordinates.coordinates[1];

            const distanceToPickup = DriverController.calculateDistance(
                currentLocation.lat,
                currentLocation.lng,
                pickupLat,
                pickupLng
            );

            // Calculate ETA
            const estimatedETA = DriverController.calculateETA(distanceToPickup);

            // Store acceptance data for penalty calculation
            const acceptanceData = {
                acceptedLocation: {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng,
                    accuracy: currentLocation.accuracy || 0,
                    timestamp: new Date()
                },
                distanceToPickup,
                estimatedETA,
                maxAllowedETA: Math.ceil(estimatedETA * 1.5)
            };

            // Update order status
            order.status = 'assigned';

            // Update driver assignment
            order.driverAssignment = {
                driverId: userData._id,
                driverInfo: {
                    name: userData.fullName,
                    email: userData.email,
                    phone: userData.phoneNumber,
                    vehicleType: userData.vehicleDetails.type,
                    vehicleNumber: userData.vehicleDetails.plateNumber,
                    rating: userData.performance.averageRating
                },
                currentLocation: {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng,
                    accuracy: currentLocation.accuracy || 0,
                    timestamp: new Date()
                },
                route: [{
                    lat: currentLocation.lat,
                    lng: currentLocation.lng,
                    timestamp: new Date(),
                    speed: 0
                }],
                estimatedArrival: {
                    pickup: new Date(Date.now() + estimatedETA * 60000),
                    dropoff: null
                },
                actualTimes: {
                    assignedAt: new Date(),
                    pickedUpAt: null,
                    inTransitAt: null,
                    deliveredAt: null
                },
                distance: {
                    total: distanceToPickup,
                    remaining: distanceToPickup,
                    unit: 'km'
                },
                duration: {
                    estimated: estimatedETA,
                    actual: null
                },
                status: 'accepted',
                responseTime: 0
            };

            // ⚠️ UPDATE TRACKING HISTORY (New section)
            // Complete driver_assignment_started
            const assignmentStartedIndex = order.orderTrackingHistory.findIndex(
                entry => entry.status === 'driver_assignment_started'
            );
            if (assignmentStartedIndex !== -1) {
                order.orderTrackingHistory[assignmentStartedIndex].isCompleted = true;
                order.orderTrackingHistory[assignmentStartedIndex].isCurrent = false;
            }

            // Add driver_assigned
            order.orderTrackingHistory.push({
                status: 'driver_assigned',
                timestamp: new Date(),
                title: 'Driver Assigned',
                description: `${userData.fullName} has accepted your order`,
                icon: '🚗',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName,
                    vehicleType: userData.vehicleDetails.type,
                    vehicleNumber: userData.vehicleDetails.plateNumber,
                    eta: estimatedETA,
                    distance: distanceToPickup,
                    location: {
                        lat: currentLocation.lat,
                        lng: currentLocation.lng
                    }
                },
                updatedBy: {
                    role: 'driver',
                    name: userData.fullName
                },
                isCompleted: true,
                isCurrent: false
            });

            // Add en_route_to_pickup (CURRENT STEP)
            order.orderTrackingHistory.push({
                status: 'en_route_to_pickup',
                timestamp: new Date(),
                title: 'Driver En Route to Pickup',
                description: `${userData.fullName} is heading to pickup location`,
                icon: '🚀',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName,
                    vehicleType: userData.vehicleDetails.type,
                    eta: estimatedETA,
                    distance: distanceToPickup,
                    location: {
                        lat: currentLocation.lat,
                        lng: currentLocation.lng
                    }
                },
                updatedBy: {
                    role: 'system',
                    name: 'AAngLogistics System'
                },
                isCompleted: false,
                isCurrent: true
            });

            // Store acceptance metadata
            order.metadata = order.metadata || {};
            order.metadata.acceptanceData = acceptanceData;

            await order.save();

            // Update driver status
            const user = await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        availabilityStatus: 'on-delivery',
                        'operationalStatus.currentOrderId': order._id,
                        'operationalStatus.lastActiveAt': new Date(),
                        'currentLocation.coordinates': {
                            lat: currentLocation.lat,
                            lng: currentLocation.lng
                        },
                        'currentLocation.accuracy': currentLocation.accuracy || 0,
                        'currentLocation.timestamp': new Date()
                    }
                }
            );

            // get dashboard
            const dashboard = await DriverController.userDashBoardData(user);

            // ⚠️ SEND NOTIFICATIONS (New section)
            try {

                // Notify client
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'delivery.driver_assigned',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName,
                        driverPhone: userData.phoneNumber,
                        estimatedTime: `${estimatedETA} minutes`,
                        vehicleType: userData.vehicleDetails.type,
                        vehicleNumber: userData.vehicleDetails.plateNumber
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        driverId: userData._id,
                        estimatedETA,
                        distance: distanceToPickup
                    },
                    priority: 'HIGH'
                });

                // Notify driver
                await NotificationService.createNotification({
                    userId: userData._id,
                    type: 'delivery.driver_assigned',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        pickupLocation: order.location.pickUp.address,
                        amount: order.pricing.totalAmount.toLocaleString('en-NG'),
                        distance: distanceToPickup.toFixed(1)
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        pickupLocation: order.location.pickUp,
                        dropoffLocation: order.location.dropOff,
                        estimatedETA
                    },
                    priority: 'URGENT'
                });

                console.log('✅ Notifications sent successfully');
            } catch (notificationError) {
                console.log('⚠️ Notification error (non-blocking):', notificationError);
            }

            // TODO: Update OrderAssignment record -- maybe for emergency fallback


            return res.status(200).json({
                success: true,
                message: "Order accepted successfully",
                dashboard,
                order: {
                    _id: order._id,
                    orderRef: order.orderRef,
                    status: order.status,
                    deliveryToken: order.deliveryToken, // Driver needs this
                    pickupLocation: {
                        address: order.location.pickUp.address,
                        coordinates: order.location.pickUp.coordinates,
                        landmark: order.location.pickUp.landmark,
                        contactPerson: order.location.pickUp.contactPerson,
                        extraInformation: order.location.pickUp.extraInformation,
                        building: order.location.pickUp.building
                    },
                    dropoffLocation: {
                        address: order.location.dropOff.address,
                        coordinates: order.location.dropOff.coordinates,
                        landmark: order.location.dropOff.landmark,
                        contactPerson: order.location.dropOff.contactPerson,
                        extraInformation: order.location.dropOff.extraInformation,
                        building: order.location.dropOff.building
                    },
                    package: order.package,
                    pricing: order.pricing,
                    estimatedPickupTime: estimatedETA,
                    maxAllowedTime: acceptanceData.maxAllowedETA,
                    currentStage: 'en_route_to_pickup',
                    vehicleRequirements: order.vehicleRequirements,
                    priority: order.priority,
                    orderType: order.orderType
                },
                warning: distanceToPickup > 10
                    ? "You're quite far from pickup location. Ensure timely arrival to avoid penalties."
                    : null
            });

        } catch (error) {
            console.log('Accept order error:', error);
            return res.status(500).json({
                error: "An error occurred while accepting order"
            });
        }
    }

    /**
     * POST /driver/update-location
     * Update driver location during active delivery
     */
    static async updateActiveDeliveryLocation(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, location, deliveryStage} = req.body;

        if (!orderId || !location?.lat || !location?.lng) {
            return res.status(400).json({
                error: "Order ID and location are required"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver} = await getModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify this driver is assigned to this order
            if (order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({
                    error: "You are not assigned to this order"
                });
            }

            // Update driver's current location in order
            order.driverAssignment.currentLocation = {
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy || 0,
                timestamp: new Date()
            };

            // Add to route history
            order.driverAssignment.route.push({
                lat: location.lat,
                lng: location.lng,
                timestamp: new Date(),
                speed: location.speed || 0
            });

            // Calculate remaining distance to pickup/dropoff
            if (order.status === 'assigned' || order.status === 'en_route_pickup') {
                // Distance to pickup
                const pickupLng = order.location.pickUp.coordinates.coordinates[0];
                const pickupLat = order.location.pickUp.coordinates.coordinates[1];

                const remaining = DriverController.calculateDistance(
                    location.lat,
                    location.lng,
                    pickupLat,
                    pickupLng
                );

                order.driverAssignment.distance.remaining = remaining;

                // Check if driver arrived at pickup (within 100m)
                if (remaining < 0.1 && order.status !== 'arrived_pickup') {
                    order.status = 'arrived_pickup';

                    // Add tracking history
                    order.orderTrackingHistory.push({
                        status: 'arrived_at_pickup',
                        timestamp: new Date(),
                        title: 'Driver Arrived',
                        description: 'Driver has arrived at pickup location',
                        icon: '📍',
                        updatedBy: {
                            role: 'system',
                            name: 'AAngLogistics System'
                        },
                        isCompleted: true,
                        isCurrent: false
                    });
                }
            }

            await order.save();

            // Update driver document
            await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        'currentLocation.coordinates': {
                            lat: location.lat,
                            lng: location.lng
                        },
                        'currentLocation.accuracy': location.accuracy || 0,
                        'currentLocation.speed': location.speed || 0,
                        'currentLocation.isMoving': (location.speed || 0) > 1,
                        'currentLocation.timestamp': new Date(),
                        'operationalStatus.lastLocationUpdate': new Date()
                    }
                }
            );

            return res.status(200).json({
                success: true,
                message: "Location updated successfully"
            });

        } catch (error) {
            console.log('Update location error:', error);
            return res.status(500).json({
                error: "An error occurred while updating location"
            });
        }
    }

    /**
     * POST /driver/location-lost
     * Notify system when location tracking is lost
     */
    static async notifyLocationLoss(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, lastKnownLocation, failureCount} = req.body;

        if (!orderId) {
            return res.status(400).json({error: "Order ID is required"});
        }

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Log location loss incident
            order.communications.push({
                type: 'system',
                recipient: 'admin',
                content: `Location tracking lost for driver ${userData.fullName}. Failure count: ${failureCount}. Last known: ${JSON.stringify(lastKnownLocation)}`,
                sentAt: new Date(),
                status: 'sent'
            });

            await order.save();

            // TODO: Send alert to admin dashboard
            // TODO: Send SMS to client if failure persists

            return res.status(200).json({
                success: true,
                message: "Location loss reported",
                action: failureCount >= 5
                    ? "Admin has been notified. Please restore GPS connection."
                    : "Attempting to reconnect..."
            });

        } catch (error) {
            console.log('Location loss notification error:', error);
            return res.status(500).json({
                error: "An error occurred while reporting location loss"
            });
        }
    }

    /**
     * Complete Delivery - Final Production Version
     * Handles delivery completion with media, notifications, and rating flow
     *
     * POST /api/driver/order/complete-delivery
     */
    static async completeDelivery(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, stage, verificationData, locationDetails} = req.body;

        // ============================================
        // 1. VALIDATION
        // ============================================

        if (!orderId || !verificationData) {
            return res.status(400).json({
                error: "Order ID and verification data are required"
            });
        }

        // Validate token
        if (!verificationData.tokenVerified || !verificationData.deliveryToken) {
            return res.status(400).json({
                error: "Delivery token must be verified"
            });
        }

        // Validate recipient
        if (!verificationData.recipientName?.trim()) {
            return res.status(400).json({
                error: "Recipient name is required"
            });
        }

        // Validate photos (minimum 2)
        if (!verificationData.photos || verificationData.photos.length < 2) {
            return res.status(400).json({
                error: "At least 2 delivery photos are required"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver, Client} = await getModels();
            const driver = await Driver.findById(userData._id);


            // ============================================
            // 2. FETCH & VERIFY ORDER
            // ============================================

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify driver assignment
            if (!order.driverAssignment?.driverId ||
                order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({
                    error: "You are not assigned to this order"
                });
            }

            // Verify order status
            if (order.status !== 'arrived_dropoff') {
                return res.status(400).json({
                    error: `Cannot complete delivery. Order is '${order.status}', expected 'arrived_dropoff'`
                });
            }

            // Verify token matches
            if (order.deliveryToken !== verificationData.deliveryToken) {
                return res.status(400).json({
                    error: "Invalid delivery token"
                });
            }
            const client = await Client.findById(order.clientId);

            const now = new Date();

            // ============================================
            // 3. PROCESS MEDIA
            // ============================================

            const photoUrls = verificationData.photos
                .filter(photo => photo?.url)
                .map(photo => photo.url);

            let videoUrl = verificationData.video?.url || verificationData.videoUrl || null;

            const mediaMetadata = {
                photos: verificationData.photos.map(photo => ({
                    key: photo.key,
                    url: photo.url,
                    fileName: photo.fileName,
                    uploadedAt: now
                })),
                video: verificationData.video ? {
                    key: verificationData.video.key,
                    url: verificationData.video.url,
                    fileName: verificationData.video.fileName,
                    duration: verificationData.video.duration,
                    uploadedAt: now
                } : null
            };

            // ============================================
            // 4. CALCULATE EARNINGS
            // ============================================

            const baseEarnings = order.pricing.totalAmount * 0.7; // 70% to driver
            const penalty = order.metadata?.penalty?.amount || 0;
            const finalEarnings = Math.max(0, baseEarnings - penalty);

            // ============================================
            // 5. UPDATE ORDER
            // ============================================

            order.status = 'delivered';

            // Update driver assignment times
            if (!order.driverAssignment.actualTimes) {
                order.driverAssignment.actualTimes = {};
            }
            order.driverAssignment.actualTimes.deliveredAt = now;

            // Calculate delivery duration
            if (order.driverAssignment.actualTimes.assignedAt) {
                const startTime = new Date(order.driverAssignment.actualTimes.assignedAt);
                const totalMinutes = Math.round((now - startTime) / 60000);

                if (!order.driverAssignment.duration) {
                    order.driverAssignment.duration = {};
                }
                order.driverAssignment.duration.actual = totalMinutes;
            }

            // Store delivery confirmation
            order.deliveryConfirmation = {
                photos: photoUrls,
                videos: videoUrl ? [videoUrl] : [],
                signature: verificationData?.recipientSignature || null,
                verifiedBy: {
                    name: verificationData.recipientName.trim(),
                    phone: order.location.dropOff.contactPerson?.phone || ''
                },
                verifiedAt: now,
                verification: {
                    deliveryToken: verificationData.deliveryToken,
                    tokenVerifiedAt: now,
                    recipientName: verificationData.recipientName.trim(),
                    notes: verificationData.notes || '',
                    locationDetails: locationDetails || null,
                    mediaMetadata: mediaMetadata
                }
            };

            // Mark token as verified
            order.tokenVerified = {
                verified: true,
                verifiedAt: now,
                verifiedBy: {
                    name: verificationData.recipientName.trim()
                }
            };

            // ============================================
            // 6. UPDATE TRACKING HISTORY
            // ============================================

            // Mark previous as completed
            if (order.orderTrackingHistory?.length > 0) {
                order.orderTrackingHistory.forEach(history => {
                    if (history.isCurrent) {
                        history.isCurrent = false;
                        history.isCompleted = true;
                    }
                });
            }

            // Add delivery completed event
            if (!order.orderTrackingHistory) {
                order.orderTrackingHistory = [];
            }

            order.orderTrackingHistory.push({
                status: 'package_delivered',
                timestamp: now,
                title: 'Package Delivered',
                description: `Package successfully delivered to ${verificationData.recipientName.trim()}`,
                icon: '🎉',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName || userData.name,
                    vehicleType: order.driverAssignment?.driverInfo?.vehicleType,
                    vehicleNumber: order.driverAssignment?.driverInfo?.vehicleNumber,
                    recipientName: verificationData.recipientName.trim(),
                    photosCount: photoUrls.length,
                    hasVideo: !!videoUrl,
                    totalDurationMinutes: order.driverAssignment.duration?.actual,
                    proof: {
                        type: 'photo',
                        url: photoUrls[0],
                        verifiedAt: now
                    }
                },
                updatedBy: {
                    role: 'driver',
                    name: userData.fullName || userData.name
                },
                isCompleted: true,
                isCurrent: true
            });

            // ============================================
            // 7. UPDATE INSTANT HISTORY
            // ============================================

            if (!order.orderInstantHistory) {
                order.orderInstantHistory = [];
            }

            order.orderInstantHistory.push({
                status: 'delivery_completed',
                timestamp: now,
                updatedBy: {
                    userId: userData._id,
                    role: 'driver'
                },
                notes: verificationData.notes || 'Delivery completed successfully'
            });

            // ============================================
            // 8. SAVE ORDER
            // ============================================

            await order.save();

            // ============================================
            // 9. UPDATE DRIVER STATS & WALLET
            // ============================================

            await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        availabilityStatus: 'online',
                        'operationalStatus.currentOrderId': null
                    },
                    $inc: {
                        'performance.totalDeliveries': 1,
                        'performance.weeklyStats.deliveries': 1,
                        'performance.monthlyStats.deliveries': 1,
                        'performance.weeklyStats.earnings': finalEarnings,
                        'performance.monthlyStats.earnings': finalEarnings,
                        'wallet.balance': finalEarnings,
                        'wallet.totalEarnings': finalEarnings
                    },
                    $push: {
                        'wallet.recentTransactions': {
                            $each: [{
                                type: 'earning',
                                amount: finalEarnings,
                                description: `Delivery completed: ${order.orderRef}`,
                                orderId: order._id,
                                timestamp: now,
                                reference: order.orderRef
                            }],
                            $position: 0,
                        }
                    }
                }
            );

            // Send Notifications
            try {
                // Notify CLIENT - Delivery completed
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'delivery.completed_detailed',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName || userData.name,
                        driverPhotoUrl: userData.avatar || '',
                        recipientName: verificationData.recipientName.trim(),
                        deliveryTime: new Date(now).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit'
                        }),
                        deliveredAt: now.toISOString(),
                        deliveryPhotoUrl: photoUrls[0] || '',
                        deliveryPhotosArray: JSON.stringify(photoUrls),
                        hasVideo: videoUrl ? 'true' : 'false',
                        deliveryToken: verificationData.deliveryToken,
                        deliveryDuration: order.driverAssignment.duration?.actual || 0
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        driverId: userData._id,
                        deliveryProof: {
                            photos: photoUrls,
                            video: videoUrl,
                            recipientName: verificationData.recipientName.trim()
                        }
                    },
                    priority: 'HIGH'
                });

                // 2. Notify DRIVER - Delivery completed with earnings
                await NotificationService.createNotification({
                    userId: userData._id,
                    type: 'driver.delivery_completed',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        clientId: order.clientId.toString(),
                        earnings: finalEarnings.toFixed(2),
                        totalDeliveries: (await Driver.findById(userData._id))?.performance?.totalDeliveries || 0,
                        deliveryDuration: order.driverAssignment.duration?.actual || 0
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        earnings: finalEarnings,
                        requiresRating: true
                    },
                    priority: 'HIGH'
                });

                // 3. Schedule rating reminders (10 minutes after delivery)
                const reminderTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 mins

                // Client rating reminder
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'client.rating_reminder',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName || userData.name
                    },
                    scheduleFor: reminderTime,
                    priority: 'LOW'
                });

                // Driver rating reminder
                await NotificationService.createNotification({
                    userId: userData._id,
                    type: 'driver.rating_reminder',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString()
                    },
                    scheduleFor: reminderTime,
                    priority: 'LOW'
                });

                // 4. Check for milestones

                const totalDeliveries = driver?.performance?.totalDeliveries || 0;
                const milestones = [10, 25, 50, 100, 250, 500, 1000];

                if (milestones.includes(totalDeliveries)) {
                    const bonusAmount = totalDeliveries * 10; // Example: ₦10 per delivery milestone

                    await NotificationService.createNotification({
                        userId: userData._id,
                        type: 'driver.milestone_achieved',
                        templateData: {
                            milestoneCount: totalDeliveries.toString(),
                            bonusMessage: `You've earned a ₦${bonusAmount} bonus!`,
                            bonusAmount: bonusAmount.toString(),
                            nextMilestoneCount: (milestones.find(m => m > totalDeliveries) || totalDeliveries + 100).toString()
                        },
                        priority: 'NORMAL'
                    });
                }

                // 5. Notify admin (optional - for monitoring)
                // const admins = await NotificationService.getAdminUsers();
                // for (const admin of admins.slice(0, 2)) { // Only notify 2 admins
                //     await NotificationService.createNotification({
                //         userId: admin._id,
                //         type: 'admin.delivery_completed',
                //         templateData: {
                //             orderRef: order.orderRef,
                //             orderId: order._id.toString(),
                //             driverName: userData.fullName || userData.name,
                //             driverId: userData._id.toString(),
                //             clientName: client.fullName || 'Client',
                //             deliveryDuration: (order.driverAssignment.duration?.actual || 0).toString(),
                //             earnings: finalEarnings.toFixed(2),
                //             penalties: penalty.toFixed(2),
                //             rating: 'Pending'
                //         },
                //         priority: 'NORMAL'
                //     });
                // }

                // 6. TODO: Send SMS to client
                // await SMSService.send({
                //     to: order.location.dropOff.contactPerson?.phone,
                //     message: `Your order ${order.orderRef} has been delivered. Rate your experience: [link]`
                // });

            } catch (notificationError) {
                console.log('❌ Notification error:', notificationError);
                // Don't fail the request if notifications fail
            }

            // send a non blocking mail
            try {
                // 7. TODO: Send email receipt to client
                await MailClient.deliverySuccessClient(client?.email, order.orderRef, order.driverAssignment.duration?.actual, order.driverAssignment?.driverInfo.name);
            } catch (err) {
                console.log(err.message)
            }
            try {
                // 7. TODO: Send email receipt to driver
                await MailClient.deliverySuccessDriver(order.driverAssignment?.driverInfo.email, order.orderRef, order.driverAssignment.duration?.actual, client.fullName);
            } catch (err) {
                console.log(err.message)
            }

            const dashboardData = await DriverController.userDashBoardData(userData);
            if (!dashboardData) {
                return res.status(404).json({error: "Dashboard data not found"});
            }

            const response = {
                success: true,
                message: "🎉 Delivery completed successfully!",
                userData: dashboardData,
                order: {
                    _id: order._id,
                    orderRef: order.orderRef,
                    status: order.status,
                    deliveredAt: now,
                    deliveryDuration: order.driverAssignment.duration?.actual,
                    recipient: verificationData.recipientName.trim()
                },
                verification: {
                    recipientName: verificationData.recipientName.trim(),
                    photosUploaded: photoUrls.length,
                    videoUploaded: !!videoUrl,
                    tokenVerified: true
                },
                earnings: {
                    base: baseEarnings,
                    penalty: penalty,
                    final: finalEarnings,
                    currency: order.pricing?.currency || 'NGN',
                    breakdown: penalty > 0 ? {
                        baseEarnings: `₦${baseEarnings.toFixed(2)}`,
                        penalty: `-₦${penalty.toFixed(2)}`,
                        finalEarnings: `₦${finalEarnings.toFixed(2)}`,
                        note: penalty > 0 ? 'Penalty applied for late arrival' : null
                    } : null
                },
                requiresRating: true,
                nextAction: {
                    orderId: order._id,
                    orderRef: order.orderRef,
                    clientId: order.clientId,
                    earnings: finalEarnings
                }
            };

            return res.status(200).json(response);

        } catch (error) {
            console.log('❌ Complete delivery error:', error);

            return res.status(500).json({
                error: "An error occurred while completing delivery",
                ...(process.env.NODE_ENV === 'development' && {
                    details: error.message
                })
            });
        }
    }

    /**
     * POST /driver/cancel-order
     * Driver cancels order with penalty calculation
     */
    static async cancelOrder(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, reason} = req.body;

        if (!orderId || !reason) {
            return res.status(400).json({
                error: "Order ID and reason are required"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver} = await getModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Calculate cancellation penalty
            let penalty = 0;
            if (order.status === 'picked_up' || order.status === 'in_transit') {
                // Severe penalty for cancelling after pickup
                penalty = order.pricing.totalAmount * 0.5; // 50% of order value
            } else if (order.status === 'assigned' || order.status === 'en_route_pickup') {
                // Moderate penalty for cancelling after acceptance
                penalty = 500; // Fixed 500 NGN
            }

            const now = new Date();

            // Update order
            order.status = 'cancelled';
            order.cancellation = {
                reason,
                cancelledBy: userData._id,
                cancelledAt: now,
                cancellationFee: penalty
            };

            // Add tracking history
            order.orderTrackingHistory.push({
                status: 'cancelled',
                timestamp: now,
                title: 'Order Cancelled',
                description: `Cancelled by driver: ${reason}`,
                icon: '❌',
                updatedBy: {
                    role: 'driver',
                    name: userData.fullName
                },
                isCompleted: true,
                isCurrent: true
            });

            await order.save();

            // Update driver
            await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        availabilityStatus: 'online',
                        'operationalStatus.currentOrderId': null
                    },
                    $inc: {
                        'performance.cancellationRate': 1,
                        'wallet.balance': -penalty // Deduct penalty
                    }
                }
            );

            // TODO: Notify client
            // TODO: Re-broadcast order to other drivers

            return res.status(200).json({
                success: true,
                message: "Order cancelled",
                penalty: penalty > 0 ? {
                    amount: penalty,
                    reason: order.status === 'picked_up'
                        ? "50% penalty for cancelling after pickup"
                        : "500 NGN penalty for cancelling after acceptance"
                } : null
            });

        } catch (error) {
            console.log('Cancel order error:', error);
            return res.status(500).json({
                error: "An error occurred while cancelling order"
            });
        }
    }

    /**
     * GET /driver/order/:orderId
     * Get active order details
     */
    static async getOrderDetails(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId} = req.params;

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findById(orderId).lean();

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify driver is assigned to this order
            if (order.driverAssignment?.driverId?.toString() !== userData._id.toString()) {
                return res.status(403).json({
                    error: "You are not assigned to this order"
                });
            }

            return res.status(200).json({
                success: true,
                order
            });

        } catch (error) {
            console.log('Get order details error:', error);
            return res.status(500).json({
                error: "An error occurred while fetching order details"
            });
        }
    }

    /**
     * POST /driver/report-issue
     * Report an issue with the order
     */
    static async reportIssue(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, issueType, description, photos} = req.body;

        if (!orderId || !issueType || !description) {
            return res.status(400).json({
                error: "Order ID, issue type, and description are required"
            });
        }

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Log issue in communications
            order.communications.push({
                type: 'issue_report',
                recipient: 'admin',
                content: `Issue reported by driver ${userData.fullName}: ${issueType} - ${description}`,
                sentAt: new Date(),
                status: 'sent',
                metadata: {
                    issueType,
                    photos: photos || []
                }
            });

            await order.save();

            // TODO: Alert admin dashboard
            // TODO: Send notification to support team

            return res.status(200).json({
                success: true,
                message: "Issue reported successfully. Support team will contact you soon."
            });

        } catch (error) {
            console.log('Report issue error:', error);
            return res.status(500).json({
                error: "An error occurred while reporting issue"
            });
        }
    }

    static async arrivedPickUp(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, stage, locationDetails} = req.body;
        if (!orderId || !stage || !locationDetails) {
            return res.status(400).json({
                error: "Order ID, stage, and location details are required"
            });
        }

        if (stage !== 'arrived_pickup') {
            return res.status(400).json({
                error: "Invalid delivery status"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver} = await getModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }
            // update status to arrived_pickup
            order.status = 'arrived_pickup';
            await order.save();

            order.orderTrackingHistory.push({
                status: 'arrived_at_pickup',
                timestamp: new Date(),
                title: 'Driver Arrived',
                description: 'Driver has arrived at pickup location',
                icon: '📍',
                updatedBy: {
                    role: 'system',
                    name: 'AAngLogistics System'
                },
                isCompleted: true,
                isCurrent: true
            });

            await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        'currentLocation.coordinates': {
                            lat: locationDetails.lat,
                            lng: locationDetails.lng
                        },
                        'currentLocation.accuracy': locationDetails.accuracy || 0,
                        'currentLocation.speed': locationDetails.speed || 0,
                        'currentLocation.isMoving': (locationDetails.speed || 0) > 1,
                        'currentLocation.timestamp': new Date(),
                        'operationalStatus.lastLocationUpdate': new Date()
                    }
                }
            );
            // ⚠️ SEND NOTIFICATIONS (New section)
            try {

                // Notify client
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'delivery.driver_arrived',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName,
                        driverPhone: userData.phoneNumber,
                        vehicleType: userData.vehicleDetails.type,
                        vehicleNumber: userData.vehicleDetails.plateNumber
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        driverId: userData._id,
                    },
                    priority: 'HIGH'
                });

                console.log('✅ Notifications sent successfully');
            } catch (notificationError) {
                console.log('⚠️ Notification error (non-blocking):', notificationError);
            }


            return res.status(200).json({
                success: true,
                message: "Driver has arrived at pickup location."
            });

        } catch (error) {
            console.log('Report issue error:', error);
            return res.status(500).json({
                error: "An error occurred while reporting issue"
            });
        }

    }

    /**
     * Confirm Package Pickup - V2
     * Merges v1 functionality with new media structure
     *
     * POST /api/driver/order/confirm-pickup
     *
     * Body: {
     *   orderId: string,
     *   stage: 'arrived_pickup',
     *   verificationData: {
     *     packageCondition: 'good' | 'damaged' | 'tampered',
     *     weight: string,
     *     notes: string,
     *     contactPersonVerified: boolean,
     *     photos: [{ key, url, fileName }],
     *     video: { key, url, fileName, duration } | null,
     *     videoUrl: string (deprecated - use video.url),
     *     timestamp: number | null
     *   }
     * }
     */
    static async confirmPickUp(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, stage, verificationData, currentLocation} = req.body;

        if (!orderId) {
            return res.status(400).json({
                error: "Order ID is required"
            });
        }

        if (!verificationData) {
            return res.status(400).json({
                error: "Verification data is required"
            });
        }

        if (!currentLocation) {
            return res.status(400).json({
                error: "Current location data is required"
            });
        }

        // Validate required verification fields
        const requiredFields = ['packageCondition', 'contactPersonVerified'];
        for (const field of requiredFields) {
            if (verificationData[field] === undefined || verificationData[field] === null) {
                return res.status(400).json({
                    error: `${field} is required in verification data`
                });
            }
        }

        // Validate minimum images (3 required)
        if (!verificationData.photos || !Array.isArray(verificationData.photos) || verificationData.photos.length < 2) {
            return res.status(400).json({
                error: "At least 2 photos are required for package confirmation"
            });
        }

        // Validate package condition
        const validConditions = ['good', 'damaged', 'tampered'];
        if (!validConditions.includes(verificationData.packageCondition)) {
            return res.status(400).json({
                error: "Invalid package condition. Must be: good, damaged, or tampered"
            });
        }

        try {
            const {Order} = await getOrderModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify driver is assigned to this order
            if (!order.driverAssignment?.driverId ||
                order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({
                    error: "You are not assigned to this order"
                });
            }

            // Verify order is in correct stage
            if (order.status !== 'arrived_pickup') {
                return res.status(400).json({
                    error: `Cannot confirm pickup. Forbidden Order status`
                });
            }

            // Check if already confirmed
            if (order.status === 'pickedUp-confirmed') {
                return res.status(400).json({
                    error: "Package has already been picked up"
                });
            }

            const now = new Date();

            // ============================================
            // 3. CALCULATE PENALTY (Location Honesty Check)
            // TODO: Implement late delivery penalty logic
            // ============================================

            // let penalty = null;
            // const acceptanceData = order.metadata?.acceptanceData;
            //
            // if (acceptanceData && acceptanceData.acceptedLocation) {
            //     const actualArrivalTime = (now - new Date(acceptanceData.acceptedLocation.timestamp)) / 60000; // minutes
            //     const expectedMaxTime = acceptanceData.maxAllowedETA || 30; // Default 30 min if not set
            //
            //     if (actualArrivalTime > expectedMaxTime) {
            //         const delay = actualArrivalTime - expectedMaxTime;
            //         const delayPercentage = (delay / expectedMaxTime) * 100;
            //
            //         // TODO: Fine-tune penalty thresholds and amounts based on business rules
            //         if (delayPercentage > 20) {
            //             penalty = {
            //                 type: 'location_dishonesty',
            //                 amount: Math.min(delayPercentage * 10, 500), // Cap at 500 NGN
            //                 reason: `Arrived ${Math.ceil(delay)} minutes late. Possible location dishonesty.`,
            //                 deducted: false,
            //                 calculatedAt: now
            //             };
            //
            //             // Store penalty for later deduction from earnings
            //             if (!order.metadata) order.metadata = {};
            //             order.metadata.penalty = penalty;
            //         }
            //     }
            // }

            // ============================================
            // 4. PROCESS MEDIA REFERENCES
            // ============================================

            // Extract photo URLs (photos are already uploaded to S3)
            const photoUrls = verificationData.photos
                .filter(photo => photo && photo.url)
                .map(photo => photo.url);

            // Extract video URL if exists
            let videoUrl = null;
            if (verificationData.video && verificationData.video.url) {
                videoUrl = verificationData.video.url;
            } else if (verificationData.videoUrl) {
                // Fallback for backward compatibility
                videoUrl = verificationData.videoUrl;
            }

            // Store complete media metadata for audit trail
            const mediaMetadata = {
                photos: verificationData.photos.map(photo => ({
                    key: photo.key,
                    url: photo.url,
                    fileName: photo.fileName,
                    uploadedAt: now
                })),
                video: verificationData.video ? {
                    key: verificationData.video.key,
                    url: verificationData.video.url,
                    fileName: verificationData.video.fileName,
                    duration: verificationData.video.duration,
                    uploadedAt: now
                } : null
            };

            // Update main status
            order.status = 'pickedUp-confirmed';

            // Update driver assignment tracking
            if (!order.driverAssignment.actualTimes) {
                order.driverAssignment.actualTimes = {};
            }
            order.driverAssignment.actualTimes.pickedUpAt = now;

            // Store pickup confirmation with all verification data
            order.pickupConfirmation = {
                confirmedBy: {
                    name: userData.fullName || userData.name,
                    phone: userData.phoneNumber || userData.phone
                },
                confirmedAt: now,
                photos: photoUrls,
                videos: videoUrl ? [videoUrl] : [],
                signature: null, // Can be added in future

                // Extended verification data (new in v2)
                verification: {
                    packageCondition: verificationData.packageCondition,
                    weight: verificationData.weight || null,
                    notes: verificationData.notes || '',
                    contactPersonVerified: verificationData.contactPersonVerified,
                    verifiedAt: now,

                    // Store complete media metadata for audit
                    mediaMetadata: mediaMetadata
                }
            };

            // Mark previous current as completed
            if (order.orderTrackingHistory && order.orderTrackingHistory.length > 0) {
                order.orderTrackingHistory.forEach(history => {
                    if (history.isCurrent) {
                        history.isCurrent = false;
                        history.isCompleted = true;
                    }
                });
            }

            // Add new tracking event
            const trackingEvent = {
                status: 'package_picked_up',
                timestamp: now,
                title: 'Package Picked Up',
                description: `${userData.fullName || 'Driver'} has collected the package`,
                icon: '📦',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName || userData.name,
                    vehicleType: order.driverAssignment?.driverInfo?.vehicleType,
                    vehicleNumber: order.driverAssignment?.driverInfo?.vehicleNumber,

                    // Package verification summary
                    packageCondition: verificationData.packageCondition,
                    photosCount: photoUrls.length,
                    hasVideo: !!videoUrl,

                    proof: {
                        type: 'photo',
                        url: photoUrls[0], // First photo as proof
                        verifiedAt: now
                    }
                },
                updatedBy: {
                    role: 'driver',
                    name: userData.fullName || userData.name
                },
                isCompleted: true,
                isCurrent: true
            };

            if (!order.orderTrackingHistory) {
                order.orderTrackingHistory = [];
            }
            order.orderTrackingHistory.push(trackingEvent);

            // Calculate distance from driver to pickup
            const dropOffLng = order.location.dropOff.coordinates.coordinates[0];
            const dropOffLat = order.location.dropOff.coordinates.coordinates[1];

            const distanceToDropOff = DriverController.calculateDistance(
                currentLocation.lat,
                currentLocation.lng,
                dropOffLng,
                dropOffLat
            );

            // Calculate ETA
            const estimatedETA = DriverController.calculateETA(distanceToDropOff);

            order.orderTrackingHistory.push({
                status: 'en_route_to_dropoff',
                timestamp: new Date(),
                title: 'Driver En Route to Pickup',
                description: `${userData.fullName} is heading to the drop off location`,
                icon: '🚀',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName,
                    vehicleType: userData.vehicleDetails.type,
                    eta: estimatedETA,
                    distance: distanceToDropOff,
                    location: {
                        lat: currentLocation.lat,
                        lng: currentLocation.lng
                    }
                },
                updatedBy: {
                    role: 'system',
                    name: 'AAngLogistics System'
                },
                isCompleted: false,
                isCurrent: true
            });

            // ============================================
            // 7. ADD TO ORDER INSTANT HISTORY (if needed)
            // ============================================

            if (!order.orderInstantHistory) {
                order.orderInstantHistory = [];
            }

            order.orderInstantHistory.push({
                status: 'package_picked_up',
                timestamp: now,
                updatedBy: {
                    userId: userData._id,
                    role: 'driver'
                },
                notes: verificationData.notes || 'Package picked up and verified'
            });

            await order.save();

            const response = {
                success: true,
                message: "Pickup confirmed successfully",
            };

            // ============================================
            // 10. SEND NOTIFICATIONS (Optional - TODO)
            // ============================================

            // TODO: Send push notification to client
            // TODO: Send SMS confirmation to client
            // TODO: Update real-time tracking dashboard

            // ⚠️ SEND NOTIFICATIONS (New section)
            try {

                // Notify client
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'delivery.picked_up',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName,
                        driverPhone: userData.phoneNumber,
                        vehicleType: userData.vehicleDetails.type,
                        vehicleNumber: userData.vehicleDetails.plateNumber
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        driverId: userData._id,
                    },
                    priority: 'HIGH'
                });

                console.log('✅ Notifications sent successfully');
            } catch (notificationError) {
                console.log('⚠️ Notification error (non-blocking):', notificationError);
            }

            return res.status(200).json(response);

        } catch (error) {
            console.error('❌ Confirm pickup error:', error);

            // Log detailed error for debugging
            console.error('Error details:', {
                orderId,
                driverId: userData._id,
                stage,
                error: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                error: "An error occurred while confirming pickup",
                ...(process.env.NODE_ENV === 'development' && {
                    details: error.message
                })
            });
        }
    }

    static async arrivedDropOff(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, stage, locationDetails} = req.body;
        if (!orderId || !stage || !locationDetails) {
            return res.status(400).json({
                error: "Order ID, stage, and location details are required"
            });
        }

        if (stage !== 'arrived_dropoff') {
            return res.status(400).json({
                error: "Invalid delivery status"
            });
        }

        try {
            const {Order} = await getOrderModels();
            const {Driver} = await getModels();

            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            order.status = 'arrived_dropoff';
            await order.save();

            order.orderTrackingHistory.push({
                status: 'arrived_at_dropoff',
                timestamp: new Date(),
                title: 'Driver at DropOff',
                description: 'Driver has arrived at package destination location',
                icon: '📍',
                updatedBy: {
                    role: 'system',
                    name: 'AAngLogistics System'
                },
                isCompleted: true,
                isCurrent: true
            });

            await Driver.findByIdAndUpdate(
                userData._id,
                {
                    $set: {
                        'currentLocation.coordinates': {
                            lat: locationDetails.lat,
                            lng: locationDetails.lng
                        },
                        'currentLocation.accuracy': locationDetails.accuracy || 0,
                        'currentLocation.speed': locationDetails.speed || 0,
                        'currentLocation.isMoving': (locationDetails.speed || 0) > 1,
                        'currentLocation.timestamp': new Date(),
                        'operationalStatus.lastLocationUpdate': new Date()
                    }
                }
            );
            // ⚠️ SEND NOTIFICATIONS (New section)
            try {

                // Notify client
                await NotificationService.createNotification({
                    userId: order.clientId,
                    type: 'delivery.driver_arrived_dst',
                    templateData: {
                        orderRef: order.orderRef,
                        orderId: order._id.toString(),
                        driverName: userData.fullName,
                        driverPhone: userData.phoneNumber,
                        vehicleType: userData.vehicleDetails.type,
                        vehicleNumber: userData.vehicleDetails.plateNumber
                    },
                    metadata: {
                        orderId: order._id,
                        orderRef: order.orderRef,
                        driverId: userData._id,
                    },
                    priority: 'HIGH'
                });

                console.log('✅ Notifications sent successfully');
            } catch (notificationError) {
                console.log('⚠️ Notification error (non-blocking):', notificationError);
            }

            return res.status(200).json({
                success: true,
                message: "Driver has arrived at pickup location."
            });
        } catch (error) {
            console.log('Report issue error:', error);
            return res.status(500).json({
                error: "An error occurred while reporting issue"
            });
        }

    }

    /**
     * Verify Delivery Token
     * POST /api/driver/order/verify-delivery-token
     *
     * Body: {
     *   orderId: string,
     *   deliveryToken: string (6 characters)
     * }
     */
    static async verifyDeliveryToken(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, deliveryToken, stage} = req.body;

        // Validate payload
        if (!orderId || !deliveryToken || !stage) {
            return res.status(400).json({error: "Invalid payload requirement"});
        }

        // Validate token length
        if (deliveryToken.length !== 6) {
            return res.status(400).json({error: "Delivery token must be exactly 6 characters"});
        }

        if (stage !== 'arrived_dropoff') {
            return res.status(400).json({error: "Forbidden stage type"});
        }

        try {
            const {Order} = await getOrderModels();
            const order = await Order.findById(orderId);

            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify driver is assigned to this order
            if (!order.driverAssignment?.driverId ||
                order.driverAssignment.driverId.toString() !== userData._id.toString()) {
                return res.status(403).json({error: "You are not assigned to this order"});
            }

            // Verify order is at dropoff stage
            if (order.status !== stage) {
                return res.status(400).json({
                    error: `Order: Forbidden delivery stage`
                });
            }

            // Check if token already verified
            if (order.tokenVerified?.verified) {
                return res.status(400).json({
                    error: "Delivery token has already been verified",
                    verifiedAt: order.tokenVerified.verifiedAt
                });
            }

            // Verify token matches (case-sensitive)
            if (order.deliveryToken !== deliveryToken) {
                // Log failed attempt for security
                console.log(`Failed token verification attempt for order ${orderId} by driver ${userData._id}`);

                return res.status(401).json({
                    error: "Invalid delivery token. Please check and try again.",
                    hint: "Token is case-sensitive (e.g., A3X9K2)"
                });
            }

            await Order.findByIdAndUpdate(orderId, {
                $set: {
                    'tokenVerified.verified': true,
                    'tokenVerified.verifiedAt': new Date(),
                    'tokenVerified.verifiedBy': {
                        name: 'AAngLogistics System',
                    }
                }
            }, {runValidators: true});

            order.orderTrackingHistory.push({
                status: 'package_delivered',
                timestamp: new Date(),
                title: 'Delivery Token Verified',
                description: `Token verified by ${userData.fullName || 'driver'}`,
                icon: '🔑',
                metadata: {
                    driverId: userData._id,
                    driverName: userData.fullName,
                    verificationMethod: 'token'
                },
                updatedBy: {
                    role: 'driver',
                    name: userData.fullName || userData.name
                },
                isCompleted: false,
                isCurrent: false
            });

            await order.save();

            return res.status(200).json({
                success: true,
                message: "Delivery token verified successfully",
                verifiedAt: order.tokenVerified.verifiedAt,
                recipientExpected: order.location.dropOff.contactPerson?.name || 'Not specified'
            });

        } catch (error) {
            console.error('Verify delivery token error:', error);
            return res.status(500).json({
                error: "An error occurred while verifying delivery token"
            });
        }
    }

    static async reviewDelivery(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {orderId, rating} = req.body; // Changed from ratingData to rating to match your payload

        if (!orderId || !rating) {
            return res.status(400).json({error: "Order ID and rating data are required"});
        }

        // Validate rating structure
        if (!rating.stars || rating.stars < 1 || rating.stars > 5) {
            return res.status(400).json({error: "Valid star rating (1-5) is required"});
        }

        try {
            const {Order} = await getOrderModels();

            // Find the order and verify driver has access
            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({error: "Order not found"});
            }

            // Verify this driver was assigned to this order
            if (order.driverAssignment.driverId.toString() !== userData.id) {
                return res.status(403).json({error: "Not authorized to rate this order"});
            }

            // Check if driver has already rated this order
            if (order.rating.clientRating.ratedAt) {
                return res.status(400).json({error: "You have already rated this delivery"});
            }

            // Validate categories if provided
            if (rating.categories && Array.isArray(rating.categories)) {
                const validCategories = ['communication', 'package_condition', 'location_accuracy', 'logistics'];
                for (const category of rating.categories) {
                    if (!validCategories.includes(category.category)) {
                        return res.status(400).json({error: `Invalid category: ${category.category}`});
                    }
                    if (category.rating < 1 || category.rating > 5) {
                        return res.status(400).json({error: `Invalid rating for category ${category.category}`});
                    }
                }
            }

            // Prepare the client rating data
            const clientRatingData = {
                stars: rating.stars,
                feedback: rating.feedback || "",
                categories: rating.categories || [],
                wouldRecommend: rating.wouldRecommend || null,
                ratedAt: new Date(),
                canEdit: true // Allow one-time edit within time window
            };

            // Update the order with driver's rating
            const updatedOrder = await Order.findByIdAndUpdate(
                orderId,
                {
                    $set: {
                        'rating.clientRating': clientRatingData,
                        'rating.pendingRatings.client': false
                    }
                },
                {new: true}
            );

            console.log('✅ Driver rating submitted successfully');

            // TODO: Update client's aggregated rating summary (you'll implement this later)
            // await updateClientRatingSummary(order.clientId, clientRatingData);

            return res.status(200).json({
                success: true,
                message: "Rating submitted successfully",
            });

        } catch (error) {
            console.error('❌ Review delivery error:', error);
            return res.status(500).json({
                error: "An error occurred while submitting your rating"
            });
        }
    }

    static async driverData(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const driverData = await DriverController.userDashBoardData(userData);
        if (!driverData) {
            return res.status(404).json({error: "Dashboard data not found"});
        }
        return res.status(200).json(driverData);

    }

    static async driverAnalytics(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {

            const {DriverAnalytics} = await getAnalyticsModels();
            const analytics = await DriverAnalytics.findOne({
                driverId: userData._id
            });

            if (!analytics) {
                return res.status(404).json({
                    success: false,
                    message: 'Analytics not found for this driver'
                });
            }

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            console.error('Verify delivery token error:', error);
            return res.status(500).json({
                error: "An error occurred while verifying delivery token"
            });
        }

    }

    // DriverController.js - Delivery Analytics Method

    static async driverDeliveryAnalytics(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const driverId = userData._id;

        try {
            const {
                month,
                year,
                limit = 100,
                offset = 0,
                status = 'all' // 'all', 'delivered', 'cancelled'
            } = req.query;

            const { Order } = await getOrderModels();
            const { DriverAnalytics } = await getAnalyticsModels();

            // Get analytics summary
            const analytics = await DriverAnalytics.findOne({ driverId });

            if (!analytics) {
                return res.status(404).json({
                    success: false,
                    message: 'Analytics not found for this driver'
                });
            }

            // Build query for deliveries
            const query = {
                'driverAssignment.driverId': new mongoose.Types.ObjectId(driverId)
            };

            // Filter by status if specified
            if (status !== 'all') {
                query.status = status;
            }

            // Filter by month/year if specified
            if (month && year) {
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0, 23, 59, 59, 999);
                query.createdAt = { $gte: startDate, $lte: endDate };
            } else {
                // Default to current month if no filter specified
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                query.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
            }

            // Get total count for pagination
            const totalDeliveries = await Order.countDocuments(query);

            // Get paginated deliveries
            const deliveries = await Order.find(query)
                .select({
                    orderRef: 1,
                    status: 1,
                    pricing: 1,
                    location: 1,
                    package: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    'driverAssignment.actualTimes': 1,
                    'driverAssignment.distance': 1,
                    'driverAssignment.duration': 1,
                    'rating.clientRating': 1,
                    pickupConfirmation: 1,
                    deliveryConfirmation: 1,
                    deliveryToken: 1,
                    tokenVerified: 1
                })
                .sort({ createdAt: -1 })
                .limit(parseInt(limit))
                .skip(parseInt(offset))
                .lean();

            // Calculate summary stats for current filter
            const summaryPipeline = [
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalDeliveries: { $sum: 1 },
                        totalEarnings: { $sum: '$pricing.totalAmount' },
                        totalDistance: { $sum: '$driverAssignment.distance.total' },
                        completedCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                        },
                        cancelledCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                        },
                        avgEarnings: { $avg: '$pricing.totalAmount' },
                        avgDistance: { $avg: '$driverAssignment.distance.total' },
                        avgDuration: { $avg: '$driverAssignment.duration.actual' }
                    }
                }
            ];

            const summaryResult = await Order.aggregate(summaryPipeline);
            const summary = summaryResult[0] || {
                totalDeliveries: 0,
                totalEarnings: 0,
                totalDistance: 0,
                completedCount: 0,
                cancelledCount: 0,
                avgEarnings: 0,
                avgDistance: 0,
                avgDuration: 0
            };

            // Get weekly data for chart (last 7 days)
            const last7Days = Array.from({ length: 7 }, (_, i) => {
                const date = new Date();
                date.setDate(date.getDate() - (6 - i));
                date.setHours(0, 0, 0, 0);
                return date;
            });

            const weeklyData = await Promise.all(
                last7Days.map(async (date) => {
                    const nextDay = new Date(date);
                    nextDay.setDate(date.getDate() + 1);

                    const dayStats = await Order.aggregate([
                        {
                            $match: {
                                'driverAssignment.driverId': new mongoose.Types.ObjectId(driverId),
                                createdAt: { $gte: date, $lt: nextDay },
                                status: 'delivered'
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                deliveries: { $sum: 1 },
                                earnings: { $sum: '$pricing.totalAmount' }
                            }
                        }
                    ]);

                    return {
                        date: date.toISOString().split('T')[0],
                        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
                        deliveries: dayStats[0]?.deliveries || 0,
                        earnings: dayStats[0]?.earnings || 0
                    };
                })
            );

            // Get monthly data for current year
            const currentYear = parseInt(year) || new Date().getFullYear();
            const monthlyData = await Order.aggregate([
                {
                    $match: {
                        'driverAssignment.driverId': new mongoose.Types.ObjectId(driverId),
                        status: 'delivered',
                        createdAt: {
                            $gte: new Date(currentYear, 0, 1),
                            $lte: new Date(currentYear, 11, 31, 23, 59, 59)
                        }
                    }
                },
                {
                    $group: {
                        _id: { $month: '$createdAt' },
                        deliveries: { $sum: 1 },
                        earnings: { $sum: '$pricing.totalAmount' }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyChartData = monthNames.map((name, index) => {
                const monthData = monthlyData.find(m => m._id === index + 1);
                return {
                    month: name,
                    deliveries: monthData?.deliveries || 0,
                    earnings: monthData?.earnings || 0
                };
            });

            // Get available months/years for filtering
            const availablePeriods = await Order.aggregate([
                {
                    $match: {
                        'driverAssignment.driverId': new mongoose.Types.ObjectId(driverId)
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': -1, '_id.month': -1 } }
            ]);

            const periods = availablePeriods.map(p => ({
                year: p._id.year,
                month: p._id.month,
                count: p.count,
                label: `${monthNames[p._id.month - 1]} ${p._id.year}`
            }));

            // Format deliveries for frontend
            const formattedDeliveries = deliveries.map(delivery => ({
                id: delivery._id.toString(),
                orderRef: delivery.orderRef,
                status: delivery.status,
                earnings: delivery.pricing?.totalAmount || 0,
                distance: delivery.driverAssignment?.distance?.total || 0,
                duration: delivery.driverAssignment?.duration?.actual || 0,
                pickupLocation: {
                    address: delivery.location?.pickUp?.address || '',
                    landmark: delivery.location?.pickUp?.landmark || ''
                },
                dropoffLocation: {
                    address: delivery.location?.dropOff?.address || '',
                    landmark: delivery.location?.dropOff?.landmark || ''
                },
                packageCategory: delivery.package?.category || 'other',
                packageDescription: delivery.package?.description || '',
                rating: delivery.rating?.clientRating?.stars || null,
                feedback: delivery.rating?.clientRating?.feedback || '',
                createdAt: delivery.createdAt,
                completedAt: delivery.driverAssignment?.actualTimes?.deliveredAt || delivery.updatedAt,
                hasPickupPhotos: delivery.pickupConfirmation?.photos?.length > 0,
                hasDeliveryPhotos: delivery.deliveryConfirmation?.photos?.length > 0,
                tokenVerified: delivery.tokenVerified?.verified || false
            }));

            return res.status(200).json({
                success: true,
                data: {
                    summary: {
                        ...summary,
                        completionRate: summary.totalDeliveries > 0
                            ? ((summary.completedCount / summary.totalDeliveries) * 100).toFixed(1)
                            : 0
                    },
                    charts: {
                        weekly: weeklyData,
                        monthly: monthlyChartData
                    },
                    deliveries: formattedDeliveries,
                    pagination: {
                        total: totalDeliveries,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: parseInt(offset) + parseInt(limit) < totalDeliveries
                    },
                    filters: {
                        availablePeriods: periods,
                        currentMonth: month ? parseInt(month) : new Date().getMonth() + 1,
                        currentYear: year ? parseInt(year) : new Date().getFullYear(),
                        currentStatus: status
                    },
                    lifetimeStats: {
                        totalDeliveries: analytics.lifetime.totalDeliveries,
                        totalEarnings: analytics.lifetime.totalEarnings,
                        totalDistance: analytics.lifetime.totalDistance,
                        averageRating: analytics.lifetime.averageRating
                    }
                }
            });

        } catch (error) {
            console.log("Driver delivery analytics error:", error);
            return res.status(500).json({
                success: false,
                error: "An error occurred while fetching driver delivery analytics"
            });
        }
    }

    static async getSingleDelivery(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const driverId = userData._id;
        const { orderId } = req.params;

        try {
            const { Order } = await getOrderModels();

            // Find the order and verify it belongs to this driver
            const delivery = await Order.findOne({
                _id: orderId,
                'driverAssignment.driverId': driverId
            }).lean();

            if (!delivery) {
                return res.status(404).json({
                    success: false,
                    message: 'Delivery not found or does not belong to you'
                });
            }

            return res.status(200).json({
                success: true,
                data: delivery
            });

        } catch (error) {
            console.log("Get single delivery error:", error);
            return res.status(500).json({
                success: false,
                error: "An error occurred while fetching delivery details"
            });
        }
    }

    static async migrateAnalytics(req, res){
        try {
            const {
                batchSize = 50,
                driverLimit = null,
                skipExisting = true
            } = req.body;

            console.log('📊 Migration requested with options:', { batchSize, driverLimit, skipExisting });

            const migration = new AnalyticsMigration();
            const result = await migration.migrate({
                batchSize,
                driverLimit,
                skipExisting
            });

            res.json({
                success: true,
                message: 'Migration completed successfully',
                data: result
            });

        } catch (error) {
            console.error('Migration error:', error);
            res.status(500).json({
                success: false,
                message: 'Migration failed',
                error: error.message
            });
        }
    }

}

module.exports = DriverController;