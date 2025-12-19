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
import getClientAnalyticsModels from "../models/Analytics/ClientAnalytics";
import ClientAnalyticsMigration from '../utils/ClientAnalyticsMigration';


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
                {_id: userData._id, 'savedLocations._id': locationData._id},
                {$set: {'savedLocations.$': locationData}},
                {new: true}
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {FinancialTransaction, ClientWallet} = await getFinancialModels();
            const {Order} = await getOrderModels();
            const {AAngBase} = await getModels();

            // Get user's wallet data
            const user = await AAngBase.findById(userData._id);
            const wallet = await ClientWallet.findOne({clientId: userData._id});

            // Calculate total orders
            const totalOrders = await Order.countDocuments({
                clientId: userData._id,
                status: {$ne: 'cancelled'}
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
                        totalPaid: {$sum: '$amount.gross'}
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
            return res.status(500).json({error: 'Failed to fetch financial data'});
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        try {
            const {FinancialTransaction} = await getFinancialModels();

            // Get transactions for the client
            const transactions = await FinancialTransaction.find({
                clientId: userData._id,
                transactionType: "client_payment",
                status: {$in: ['completed', 'pending', 'failed']}
            })
                .sort({createdAt: -1})
                .limit(limit)
                .skip(skip)
                .lean();

            // Get total count for pagination
            const totalCount = await FinancialTransaction.countDocuments({
                clientId: userData._id,
                status: {$in: ['completed', 'pending', 'failed']}
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
            return res.status(500).json({error: 'Failed to fetch transaction history'});
        }
    }

    static async getFinancialSummary(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {FinancialTransaction, ClientWallet} = await getFinancialModels();
            const {Order} = await getOrderModels();

            // Get client wallet
            const wallet = await ClientWallet.findOne({clientId: userData._id});
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
                        totalOrders: {$sum: 1},
                        totalSpent: {$sum: '$payment.amount'},
                        completedOrders: {
                            $sum: {$cond: [{$eq: ['$status', 'delivered']}, 1, 0]}
                        },
                        pendingOrders: {
                            $sum: {$cond: [{$in: ['$status', ['pending', 'in_transit', 'assigned']]}, 1, 0]}
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
                        transactionType: {$in: ['wallet_deposit', 'wallet_deduction']},
                        status: 'completed'
                    }
                },
                {
                    $group: {
                        _id: '$transactionType',
                        total: {$sum: '$amount.net'},
                        count: {$sum: 1}
                    }
                }
            ]);

            const deposits = walletStats.find(s => s._id === 'wallet_deposit') || {total: 0, count: 0};
            const deductions = walletStats.find(s => s._id === 'wallet_deduction') || {total: 0, count: 0};

            // Get recent transactions (last 10)
            const recentTransactions = await FinancialTransaction.find({
                clientId: userData._id,
                transactionType: {$in: ['client_payment', 'wallet_deposit', 'wallet_deduction', 'refund']}
            })
                .sort({createdAt: -1})
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
            return res.status(500).json({error: 'Failed to fetch financial summary'});
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {status = 'all', page = 1, limit = 20, filter = 'all_wallet'} = req.query;

        try {
            const {FinancialTransaction} = await getFinancialModels();

            // Build query
            let query = {
                clientId: userData._id,
            };

            // Filter based on what the frontend wants
            if (filter === 'all_wallet') {
                query.transactionType = {$in: ['wallet_deposit', 'wallet_deduction']};
            } else if (filter === 'wallet_deduction') {
                query.transactionType = 'wallet_deduction';
            } else {
                query.transactionType = 'wallet_deposit';
            }


            if (status !== 'all') {
                query.status = status;
            }

            // Calculate pagination
            const skip = (page - 1) * limit;
            const total = await FinancialTransaction.countDocuments(query);

            // Get top-ups
            const topUps = await FinancialTransaction.find(query)
                .sort({createdAt: -1})
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            // Calculate stats
            const statsAggregate = await FinancialTransaction.aggregate([
                {
                    $match: {
                        clientId: userData._id,
                        transactionType: {$in: ['wallet_deposit', 'wallet_deduction']}
                        }
                    },
                {
                    $group: {
                        _id:  {
                            transactionType: '$transactionType',
                            status: '$status'
                        },
                        count: {$sum: 1},
                        totalAmount: {$sum: '$amount.net'}
                    }
                }
            ]);

            const depositStats = statsAggregate.filter(s => s._id.transactionType === 'wallet_deposit');
            const stats = {
                total: total,
                completed: depositStats.find(s => s._id.status === 'completed')?.count || 0,
                pending: depositStats.find(s => s._id.status === 'pending')?.count || 0,
                failed: depositStats.find(s => s._id.status === 'failed')?.count || 0,
                totalDeposited: depositStats
                    .filter(s => s._id.status === 'completed')
                    .reduce((sum, s) => sum + s.totalAmount, 0),

                // NEW: Add wallet deduction stats
                walletDeductions: {
                    totalDeductions: statsAggregate
                        .filter(s => s._id.transactionType === 'wallet_deduction' && s._id.status === 'completed')
                        .reduce((sum, s) => sum + s.totalAmount, 0),
                    totalDeductionCount: statsAggregate
                        .filter(s => s._id.transactionType === 'wallet_deduction')
                        .reduce((sum, s) => sum + s.count, 0)
                }
            };

            console.log({
                stats
            })

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
            return res.status(500).json({error: 'Failed to fetch top-up history'});
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {page = 1, limit = 50, type = 'all', status = 'all'} = req.query;

        try {
            const {FinancialTransaction} = await getFinancialModels();

            // Build query
            let query = {clientId: userData._id};

            // Filter by type
            if (type !== 'all') {
                if (type === 'orders') {
                    query.transactionType = 'client_payment';
                } else if (type === 'wallet') {
                    query.transactionType = {$in: ['wallet_deposit', 'wallet_deduction']};
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
                .sort({createdAt: -1})
                .skip(skip)
                .limit(parseInt(limit))
                .populate('orderId', 'orderNumber status')
                .lean();

            // Calculate stats
            const stats = await FinancialTransaction.aggregate([
                {$match: {clientId: userData._id}},
                {
                    $group: {
                        _id: '$transactionType',
                        count: {$sum: 1},
                        totalAmount: {$sum: '$amount.net'}
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
            return res.status(500).json({error: 'Failed to fetch transactions'});
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {amount} = req.body;

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
            const {FinancialTransaction} = await getFinancialModels();

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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {reference} = req.body;

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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {ClientWallet} = await getFinancialModels();

            const wallet = await ClientWallet.findOne({clientId: userData._id});

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
            return res.status(500).json({error: 'Failed to fetch wallet balance'});
        }
    }


    /**
     * Calculate accurate Paystack fees
     * (Same as frontend calculation for verification)
     */
    static calculatePaystackFees(walletAmount) {
        const PRICING_CONFIG = {
            decimalFee: 0.015,      // 1.5%
            flatFee: 100,           // ₦100
            feeCap: 2000,           // ₦2,000 maximum
            flatFeeThreshold: 2500, // ₦100 fee waived under ₦2,500
        };

        const {decimalFee, flatFee, feeCap, flatFeeThreshold} = PRICING_CONFIG;

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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {amount} = req.body;

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
            const {FinancialTransaction} = await getFinancialModels();

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
                        const {FinancialTransaction} = await getFinancialModels();

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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {reference} = req.body;

        if (!reference) {
            return res.status(400).json({error: "Unknown reference."});
        }
        const {FinancialTransaction, ClientWallet} = await getFinancialModels();
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
        try {

            // ✅ FIX: Check if already processed (webhook or previous verification)
            if (transaction.status === 'completed') {
                const wallet = await ClientWallet.findOne({clientId: userData._id});
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
                {new: false}
            );

            // ✅ FIX: If update returned null, it means another process already updated it
            if (!updatedTransaction || updatedTransaction.status === 'completed') {
                console.log('⚠️ Transaction already processed by another process (race condition avoided)');

                const wallet = await ClientWallet.findOne({clientId: userData._id});

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

            let wallet = await ClientWallet.findOne({clientId: userData._id});

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
                        {_id: transaction._id},
                        {$set: {status: 'cancelled'}}
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
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {reference} = req.body;

        try {
            const {FinancialTransaction} = await getFinancialModels();

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


    // controllers/UserController.js

    static async clientAnalytics(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;

        try {
            const {ClientAnalytics} = await getClientAnalyticsModels();
            const {Order} = await getOrderModels();
            const { FinancialTransaction, ClientWallet } = await getFinancialModels();
            const analytics = await ClientAnalytics.findOne({
                clientId: userData._id
            });

            // Return empty analytics if none found
            if (!analytics) {
                return res.json({
                    success: true,
                    data: {
                        clientId: userData._id,
                        lifetime: {
                            totalOrders: 0,
                            completedOrders: 0,
                            cancelledOrders: 0,
                            totalSpent: 0,
                            totalDistance: 0,
                            averageOrderValue: 0,
                            averageRating: 0
                        },
                        daily: [],
                        weekly: [],
                        monthly: [],
                        categories: {},
                        payments: {
                            totalPaid: 0,
                            wallet: {currentBalance: 0}
                        },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        isNewClient: true
                    }
                });
            }

            // Get client wallet
            const wallet = await ClientWallet.findOne({clientId: userData._id});

            // Get Client orders, last 10 max for order whose status is delivered
            const orders = await Order.find({clientId: userData._id, status: 'delivered'}).sort({createdAt: -1}).limit(10);

            res.json({
                success: true,
                analytics,
                wallet,
                orders
            });

        } catch (error) {
            console.log('Analytics fetch error:', error);
            return res.status(500).json({
                success: false,
                error: "An error occurred while fetching analytics"
            });
        }
    }

    static async clientOrderAnalytics(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        try {
            const {
                month,
                year,
                limit = 100,
                offset = 0,
                status = 'all'
            } = req.query;

            const {Order} = await getOrderModels();
            const {ClientAnalytics} = await getClientAnalyticsModels();

            const analytics = await ClientAnalytics.findOne({clientId});
            const endYear = new Date().getFullYear();

            if (!analytics) {
                return res.status(404).json({
                    success: false,
                    message: 'Analytics not found for this client'
                });
            }

            // Build query
            const query = {
                clientId: new mongoose.Types.ObjectId(clientId)
            };

            if (status !== 'all') {
                query.status = status;
            }

            // Date filter
            const currentYear = new Date().getFullYear();
            if (month && year) {
                const startDate = new Date(year, month - 1, 1);
                console.log({startDate});
                const endDate = new Date(endYear, 11, 31, 23, 59, 59, 999);
                query.createdAt = {$gte: startDate, $lte: endDate};
            } else {
                // Default to start of the month of the current year to the end of the year december
                const startOfMonth = new Date(endYear, 0, 1);
                const endOfMonth = new Date(endYear, 11, 31, 23, 59, 59, 999);
                query.createdAt = {$gte: startOfMonth, $lte: endOfMonth};
            }

            const totalOrders = await Order.countDocuments(query);

            const orders = await Order.find(query)
                .select({
                    orderRef: 1,
                    status: 1,
                    pricing: 1,
                    payment: 1,
                    location: 1,
                    package: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    'driverAssignment.actualTimes': 1,
                    'driverAssignment.distance': 1,
                    'driverAssignment.duration': 1,
                    'driverAssignment.driverInfo': 1,
                    'rating.driverRating': 1
                })
                .sort({createdAt: -1})
                .limit(parseInt(limit))
                .skip(parseInt(offset))
                .lean();

            // Calculate summary
            const summaryPipeline = [
                {$match: query},
                {
                    $group: {
                        _id: null,
                        totalOrders: {$sum: 1},
                        totalSpent: {$sum: '$pricing.totalAmount'},
                        totalDistance: {$sum: '$driverAssignment.distance.total'},
                        completedCount: {
                            $sum: {$cond: [{$eq: ['$status', 'delivered']}, 1, 0]}
                        },
                        cancelledCount: {
                            $sum: {$cond: [{$eq: ['$status', 'cancelled']}, 1, 0]}
                        },
                        avgSpent: {$avg: '$pricing.totalAmount'},
                        avgDistance: {$avg: '$driverAssignment.distance.total'},
                        avgDuration: {$avg: '$driverAssignment.duration.actual'}
                    }
                }
            ];

            const summaryResult = await Order.aggregate(summaryPipeline);
            const summary = summaryResult[0] || {
                totalOrders: 0,
                totalSpent: 0,
                totalDistance: 0,
                completedCount: 0,
                cancelledCount: 0,
                avgSpent: 0,
                avgDistance: 0,
                avgDuration: 0
            };

            // Get weekly chart data (last 7 days)
            const last7Days = Array.from({length: 7}, (_, i) => {
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
                                clientId: new mongoose.Types.ObjectId(clientId),
                                createdAt: {$gte: date, $lt: nextDay}
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                orders: {$sum: 1},
                                spent: {$sum: '$pricing.totalAmount'}
                            }
                        }
                    ]);

                    return {
                        date: date.toISOString().split('T')[0],
                        dayName: date.toLocaleDateString('en-US', {weekday: 'short'}),
                        orders: dayStats[0]?.orders || 0,
                        spent: dayStats[0]?.spent || 0
                    };
                })
            );

            // Get monthly chart data
            const monthlyData = await Order.aggregate([
                {
                    $match: {
                        clientId: new mongoose.Types.ObjectId(clientId),
                        createdAt: {
                            $gte: new Date(currentYear, 0, 1),
                            $lte: new Date(currentYear, 11, 31, 23, 59, 59)
                        }
                    }
                },
                {
                    $group: {
                        _id: {$month: '$createdAt'},
                        orders: {$sum: 1},
                        spent: {$sum: '$pricing.totalAmount'}
                    }
                },
                {$sort: {_id: 1}}
            ]);

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyChartData = monthNames.map((name, index) => {
                const monthData = monthlyData.find(m => m._id === index + 1);
                return {
                    month: name,
                    orders: monthData?.orders || 0,
                    spent: monthData?.spent || 0
                };
            });

            // Available periods
            const availablePeriods = await Order.aggregate([
                {$match: {clientId: new mongoose.Types.ObjectId(clientId)}},
                {
                    $group: {
                        _id: {
                            year: {$year: '$createdAt'},
                            month: {$month: '$createdAt'}
                        },
                        count: {$sum: 1}
                    }
                },
                {$sort: {'_id.year': -1, '_id.month': -1}}
            ]);

            const periods = availablePeriods.map(p => ({
                year: p._id.year,
                month: p._id.month,
                count: p.count,
                label: `${monthNames[p._id.month - 1]} ${p._id.year}`
            }));

            // Format orders
            const formattedOrders = orders.map(order => ({
                id: order._id.toString(),
                orderRef: order.orderRef,
                status: order.status,
                amount: order.pricing?.totalAmount || 0,
                distance: order.driverAssignment?.distance?.total || 0,
                duration: order.driverAssignment?.duration?.actual || 0,
                pickupLocation: {
                    address: order.location?.pickUp?.address || '',
                    landmark: order.location?.pickUp?.landmark || ''
                },
                dropoffLocation: {
                    address: order.location?.dropOff?.address || '',
                    landmark: order.location?.dropOff?.landmark || ''
                },
                packageCategory: order.package?.category || 'other',
                packageDescription: order.package?.description || '',
                driverName: order.driverAssignment?.driverInfo?.name || '',
                rating: order.rating?.driverRating?.stars || null,
                feedback: order.rating?.driverRating?.feedback || '',
                createdAt: order.createdAt,
                completedAt: order.driverAssignment?.actualTimes?.deliveredAt || order.updatedAt
            }));

            return res.status(200).json({
                success: true,
                data: {
                    summary: {
                        ...summary,
                        completionRate: summary.totalOrders > 0
                            ? ((summary.completedCount / summary.totalOrders) * 100).toFixed(1)
                            : 0
                    },
                    charts: {
                        weekly: weeklyData,
                        monthly: monthlyChartData
                    },
                    orders: formattedOrders,
                    pagination: {
                        total: totalOrders,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: parseInt(offset) + parseInt(limit) < totalOrders
                    },
                    filters: {
                        availablePeriods: periods,
                        currentMonth: month ? parseInt(month) : new Date().getMonth() + 1,
                        currentYear: year ? parseInt(year) : new Date().getFullYear(),
                        currentStatus: status
                    },
                    lifetimeStats: {
                        totalOrders: analytics.lifetime.totalOrders,
                        totalSpent: analytics.lifetime.totalSpent,
                        totalDistance: analytics.lifetime.totalDistance,
                        averageOrderValue: analytics.lifetime.averageOrderValue
                    }
                }
            });

        } catch (error) {
            console.log("Client order analytics error:", error);
            return res.status(500).json({
                success: false,
                error: "An error occurred while fetching client order analytics"
            });
        }
    }

    static async getSingleOrder(req, res) {
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

            const order = await Order.findOne({
                _id: orderId,
                clientId: userData._id
            }).lean();

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: order
            });

        } catch (error) {
            console.log("Get order error:", error);
            return res.status(500).json({
                success: false,
                error: "Failed to fetch order details"
            });
        }
    }

    // Controller for client payment analytics
    static async clientPaymentAnalytics(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const clientId = userData._id;

        try {
            const {
                month,
                year,
                period = 'month',
                limit = 50,
                offset = 0
            } = req.query;

            const {FinancialTransaction, ClientWallet} = await getFinancialModels();
            const startDate='2025-01-01';
            const endDate= '2025-12-31';


            // Fetch wallet
            const wallet = await ClientWallet.findOne({clientId});

            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    message: 'No payment history found'
                });
            }

            // Build date filter
            const dateFilter = UserController.buildDateFilter(month, year, period, startDate, endDate);

            // Build transaction query
            const transactionQuery = {
                clientId: new mongoose.Types.ObjectId(clientId),
                transactionType: {$in: ['client_payment', 'wallet_deposit', 'wallet_deduction']},
                status: 'completed'
            };

            if (Object.keys(dateFilter).length > 0) {
                transactionQuery.processedAt = dateFilter;
            }

            // Fetch transactions with pagination
            const [transactions, totalTransactions] = await Promise.all([
                FinancialTransaction.find(transactionQuery)
                    .populate('orderId', 'orderRef status pricing')
                    .sort({processedAt: -1})
                    .limit(parseInt(limit))
                    .skip(parseInt(offset))
                    .lean(),
                FinancialTransaction.countDocuments(transactionQuery)
            ]);


            // Calculate period summary
            const periodSummary = await FinancialTransaction.aggregate([
                {$match: transactionQuery},
                {
                    $group: {
                        _id: '$transactionType',
                        totalAmount: {$sum: '$amount.gross'},
                        count: {$sum: 1},
                        avgAmount: {$avg: '$amount.gross'},
                        totalFees: {$sum: '$amount.fees'}
                    }
                }
            ]);

            const payments = periodSummary.find(s => s._id === 'client_payment') || {
                totalAmount: 0, count: 0, avgAmount: 0, totalFees: 0
            };
            const deposits = periodSummary.find(s => s._id === 'wallet_deposit') || {
                totalAmount: 0, count: 0, avgAmount: 0, totalFees: 0
            };
            const deductions = periodSummary.find(s => s._id === 'wallet_deduction') || {
                totalAmount: 0, count: 0, avgAmount: 0, totalFees: 0
            };



            // Calculate spending trends
            const spendingTrends = await UserController.calculateSpendingTrends(clientId, period);

            // Get payment method breakdown
            const paymentMethodBreakdown = await FinancialTransaction.aggregate([
                {$match: transactionQuery},
                {
                    $group: {
                        _id: '$gateway.provider',
                        count: {$sum: 1},
                        totalAmount: {$sum: '$amount.gross'}
                    }
                }
            ]);

            // Format transactions
            const formattedTransactions = transactions.map(tx => ({
                id: tx._id.toString(),
                type: tx.transactionType,
                amount: tx.amount.gross,
                net: tx.amount.net,
                fees: tx.amount.fees,
                status: tx.status,
                date: tx.processedAt,
                orderId: tx.orderId?._id?.toString(),
                orderRef: tx.orderId?.orderRef,
                description: UserController.formatTransactionDescription(tx),
                paymentMethod: tx.gateway?.provider || 'wallet',
                metadata: tx.metadata
            }));

            console.log({
                totalTransactions,
                payments
            })

            // Calculate insights
            const insights = await UserController.generateClientInsights(wallet, periodSummary, spendingTrends);

            return res.status(200).json({
                success: true,
                data: {
                    wallet: {
                        balance: wallet.balance,
                        totalDeposited: wallet.lifetime.totalDeposited,
                        totalSpent: wallet.lifetime.totalSpent,
                        totalRefunded: wallet.lifetime.totalRefunded
                    },
                    summary: {
                        periodPayments: payments.totalAmount,
                        periodDeposits: deposits.totalAmount,
                        periodTransactionCount: payments.count + deposits.count,
                        avgPayment: payments.avgAmount,
                        totalFees: payments.totalFees + deposits.totalFees,
                        paymentCount: payments.count,
                        depositCount: deposits.count
                    },
                    trends: {
                        daily: spendingTrends.daily,
                        weekly: spendingTrends.weekly,
                        monthly: spendingTrends.monthly
                    },
                    breakdown: {
                        paymentMethods: paymentMethodBreakdown.map(pm => ({
                            method: pm._id || 'wallet',
                            count: pm.count,
                            totalAmount: pm.totalAmount,
                            percentage: (pm.totalAmount / (payments.totalAmount + deposits.totalAmount)) * 100
                        }))
                    },
                    transactions: formattedTransactions,
                    pagination: {
                        total: totalTransactions,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        hasMore: parseInt(offset) + parseInt(limit) < totalTransactions
                    },
                    lifetime: {
                        totalSpent: wallet.lifetime.totalSpent,
                        totalDeposited: wallet.lifetime.totalDeposited,
                        totalRefunded: wallet.lifetime.totalRefunded,
                        transactionCount: wallet.lifetime.transactionCount,
                        firstDepositAt: wallet.lifetime.firstDepositAt,
                        lastActivityAt: wallet.lifetime.lastActivityAt
                    },
                    insights
                }
            });

        } catch (error) {
            console.log("Client payment analytics error:", error);
            return res.status(500).json({
                success: false,
                error: "An error occurred while fetching payment analytics"
            });
        }
    }

