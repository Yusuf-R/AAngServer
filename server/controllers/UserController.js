import AuthController from "./AuthController";
import {profileUpdateSchema, validateSchema, avatarSchema} from "../validators/validateAuth";
import getModels from "../models/AAng/AAngLogistics";
import getFinancialModels from "../models/Finance/FinancialTransactions";
import FinancialService from "../services/FinancialService";
import getOrderModels from "../models/Order";
import locationSchema from "../validators/locationValidator";
import mongoose from "mongoose";
import ReferenceGenerator from "../utils/ReferenceGenerator";
import axios from "axios";


class UserController {

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
            const dashboardData = await AuthController.userDashBoardData(updatedUser);
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
            const dashboardData = await AuthController.userDashBoardData(updatedUser);
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

    // Enhanced Location CRUD operations

    static async createLocation(req, res) {
        console.log('I was called');
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
            const dashboardData = await AuthController.userDashBoardData(updatedUser);
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
            const dashboardData = await AuthController.userDashBoardData(updatedUser);
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
        if (!mongoose.Types.ObjectId.isValid(locationData._id)) {
            return res.status(400).json({error: "Invalid location ID format."});
        }

        try {
            const {AAngBase} = await getModels();

            // First, check if the location exists and belongs to the user
            const userWithLocation = await AAngBase.findOne({
                _id: userData._id,
                'savedLocations._id': locationData._id,
                role: 'Client'
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
                    role: 'Client'
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
            const dashboardData = await AuthController.userDashBoardData(updatedUser);
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
                    role: 'Client'
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
                    role: 'Client'
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

    static async getFinancialData(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { FinancialTransaction, ClientWallet } = await getFinancialModels();
            const { Order } = await getOrderModels();
            const { AAngBase } = await getModels();

            // Get user's wallet data
            const user = await AAngBase.findById(userData._id);
            const wallet = await ClientWallet.findOne({ clientId: userData._id });

            // Calculate total orders
            const totalOrders = await Order.countDocuments({
                clientId: userData._id,
                status: { $ne: 'cancelled' }
            });

            // Calculate completed orders
            const completedOrders = await Order.countDocuments({
                clientId: userData._id,
                status: 'delivered'
            });

            // Calculate total amount paid
            const paymentAggregation = await FinancialTransaction.aggregate([
                {
                    $match: {
                        clientId: userData._id,
                        transactionType: 'client_payment',
                        status: 'completed'
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalPaid: { $sum: '$amount.gross' }
                    }
                }
            ]);

            const totalPaid = paymentAggregation[0]?.totalPaid || 0;

            // Get wallet balance
            const walletBalance = wallet?.balance || 0;

            return res.status(200).json({
                financialData: {
                    totalOrders,
                    completedOrders,
                    totalPaid,
                    walletBalance,
                    pendingOrders: totalOrders - completedOrders,
                }
            });
        } catch (error) {
            console.log('Get financial data error:', error);
            return res.status(500).json({ error: 'Failed to fetch financial data' });
        }
    }

    /**
     * Get client transaction history
     */
    static async getTransactionHistory(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        try {
            const { FinancialTransaction } = await getFinancialModels();

            // Get transactions for the client
            const transactions = await FinancialTransaction.find({
                clientId: userData._id,
                transactionType: "client_payment",
                status: { $in: ['completed', 'pending', 'failed'] }
            })
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip)
                .lean();

            // Get total count for pagination
            const totalCount = await FinancialTransaction.countDocuments({
                clientId: userData._id,
                status: { $in: ['completed', 'pending', 'failed'] }
            });

            return res.status(200).json({
                transactions,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalCount / limit),
                    totalTransactions: totalCount,
                    hasMore: skip + transactions.length < totalCount
                }
            });
        } catch (error) {
            console.log('Get transaction history error:', error);
            return res.status(500).json({ error: 'Failed to fetch transaction history' });
        }
    }

