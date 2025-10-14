import AuthController from "./AuthController";
import {profileUpdateSchema, validateSchema, avatarSchema} from "../validators/validateAuth";
import getModels from "../models/AAng/AAngLogistics";
import locationSchema from "../validators/locationValidator";
import mongoose from "mongoose";
import {transformRepl} from "@babel/cli/lib/babel/util";
import getOrderModels from "../models/Order";


class DriverController {

    static async updateOnlineStatus(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const dbStatus = ["online", "offline", "on-ride", "break", "maintenance"];

        if (!dbStatus.includes(status)) {
            return res.status(400).json({ error: "Unknown status instruction" });
        }

        try {
            const { Driver } = await getModels();


            // Enhanced update with operational status
            const updateData = {
                'availabilityStatus': status,
                'operationalStatus.isActive': status === 'online',
                'operationalStatus.lastActiveAt': new Date()
            };

            // If going offline, clear current order if not on-ride
            if (status === 'offline' && userData.availabilityStatus !== 'on-ride') {
                updateData['operationalStatus.currentOrderId'] = null;
            }

            const updatedUser = await Driver.findByIdAndUpdate(
                userData._id,
                { $set: updateData },
                { new: true }
            );

            if (!updatedUser) {
                return res.status(404).json({ error: "User not found" });
            }

            console.log('Driver status updated successfully');

            // Get comprehensive dashboard data
            const dashboardData = await DriverController.userDashBoardData(updatedUser);

            if (!dashboardData) {
                return res.status(404).json({ error: "Dashboard data not found" });
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

    static async userDashBoardData(userObject, flag = null) {
        let orderData, orderAssignments, activeOrder, recentOrders;
        const { AAngBase } = await getModels();
        const { Order, OrderAssignment } = await getOrderModels();

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
                .sort({ 'driverAssignment.actualTimes.deliveredAt': -1 })
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
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { AAngBase } = await getModels();
            const user = await AAngBase.findById(userData._id);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Get comprehensive dashboard data with order information
            const userDashboard = await DriverController.userDashBoardData(user);

            return res.status(200).json({
                success: true,
                user: userDashboard,
                timestamp: new Date().toISOString()
            });

        } catch (err) {
            console.error('Dashboard data error:', err);
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

            console.log('Profile updated successfully:', updatedUser);

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
            console.error("Profile update error:", error);
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
            console.error("Profile update error:", error);
            return res.status(500).json({
                error: "An error occurred while updating avatar"
            });
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
            console.error("Location creation error:", error);

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
        const locationData = {
            _id: updateData.id,
            ...updateData.data
        }

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
                { _id: userData._id, 'savedLocations._id': locationData._id },
                { $set: {'savedLocations.$': locationData }},
                { new: true }
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
            console.error("Location update error:", error);

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
        if (!mongoose.Types.ObjectId.isValid(locationData._id)) {
            return res.status(400).json({error: "Invalid location ID format."});
        }

        try {
            const {AAngBase} = await getModels();

            // First, check if the location exists and belongs to the user
            const userWithLocation = await AAngBase.findOne({
                _id: userData._id,
                'savedLocations._id': locationData._id,
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
                        savedLocations: {_id: locationData._id}
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
            console.error("Location delete error:", error);
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
            console.error("Get locations error:", error);
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
            console.error("Get location by ID error:", error);
            return res.status(500).json({
                error: "An error occurred while fetching location"
            });
        }
    }

    // data validation
    static async verificationStatus (req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { Driver } = await getModels();
            const driver = await Driver.findById(userData._id).select('verification');

            if (!driver) {
                return res.status(404).json({ message: 'Driver not found' });
            }
            console.log({
                de: driver
            })

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
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { Driver } = await getModels();
            const driver = await Driver.findById(userData._id);

            if (!driver) {
                return res.status(404).json({ message: 'Driver not found' });
            }

            // Extract and validate payload
            const { basicInfo, specificDocs } = req.body;

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
            console.error("Verification submission error:", error);
            return res.status(500).json({
                error: "An error occurred while submitting verification",
                message: error.message
            });
        }
    }

}

module.exports = DriverController;