// Helper functions
    static buildDateFilter(month, year, period, startDate, endDate) {
        // Priority 1: Specific date range
        if (startDate && endDate) {
            return {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        // Priority 2: Monthly filter
        if (month && year) {
            const monthNum = parseInt(month);
            const yearNum = parseInt(year);

            // If month is "all" or 0, get entire year
            if (monthNum === 0 || month === 'all') {
                return {
                    $gte: new Date(yearNum, 0, 1), // Jan 1
                    $lte: new Date(yearNum, 11, 31, 23, 59, 59, 999) // Dec 31
                };
            }

            // Specific month
            const startDate = new Date(yearNum, monthNum - 1, 1);
            const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
            return { $gte: startDate, $lte: endDate };
        }

        // Priority 3: Period-based filters
        const now = new Date();
        const targetYear = parseInt(year) || now.getFullYear();

        switch(period) {
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return { $gte: weekAgo };

            case 'month':
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                return { $gte: startOfMonth };

            case 'year':
                const startOfYear = new Date(targetYear, 0, 1);
                const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);
                return { $gte: startOfYear, $lte: endOfYear };

            case 'all':
            default:
                return {}; // No date filter
        }
    }

    static formatTransactionDescription(tx) {
        if (tx.metadata?.description) return tx.metadata.description;

        if (tx.transactionType === 'client_payment') {
            return tx.orderId?.orderRef
                ? `Payment for ${tx.orderId.orderRef}`
                : 'Order payment';
        }

        if (tx.transactionType === 'wallet_deposit') {
            return `Wallet top-up via ${tx.gateway?.provider || 'gateway'}`;
        }

        return 'Transaction';
    }

    static async calculateSpendingTrends(clientId, period) {
        const {FinancialTransaction} = await getFinancialModels();
        const now = new Date();

        // Daily trend (last 7 days)
        const dailyTrend = await FinancialTransaction.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    transactionType: 'client_payment',
                    status: 'completed',
                    processedAt: {$gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)}
                }
            },
            {
                $group: {
                    _id: {$dateToString: {format: '%Y-%m-%d', date: '$processedAt'}},
                    totalSpent: {$sum: '$amount.gross'},
                    count: {$sum: 1}
                }
            },
            {$sort: {_id: 1}}
        ]);

        // Weekly trend (last 12 weeks)
        const weeklyTrend = await FinancialTransaction.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    transactionType: 'client_payment',
                    status: 'completed',
                    processedAt: {$gte: new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000)}
                }
            },
            {
                $group: {
                    _id: {
                        week: {$week: '$processedAt'},
                        year: {$year: '$processedAt'}
                    },
                    totalSpent: {$sum: '$amount.gross'},
                    count: {$sum: 1}
                }
            },
            {$sort: {'_id.year': 1, '_id.week': 1}}
        ]);

        // Monthly trend (last 12 months)
        const monthlyTrend = await FinancialTransaction.aggregate([
            {
                $match: {
                    clientId: new mongoose.Types.ObjectId(clientId),
                    transactionType: 'client_payment',
                    status: 'completed',
                    processedAt: {$gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)}
                }
            },
            {
                $group: {
                    _id: {
                        month: {$month: '$processedAt'},
                        year: {$year: '$processedAt'}
                    },
                    totalSpent: {$sum: '$amount.gross'},
                    count: {$sum: 1}
                }
            },
            {$sort: {'_id.year': 1, '_id.month': 1}}
        ]);

        return {
            daily: dailyTrend,
            weekly: weeklyTrend,
            monthly: monthlyTrend
        };
    }

    static async generateClientInsights(wallet, periodSummary, trends) {
        const payments = periodSummary.find(s => s._id === 'client_payment') || {totalAmount: 0, count: 0};
        const deposits = periodSummary.find(s => s._id === 'wallet_deposit') || {totalAmount: 0, count: 0};

        const insights = [];

        // Wallet balance insight
        if (wallet.balance < 5000) {
            insights.push({
                type: 'warning',
                title: 'Low Wallet Balance',
                message: `Your wallet balance is ₦${wallet.balance.toLocaleString()}. Consider topping up for faster checkouts.`,
                icon: 'wallet-outline'
            });
        }

        // Spending pattern
        if (payments.count > 0) {
            const avgSpending = payments.totalAmount / payments.count;
            insights.push({
                type: 'info',
                title: 'Your Average Order',
                message: `You typically spend ₦${avgSpending.toLocaleString()} per order.`,
                icon: 'stats-chart-outline'
            });
        }

        // Deposit vs spending
        if (deposits.totalAmount > payments.totalAmount * 1.5) {
            insights.push({
                type: 'success',
                title: 'Great Budgeting!',
                message: `You're topping up more than you spend. Keep it up!`,
                icon: 'thumbs-up-outline'
            });
        }

        // Fees insight
        const totalFees = (payments.totalFees || 0) + (deposits.totalFees || 0);
        if (totalFees > 1000) {
            insights.push({
                type: 'tip',
                title: 'Save on Fees',
                // message: `You paid ₦${totalFees.toLocaleString()} in fees. Use wallet payments to reduce transaction costs.`,
                message: `Wallet payments is possible for your delivery settlements.`,
                icon: 'bulb-outline'
            });
        }

        return insights;
    }

    static async clientSinglePayment(req, res) {
        const preCheckResult = await AuthController.apiPreCheck(req);

        if (!preCheckResult.success) {
            return res.status(preCheckResult.statusCode).json({
                error: preCheckResult.error,
                ...(preCheckResult.tokenExpired && {tokenExpired: true})
            });
        }

        const {userData} = preCheckResult;
        const {txId} = req.params;

        try {
            const {FinancialTransaction} = await getFinancialModels();
            const trxData = await FinancialTransaction.findOne({
                _id: txId,
                clientId: userData._id
            }).lean();

            if (!trxData) {
                return res.status(404).json({
                    success: false,
                    message: 'Transaction data not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: trxData
            });

        } catch (error) {
            console.log("Get transaction data error:", error);
            return res.status(500).json({
                success: false,
                error: "Failed to fetch transaction data"
            });
        }

    }


    /**
     * Migrate client analytics from existing data
     * POST /api/client/analytics/migrate
     */
    static async migrateClientAnalytics(req, res) {
        try {
            const {
                batchSize = 50,
                clientLimit = null,
                skipExisting = true,
                startDate = '2025-01-01'
            } = req.body;

            console.log('📊 Client Analytics Migration requested with options:', {
                batchSize,
                clientLimit,
                skipExisting,
                startDate
            });

            // Validate user is admin or system
            // const preCheckResult = await AuthController.apiPreCheck(req);
            // if (!preCheckResult.success || preCheckResult.userData.role !== 'admin') {
            //     return res.status(403).json({
            //         success: false,
            //         message: 'Unauthorized: Only admins can trigger migrations'
            //     });
            // }

            // Start migration in background
            const migration = new ClientAnalyticsMigration();

            // Run migration (non-blocking)
            migration.migrate({
                batchSize,
                clientLimit,
                skipExisting,
                startDate
            }).then(result => {
                console.log('✅ Client Analytics Migration completed:', result);
            }).catch(error => {
                console.error('❌ Client Analytics Migration failed:', error);
            });

            // Return immediate response
            res.json({
                success: true,
                message: 'Client analytics migration started in background',
                note: 'Check server logs for progress and completion',
                estimatedTime: '5-30 minutes depending on data volume'
            });

        } catch (error) {
            console.log('Client analytics migration error:', error);
            res.status(500).json({
                success: false,
                message: 'Migration initialization failed',
                error: error.message
            });
        }
    }


}

module.exports = UserController;