    static async getFinancialSummary(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { FinancialTransaction, ClientWallet } = await getFinancialModels();
            const { Order } = await getOrderModels();

            // Get client wallet
            const wallet = await ClientWallet.findOne({ clientId: userData._id });
            const currentBalance = wallet?.balance || 0;

            // Calculate order statistics
            const orderStats = await Order.aggregate([
                {
                    $match: {
                        clientId: userData._id,
                        'payment.status': 'paid'
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalOrders: { $sum: 1 },
                        totalSpent: { $sum: '$payment.amount' },
                        completedOrders: {
                            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                        },
                        pendingOrders: {
                            $sum: { $cond: [{ $in: ['$status', ['pending', 'in_transit', 'assigned']] }, 1, 0] }
                        }
                    }
                }
            ]);

            const orders = orderStats[0] || {
                totalOrders: 0,
                totalSpent: 0,
                completedOrders: 0,
                pendingOrders: 0
            };

            // Calculate wallet statistics
            const walletStats = await FinancialTransaction.aggregate([
                {
                    $match: {
                        clientId: userData._id,
                        transactionType: { $in: ['wallet_deposit', 'wallet_deduction'] },
                        status: 'completed'
                    }
                },
                {
                    $group: {
                        _id: '$transactionType',
                        total: { $sum: '$amount.net' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            const deposits = walletStats.find(s => s._id === 'wallet_deposit') || { total: 0, count: 0 };
            const deductions = walletStats.find(s => s._id === 'wallet_deduction') || { total: 0, count: 0 };

            // Get recent transactions (last 10)
            const recentTransactions = await FinancialTransaction.find({
                clientId: userData._id,
                transactionType: { $in: ['client_payment', 'wallet_deposit', 'wallet_deduction', 'refund'] }
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean();

            return res.status(200).json({
                success: true,
                summary: {
                    // Wallet
                    currentBalance,
                    totalDeposited: deposits.total,
                    totalUsedFromWallet: deductions.total,
                    depositCount: deposits.count,

                    // Orders
                    totalOrders: orders.totalOrders,
                    completedOrders: orders.completedOrders,
                    pendingOrders: orders.pendingOrders,
                    totalSpent: orders.totalSpent,
                    averageOrderValue: orders.totalOrders > 0
                        ? orders.totalSpent / orders.totalOrders
                        : 0,

                    // Lifetime value
                    lifetimeValue: orders.totalSpent + deposits.total,

                    // Recent activity
                    recentTransactions
                }
            });

        } catch (error) {
            console.log('Get financial summary error:', error);
            return res.status(500).json({ error: 'Failed to fetch financial summary' });
        }
    }

    /**
     * Get wallet top-up history
     */
    static async getTopUpHistory(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { status = 'all', page = 1, limit = 20 } = req.query;

        try {
            const { FinancialTransaction } = await getFinancialModels();

            // Build query
            let query = {
                clientId: userData._id,
                transactionType: 'wallet_deposit'
            };

            if (status !== 'all') {
                query.status = status;
            }

            // Calculate pagination
            const skip = (page - 1) * limit;
            const total = await FinancialTransaction.countDocuments(query);

            // Get top-ups
            const topUps = await FinancialTransaction.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            // Calculate stats
            const statsAggregate = await FinancialTransaction.aggregate([
                { $match: { clientId: userData._id, transactionType: 'wallet_deposit' } },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount.net' }
                    }
                }
            ]);

            const stats = {
                total: total,
                completed: statsAggregate.find(s => s._id === 'completed')?.count || 0,
                pending: statsAggregate.find(s => s._id === 'pending')?.count || 0,
                failed: statsAggregate.find(s => s._id === 'failed')?.count || 0,
                totalDeposited: statsAggregate
                    .filter(s => s._id === 'completed')
                    .reduce((sum, s) => sum + s.totalAmount, 0)
            };

            return res.status(200).json({
                success: true,
                topUps,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    pageSize: parseInt(limit),
                    hasNext: skip + parseInt(limit) < total,
                    hasPrev: page > 1
                },
                stats
            });

        } catch (error) {
            console.log('Get top-up history error:', error);
            return res.status(500).json({ error: 'Failed to fetch top-up history' });
        }
    }

    /**
     * Get all financial transactions (combined)
     */
    static async getFinancialTransactions(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { page = 1, limit = 50, type = 'all', status = 'all' } = req.query;

        try {
            const { FinancialTransaction } = await getFinancialModels();

            // Build query
            let query = { clientId: userData._id };

            // Filter by type
            if (type !== 'all') {
                if (type === 'orders') {
                    query.transactionType = 'client_payment';
                } else if (type === 'wallet') {
                    query.transactionType = { $in: ['wallet_deposit', 'wallet_deduction'] };
                } else if (type === 'refunds') {
                    query.transactionType = 'refund';
                }
            } else {
                query.transactionType = {
                    $in: ['client_payment', 'wallet_deposit', 'wallet_deduction', 'refund']
                };
            }

            // Filter by status
            if (status !== 'all') {
                query.status = status;
            }

            // Calculate pagination
            const skip = (page - 1) * limit;
            const total = await FinancialTransaction.countDocuments(query);

            // Get transactions
            const transactions = await FinancialTransaction.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('orderId', 'orderNumber status')
                .lean();

            // Calculate stats
            const stats = await FinancialTransaction.aggregate([
                { $match: { clientId: userData._id } },
                {
                    $group: {
                        _id: '$transactionType',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount.net' }
                    }
                }
            ]);

            return res.status(200).json({
                success: true,
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    pageSize: parseInt(limit),
                    hasNext: skip + parseInt(limit) < total,
                    hasPrev: page > 1
                },
                stats: {
                    orderPayments: stats.find(s => s._id === 'client_payment')?.totalAmount || 0,
                    walletDeposits: stats.find(s => s._id === 'wallet_deposit')?.totalAmount || 0,
                    walletUsed: stats.find(s => s._id === 'wallet_deduction')?.totalAmount || 0,
                    refunds: stats.find(s => s._id === 'refund')?.totalAmount || 0
                }
            });

        } catch (error) {
            console.log('Get financial transactions error:', error);
            return res.status(500).json({ error: 'Failed to fetch transactions' });
        }
    }

    /**
     * Initiate wallet top-up
     */
    static async initiateTopUp(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { amount } = req.body;

        try {
            // Validate amount
            if (!amount || amount < 100) {
                return res.status(400).json({
                    error: 'Minimum top-up amount is ₦100'
                });
            }

            if (amount > 1000000) {
                return res.status(400).json({
                    error: 'Maximum top-up amount is ₦1,000,000'
                });
            }

            // Generate reference
            const reference = ReferenceGenerator.generateTopUpReference();

            // Initialize payment with Paystack
            const paystackResponse = await axios.post(
                'https://api.paystack.co/transaction/initialize',
                {
                    email: userData.email,
                    amount: amount * 100, // Convert to kobo
                    reference: reference,
                    metadata: {
                        type: 'wallet_topup',
                        clientId: userData._id.toString(),
                        clientName: userData.fullName
                    },
                    callback_url: `${process.env.APP_URL}/client/wallet/verify`
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!paystackResponse.data.status) {
                throw new Error('Failed to initialize payment');
            }

            const paymentData = paystackResponse.data.data;

            // Create pending transaction record
            const { FinancialTransaction } = await getFinancialModels();

            const transaction = new FinancialTransaction({
                transactionType: 'wallet_deposit',
                clientId: userData._id,
                amount: {
                    gross: amount,
                    fees: 0, // Will be updated after payment
                    net: amount,
                    currency: 'NGN'
                },
                gateway: {
                    provider: 'paystack',
                    reference: reference,
                    metadata: {
                        access_code: paymentData.access_code,
                        authorization_url: paymentData.authorization_url
                    }
                },
                status: 'pending',
                processedBy: 'system'
            });

            await transaction.save();

            return res.status(200).json({
                success: true,
                payment: {
                    reference: reference,
                    authorization_url: paymentData.authorization_url,
                    access_code: paymentData.access_code
                },
                transaction: transaction._id
            });

        } catch (error) {
            console.log('Initiate top-up error:', error);
            return res.status(500).json({
                error: error.message || 'Failed to initiate top-up'
            });
        }
    }

    /**
     * Verify top-up payment
     */
    static async verifyTopUp(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { reference } = req.body;

        try {
            // Verify with Paystack
            const paystackResponse = await axios.get(
                `https://api.paystack.co/transaction/verify/${reference}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                    }
                }
            );

            if (!paystackResponse.data.status) {
                return res.status(400).json({
                    error: 'Payment verification failed'
                });
            }

            const paymentData = paystackResponse.data.data;

            if (paymentData.status !== 'success') {
                return res.status(400).json({
                    error: 'Payment was not successful',
                    status: paymentData.status
                });
            }

            // Process the top-up
            const result = await FinancialService.processWalletTopup({
                clientId: userData._id,
                grossAmount: paymentData.amount / 100,
                paystackFee: (paymentData.fees || 0) / 100,
                paystackRef: reference
            });

            return res.status(200).json({
                success: true,
                wallet: result.wallet,
                transaction: result.transaction
            });

        } catch (error) {
            console.log('Verify top-up error:', error);
            return res.status(500).json({
                error: error.message || 'Failed to verify top-up'
            });
        }
    }

    /**
     * Get wallet balance
     */
    static async getWalletBalance(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;

        try {
            const { ClientWallet } = await getFinancialModels();

            const wallet = await ClientWallet.findOne({ clientId: userData._id });

            return res.status(200).json({
                success: true,
                balance: wallet?.balance || 0,
                lifetime: wallet?.lifetime || {
                    totalDeposited: 0,
                    totalSpent: 0,
                    totalRefunded: 0
                }
            });

        } catch (error) {
            console.log('Get wallet balance error:', error);
            return res.status(500).json({ error: 'Failed to fetch wallet balance' });
        }
    }









    /**
     * Calculate accurate Paystack fees
     * (Same as frontend calculation for verification)
     */
    // UserController.js - CORRECTED FEE CALCULATION

    static calculatePaystackFees(walletAmount) {
        const PRICING_CONFIG = {
            decimalFee: 0.015,      // 1.5%
            flatFee: 100,           // ₦100
            feeCap: 2000,           // ₦2,000 maximum
            flatFeeThreshold: 2500, // ₦100 fee waived under ₦2,500
        };

        const { decimalFee, flatFee, feeCap, flatFeeThreshold } = PRICING_CONFIG;

        // Convert to number
        const walletAmountNum = parseFloat(walletAmount);

        // Initial estimate for flat fee check
        const initialEstimate = walletAmountNum * 1.015;
        const hasFlatFee = initialEstimate >= flatFeeThreshold;
        const effectiveFlatFee = hasFlatFee ? flatFee : 0;

        // Calculate what user should pay
        let userPays;
        if (hasFlatFee) {
            userPays = (walletAmountNum + effectiveFlatFee) / (1 - decimalFee);
        } else {
            userPays = walletAmountNum / (1 - decimalFee);
        }

        // Round up percentage fee to nearest kobo (PayStack rounds UP)
        let percentageFee = Math.ceil(userPays * decimalFee * 100) / 100;
        let totalFee = percentageFee + effectiveFlatFee;

        // Apply fee cap
        if (totalFee > feeCap) {
            totalFee = feeCap;
            userPays = walletAmountNum + feeCap;
        }

        // Round user pays UP to nearest kobo
        userPays = Math.ceil(userPays * 100) / 100;

        // Recalculate with rounded amount
        percentageFee = Math.ceil(userPays * decimalFee * 100) / 100;
        totalFee = percentageFee + effectiveFlatFee;
        if (totalFee > feeCap) totalFee = feeCap;

        const walletReceives = userPays - totalFee;
        const discrepancy = Math.abs(walletReceives - walletAmountNum);

        // Adjust if discrepancy > 1 kobo
        if (discrepancy > 0.01) {
            userPays += discrepancy;
            userPays = Math.ceil(userPays * 100) / 100;
            percentageFee = Math.ceil(userPays * decimalFee * 100) / 100;
            totalFee = percentageFee + effectiveFlatFee;
            if (totalFee > feeCap) totalFee = feeCap;
        }

        return {
            walletAmount: parseFloat(walletAmountNum.toFixed(2)),
            processingFee: parseFloat(totalFee.toFixed(2)),
            totalAmount: parseFloat(userPays.toFixed(2)),
            walletReceives: parseFloat((userPays - totalFee).toFixed(2))
        };
    }

    /**
     * NEW: Generate reference for wallet top-up
     * Client uses this reference with Paystack WebView
     */
    static async generateTopUpReference(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { amount } = req.body;

        try {
            // Validate amount
            const walletAmount = parseFloat(amount);

            if (!walletAmount || walletAmount < 100) {
                return res.status(400).json({
                    error: 'Minimum top-up amount is ₦100'
                });
            }

            if (walletAmount > 1000000) {
                return res.status(400).json({
                    error: 'Maximum top-up amount is ₦1,000,000'
                });
            }

            // Calculate fees
            const feeCalculation = UserController.calculatePaystackFees(walletAmount);

            // Generate unique reference
            const reference = ReferenceGenerator.generateTopUpReference();

            // Create pending transaction in DB
            const { FinancialTransaction } = await getFinancialModels();

            // ✅ FIX: Check if reference already exists before creating
            const existingTransaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'wallet_deposit'
            });

            if (existingTransaction) {
                console.log('⚠️ Reference already exists, returning existing transaction:', reference);

                return res.status(200).json({
                    success: true,
                    reference: existingTransaction.gateway.reference,
                    transactionId: existingTransaction._id.toString(),
                    amounts: {
                        walletAmount: existingTransaction.amount.net,
                        processingFee: existingTransaction.amount.fees,
                        totalAmount: existingTransaction.amount.gross
                    },
                    clientInfo: {
                        email: userData.email,
                    }
                });
            }

            const transaction = new FinancialTransaction({
                transactionType: 'wallet_deposit',
                clientId: userData._id,
                amount: {
                    gross: feeCalculation.totalAmount,
                    fees: feeCalculation.processingFee,
                    net: feeCalculation.walletAmount,
                    currency: 'NGN'
                },
                gateway: {
                    provider: 'paystack',
                    reference: reference,
                    metadata: {
                        type: 'wallet_topup',
                        clientId: userData._id.toString(),
                        clientName: userData.fullName || null,
                        clientEmail: userData.email,
                        requestedAt: new Date(),
                        expectedAmounts: {
                            userPays: feeCalculation.totalAmount,
                            walletReceives: feeCalculation.walletAmount,
                            fee: feeCalculation.processingFee
                        }
                    }
                },
                status: 'pending',
                processedBy: 'system',
                metadata: {
                    description: `Wallet top-up initiated for ₦${walletAmount}`,
                    channel: 'mobile',
                    initiatedVia: 'paystack_webview'
                }
            });

            await transaction.save();

            console.log('✅ Top-up reference generated:', {
                reference,
                clientId: userData._id,
                walletAmount,
                totalAmount: feeCalculation.totalAmount,
                transactionId: transaction._id
            });

            return res.status(200).json({
                success: true,
                reference: reference,
                transactionId: transaction._id.toString(),
                amounts: {
                    walletAmount: feeCalculation.walletAmount,
                    processingFee: feeCalculation.processingFee,
                    totalAmount: feeCalculation.totalAmount
                },
                clientInfo: {
                    email: userData.email,
                }
            });

        } catch (error) {
            console.log('❌ Generate top-up reference error:', error);

            // ✅ FIX: Handle duplicate key error gracefully
            if (error.code === 11000 && error.keyPattern?.['gateway.reference']) {
                console.log('⚠️ Duplicate reference detected, this is likely a double-call');

                // Extract the reference from the error
                const duplicateReference = error.keyValue?.['gateway.reference'];

                if (duplicateReference) {
                    try {
                        const { FinancialTransaction } = await getFinancialModels();

                        const existingTransaction = await FinancialTransaction.findOne({
                            'gateway.reference': duplicateReference,
                            transactionType: 'wallet_deposit',
                            clientId: userData._id
                        });

                        if (existingTransaction) {
                            console.log('✅ Returning existing transaction for duplicate call');

                            return res.status(200).json({
                                success: true,
                                reference: existingTransaction.gateway.reference,
                                transactionId: existingTransaction._id.toString(),
                                amounts: {
                                    walletAmount: existingTransaction.amount.net,
                                    processingFee: existingTransaction.amount.fees,
                                    totalAmount: existingTransaction.amount.gross
                                },
                                clientInfo: {
                                    email: userData.email,
                                },
                                _duplicate: true // Flag for debugging
                            });
                        }
                    } catch (lookupError) {
                        console.log('Error looking up duplicate transaction:', lookupError);
                    }
                }
            }

            return res.status(500).json({
                error: error.message || 'Failed to generate payment reference'
            });
        }
    }

    /**
     * NEW: Verify and process top-up after Paystack payment
     */
    static async verifyTopUpPayment(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { reference  } = req.body;

        if (!reference) {
            return res.status(400).json({error: "Unknown reference."});
        }
        const { FinancialTransaction, ClientWallet } = await getFinancialModels();
        const transaction = await FinancialTransaction.findOne({
            'gateway.reference': reference ,
            transactionType: 'wallet_deposit',
            clientId: userData._id
        });

        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found',
                code: 'TRANSACTION_NOT_FOUND'
            });
        }
        try {

            // ✅ FIX: Check if already processed (webhook or previous verification)
            if (transaction.status === 'completed') {
                const wallet = await ClientWallet.findOne({ clientId: userData._id });
                return res.status(200).json({
                    success: true,
                    message: 'Wallet topped up successfully',
                    alreadyProcessed: true,
                    wallet: {
                        balance: wallet?.balance || 0,
                        credited: transaction.amount.net,
                        transactionId: transaction._id.toString()
                    },
                    transaction: {
                        reference: transaction.gateway.reference,
                        status: transaction.status,
                        amount: {
                            paid: transaction.amount.gross,
                            fee: transaction.amount.fees,
                            credited: transaction.amount.net
                        }
                    }
                });
            }

            // check if transaction was cancelled thus we save our self the stress
            if (transaction.status === 'cancelled') {
                return res.status(200).json({
                    success: true,
                    message: 'User cancelled the transaction',
                });
            }

            // Verify with Paystack API
            const paystackResponse = await axios.get(
                `https://api.paystack.co/transaction/verify/${reference}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!paystackResponse.data.status) {
                return res.status(400).json({
                    error: 'Payment verification failed with Paystack',
                    code: 'PAYSTACK_VERIFICATION_FAILED'
                });
            }

            const paymentData = paystackResponse.data.data;
            console.log({paymentData});

            // Check payment status
            if (paymentData.status !== 'success') {
                transaction.status = 'failed';
                transaction.gateway.metadata = paymentData;
                await transaction.save();

                return res.status(200).json({
                    success: true,
                    error: `Payment ${paymentData.status}`,
                    status: paymentData.status,
                    code: 'PAYMENT_NOT_SUCCESSFUL'
                });
            }

            // Verify amounts match
            const paidAmount = paymentData.amount / 100;
            const expectedAmount = transaction.amount.gross;
            const amountDifference = Math.abs(paidAmount - expectedAmount);

            if (amountDifference > 0.01) {
                console.log('❌ Amount mismatch:', {
                    expected: expectedAmount,
                    paid: paidAmount,
                    difference: amountDifference
                });

                transaction.status = 'failed';
                transaction.metadata.failureReason = 'Amount mismatch';
                transaction.metadata.amountMismatch = {
                    expected: expectedAmount,
                    paid: paidAmount,
                    difference: amountDifference
                };
                await transaction.save();

                return res.status(400).json({
                    error: 'Payment amount does not match expected amount',
                    code: 'AMOUNT_MISMATCH',
                    details: {
                        expected: expectedAmount,
                        paid: paidAmount
                    }
                });
            }

            // Verify client ID matches
            if (paymentData.metadata?.clientId !== userData._id.toString()) {
                console.log('❌ Client ID mismatch:', {
                    expected: userData._id.toString(),
                    received: paymentData.metadata?.clientId
                });

                return res.status(403).json({
                    error: 'Transaction does not belong to this user',
                    code: 'USER_MISMATCH'
                });
            }

            // ✅ FIX: Use atomic update to prevent race conditions
            // This ensures only ONE process can mark it as completed
            const updatedTransaction = await FinancialTransaction.findOneAndUpdate(
                {
                    _id: transaction._id,
                    status: 'pending' // Only update if still pending
                },
                {
                    $set: {
                        status: 'completed',
                        'amount.fees': (paymentData.fees || 0) / 100,
                        'amount.net': paidAmount - ((paymentData.fees || 0) / 100),
                        processedAt: new Date(),
                        'gateway.metadata.paystack_transaction_id': paymentData.id,
                        'gateway.metadata.paystack_status': paymentData.status,
                        'gateway.metadata.paystack_paid_at': paymentData.paid_at,
                        'gateway.metadata.paystack_channel': paymentData.channel,
                        'gateway.metadata.paystack_ip_address': paymentData.ip_address,
                        'gateway.metadata.verification_time': new Date(),
                        'gateway.metadata.verification_method': 'manual_api'
                    }
                },
                { new: false }
            );

            // ✅ FIX: If update returned null, it means another process already updated it
            if (!updatedTransaction || updatedTransaction.status === 'completed') {
                console.log('⚠️ Transaction already processed by another process (race condition avoided)');

                const wallet = await ClientWallet.findOne({ clientId: userData._id });

                return res.status(200).json({
                    success: true,
                    message: 'Wallet topped up successfully',
                    alreadyProcessed: true,
                    wallet: {
                        balance: wallet?.balance || 0,
                        credited: transaction.amount.net,
                        transactionId: transaction._id.toString()
                    },
                    transaction: {
                        reference: transaction.gateway.reference,
                        status: 'completed',
                        amount: {
                            paid: transaction.amount.gross,
                            fee: transaction.amount.fees,
                            credited: transaction.amount.net
                        }
                    }
                });
            }

            // ✅ Now safe to credit wallet - we're the ONLY process that successfully marked it completed
            const actualFee = (paymentData.fees || 0) / 100;
            const actualNet = paidAmount - actualFee;

            let wallet = await ClientWallet.findOne({ clientId: userData._id });

            if (!wallet) {
                wallet = await ClientWallet.create({
                    clientId: userData._id,
                    balance: 0,
                    lifetime: {
                        totalDeposited: 0,
                        totalSpent: 0,
                        totalRefunded: 0,
                        transactionCount: 0
                    },
                    recentTransactions: [],
                    status: 'active'
                });
            }

            const balanceBefore = wallet.balance;
            wallet.balance += actualNet;

            wallet.lifetime.totalDeposited += actualNet;
            wallet.lifetime.transactionCount += 1;
            wallet.lifetime.lastActivityAt = new Date();

            if (!wallet.lifetime.firstDepositAt) {
                wallet.lifetime.firstDepositAt = new Date();
            }

            wallet.recentTransactions.unshift({
                transactionId: transaction._id,
                type: 'deposit',
                amount: actualNet,
                balanceAfter: wallet.balance,
                createdAt: new Date(),
                description: `Wallet top-up (Ref: ${reference})`
            });

            if (wallet.recentTransactions.length > 50) {
                wallet.recentTransactions = wallet.recentTransactions.slice(0, 50);
            }

            await wallet.save();
            return res.status(200).json({
                success: true,
                message: 'Wallet topped up successfully',
                wallet: {
                    balance: wallet.balance,
                    credited: actualNet,
                    transactionId: transaction._id.toString()
                },
                transaction: {
                    reference: transaction.gateway.reference,
                    status: 'completed',
                    amount: {
                        paid: paidAmount,
                        fee: actualFee,
                        credited: actualNet
                    }
                }
            });

        } catch (error) {
            // console.log('❌ Verify top-up error:', error);
            if (error.response?.data) {
                if (error.response.data.message === 'Transaction reference not found.') {
                    // this means that the user never even tried paying, then we should just mark it as cancelled
                    await FinancialTransaction.findOneAndUpdate(
                        { _id: transaction._id },
                        { $set: { status: 'cancelled' } }
                    );
                    return res.status(200).json({
                        error: error.response.data.message,
                        code: 'PAYSTACK_API_ERROR',
                        message: 'Transaction was cancelled'
                    });
                }
                return res.status(500).json({
                    error: 'Failed to verify payment with Paystack',
                    code: 'PAYSTACK_API_ERROR',
                    message: error.response.data.message
                });
            }
            return res.status(500).json({
                error: error.message || 'Failed to verify payment'
            });
        }
    }

    /**
     * NEW: Check pending transaction status
     * User can call this to retry verification of pending transactions
     */
    static async checkPendingTopUp(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && { tokenExpired: true })
            });
        }

        const { userData } = preCheckResult;
        const { reference } = req.body;

        try {
            const { FinancialTransaction } = await getFinancialModels();

            const transaction = await FinancialTransaction.findOne({
                'gateway.reference': reference,
                transactionType: 'wallet_deposit',
                clientId: userData._id
            });

            if (!transaction) {
                return res.status(404).json({
                    error: 'Transaction not found',
                    code: 'TRANSACTION_NOT_FOUND'
                });
            }

            // If already completed, return status
            if (transaction.status === 'completed') {
                return res.status(200).json({
                    success: true,
                    status: 'completed',
                    message: 'Transaction already completed',
                    transaction: {
                        reference: transaction.gateway.reference,
                        amount: transaction.amount.net,
                        completedAt: transaction.processedAt
                    }
                });
            }

            // If failed, return failure info
            if (transaction.status === 'failed') {
                return res.status(200).json({
                    success: false,
                    status: 'failed',
                    message: 'Transaction failed',
                    transaction: {
                        reference: transaction.gateway.reference,
                        failureReason: transaction.metadata?.failureReason
                    }
                });
            }

            // Still pending - automatically try to verify
            return await UserController.verifyTopUpPayment(req, res);

        } catch (error) {
            console.log('Check pending top-up error:', error);
            return res.status(500).json({
                error: 'Failed to check transaction status'
            });
        }
    }


}

module.exports = UserController;