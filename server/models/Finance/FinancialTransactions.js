// /models/Finance/FinancialTransactions.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const {Schema, model} = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

// ============================================
// CORE FINANCIAL TRANSACTION MODEL
// ============================================

const FinancialTransactionSchema = new Schema({
    // Transaction Type Discriminator
    transactionType: {
        type: String,
        enum: [
            'client_payment',      // Client pays for order
            'wallet_deposit',      // Client tops up wallet
            'wallet_deduction',    // Wallet used for payment
            'driver_earning',      // Driver earns from delivery
            'driver_payout',       // Driver withdraws money
            'platform_revenue',    // Platform's 30% share
            'platform_bonus_revenue',  // Track saved PayStack fees
            'refund',              // Money back to client
            'fee_deduction'        // Paystack fees
        ],
        required: true
    },

    // Core References - REMOVED index: true from here
    orderId: {type: Schema.Types.ObjectId, ref: 'Order'},
    clientId: {type: Schema.Types.ObjectId, ref: 'Base'},
    driverId: {type: Schema.Types.ObjectId, ref: 'Base'},

    // Financial Amounts
    amount: {
        gross: {type: Number, required: true},        // Original amount
        fees: {type: Number, default: 0},             // Paystack fees
        net: {type: Number, required: true},          // After fees
        currency: {type: String, default: 'NGN'}
    },

    // Transaction Status
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'reversed', 'cancelled', 'abandoned'],
        default: 'pending'
    },

    // Payment Gateway Details
    gateway: {
        provider: {type: String, enum: ['paystack', 'wallet', 'hybrid', 'opay'], default: 'paystack'},
        reference: String,
        authorizationCode: String,
        channel: String, // card, bank_transfer, etc.
        metadata: Schema.Types.Mixed
    },

    // Wallet Transaction Details (if applicable)
    wallet: {
        used: {type: Boolean, default: false},
        amount: {type: Number, default: 0},
        balanceBefore: Number,
        balanceAfter: Number
    },

    // Revenue Distribution (for completed orders)
    distribution: {
        driverShare: {type: Number, default: 0},      // 70%
        platformShare: {type: Number, default: 0},    // 30%
        calculated: {type: Boolean, default: false}
    },

    revenueBreakdown: {
        // For platform_revenue transactions
        baseRevenue: Number,              // 30% share
        bonusRevenue: Number,             // Saved fees
        totalRevenue: Number,             // Total

        // Revenue source
        revenueSource: {
            type: String,
            enum: ['delivery_split', 'paystack_fee_saved', 'combined']
        },

        // Link to original pricing
        originalDeliveryTotal: Number,
        expectedPaystackFee: Number,
        actualPaystackFee: Number,

        // Calculation notes
        calculationNotes: String
    },

    // Payout Details (for driver withdrawals)
    payout: {
        requestedAmount: Number,
        transferFee: Number,
        netAmount: Number,
        bankDetails: {
            bankName: String,
            bankCode: String,
            accountNumber: String,
            accountName: String
        },
        paystackTransferRef: String,
        oPayTransferRef: String,
        transferStatus: String
    },

    // Refund Details (if applicable)
    refund: {
        reason: String,
        originalTransactionId: Schema.Types.ObjectId,
        approvedBy: Schema.Types.ObjectId,
        processedAt: Date
    },

    // Metadata & Context
    metadata: {
        description: String,
        userAgent: String,
        ipAddress: String,
        channel: String, // mobile, web, api
        notes: String
    },

    // Audit Trail
    processedBy: {type: String, enum: ['system', 'admin', 'client', 'driver'], default: 'system'},
    processedAt: Date,

}, {
    timestamps: true,
    collection: 'financial_transactions',
    discriminatorKey: 'transactionType',
    strictPopulate: false
});

// ALL INDEXES IN ONE PLACE - No duplicates
FinancialTransactionSchema.index({transactionType: 1, status: 1, createdAt: -1});
FinancialTransactionSchema.index({clientId: 1, createdAt: -1});
FinancialTransactionSchema.index({driverId: 1, createdAt: -1});
FinancialTransactionSchema.index({orderId: 1});
FinancialTransactionSchema.index({'gateway.reference': 1});
FinancialTransactionSchema.index({createdAt: -1});
FinancialTransactionSchema.index({status: 1}); // Added for status queries

// Virtual for transaction summary
FinancialTransactionSchema.virtual('summary').get(function () {
    return {
        id: this._id,
        type: this.transactionType,
        amount: this.amount.net,
        status: this.status,
        date: this.createdAt
    };
});

// ============================================
// CLIENT WALLET MODEL
// ============================================


const RecentTransactionSchema = new Schema({
    transactionId: {
        type: Schema.Types.ObjectId,
        ref: 'FinancialTransaction',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'payment', 'refund'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    description: String
}, {
    _id: false, // Don't create _id for subdocuments
    timestamps: false
});

const ClientWalletSchema = new Schema({
    // clientId here refers to either driverId or clientId
    clientId: {
        type: Schema.Types.ObjectId,
        ref: 'Base',
        required: true,
        unique: true
    },

    // Current Balance
    balance: {
        type: Number,
        default: 0,
        min: 0
    },

    // Lifetime Statistics
    lifetime: {
        totalDeposited: {type: Number, default: 0},
        totalSpent: {type: Number, default: 0},
        totalRefunded: {type: Number, default: 0},
        transactionCount: {type: Number, default: 0},
        firstDepositAt: Date,
        lastActivityAt: Date
    },

    // Recent Transactions (last 10 for quick access)
    recentTransactions: {
        type: [RecentTransactionSchema],
        default: []
    },

    // Wallet Status
    status: {
        type: String,
        enum: ['active', 'frozen', 'suspended'],
        default: 'active'
    },

    // Security
    lastVerifiedAt: Date,
    securityFlags: [{
        type: String,
        reason: String,
        flaggedAt: Date
    }]

}, {
    timestamps: true,
    collection: 'client_wallets',
    strictPopulate: false
});

// Indexes - ONLY in schema.index()
ClientWalletSchema.index({'lifetime.lastActivityAt': -1});

// ============================================
// DRIVER EARNINGS MODEL
// ============================================

const DriverEarningsSchema = new Schema({
    driverId: {
        type: Schema.Types.ObjectId,
        ref: 'Base',
        required: true
    },

    // Current Available Balance
    availableBalance: {
        type: Number,
        default: 0,
        min: 0
    },

    // Lifetime Statistics
    lifetime: {
        totalEarned: {type: Number, default: 0},
        totalWithdrawn: {type: Number, default: 0},
        totalPending: {type: Number, default: 0},
        deliveryCount: {type: Number, default: 0},
        averagePerDelivery: {type: Number, default: 0},
        firstEarningAt: Date,
        lastEarningAt: Date,
        lastWithdrawalAt: Date
    },

    pendingTransfers: [{
        // Core identification
        transactionId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'FinancialTransaction'
        },
        paystackReference: {
            type: String,
            required: true,
            index: true,
            unique: true // Prevent duplicates
        },
        paystackTransferCode: String,

        // Financial details
        requestedAmount: { type: Number, required: true },
        transferFee: { type: Number, required: true },
        netAmount: { type: Number, required: true },

        // 🔥 NEW: Balance snapshot for reconciliation
        balanceBefore: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },

        // Status tracking
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed', 'reversed'],
            default: 'pending',
            index: true
        },

        // Timeline for audit
        requestedAt: { type: Date, default: Date.now, index: true },
        processedAt: Date,
        lastVerifiedAt: Date, // Last time we checked Paystack

        // 🔥 NEW: Auto-reconciliation tracking
        reconciliationAttempts: { type: Number, default: 0 },
        lastReconciliationAttempt: Date,
        nextReconciliationAt: Date, // Schedule next check

        // Paystack response data (for reconciliation)
        paystackResponse: Schema.Types.Mixed,
        webhookData: Schema.Types.Mixed,

        // 🔥 NEW: Reconciliation flags
        requiresManualCheck: { type: Boolean, default: false },
        manualCheckReason: String,
        reconciliationNotes: String,

        // 🔥 NEW: Alert flags
        isStuck: { type: Boolean, default: false },
        stuckSince: Date,
        adminNotified: { type: Boolean, default: false },

        // Bank details for reference
        bankDetails: {
            accountName: String,
            bankName: String,
            accountNumber: String,
            bankCode: String,
            recipientCode: String
        }
    }],

    // ============================================
    // IMPROVED EARNINGS STRUCTURE
    // ============================================

    earnings: {
        // 🔥 CLARIFIED: What drivers see as "available"
        available: {
            type: Number,
            default: 0,
            comment: 'Actual withdrawable balance (earnings - pending withdrawals)'
        },

        // 🔥 NEW: Total earned (never decreases)
        totalEarned: {
            type: Number,
            default: 0,
            comment: 'Lifetime earnings, only increases'
        },

        // Amount in pending withdrawals
        pending: {
            type: Number,
            default: 0,
            comment: 'Sum of all pending withdrawal amounts'
        },

        // Successfully withdrawn (historical)
        withdrawn: {
            type: Number,
            default: 0,
            comment: 'Total successfully withdrawn'
        },

        // 🔥 NEW: Failed withdrawals (refunded)
        refunded: {
            type: Number,
            default: 0,
            comment: 'Total from failed withdrawals that were refunded'
        }
    },



    // ============================================
    // INTELLIGENT PAGINATION SYSTEM
    // ============================================
    earningsPagination: {
        // Current active page (receiving new earnings)
        currentPage: {type: Number, default: 1},
        totalPages: {type: Number, default: 1},
        totalEarnings: {type: Number, default: 0},
        pageSize: {type: Number, default: 500}, // 500 entries per page
        nextPageId: {type: Number, default: 2}
    },

    // Earnings pages (each page holds up to pageSize entries)
    earningsPages: [{
        pageId: {type: Number, required: true},
        pageNumber: {type: Number, required: true},
        earnings: [{
            transactionId: {type: Schema.Types.ObjectId, required: true},
            orderId: {type: Schema.Types.ObjectId, required: true},
            amount: {type: Number, required: true},
            status: {
                type: String,
                enum: ['available', 'withdrawn', 'pending'],
                default: 'available'
            },
            earnedAt: {type: Date, required: true},
            payoutId: {type: Schema.Types.ObjectId} // When withdrawn
        }],
        // Page metadata for efficient querying
        dateRange: {
            start: {type: Date, required: true},
            end: {type: Date, required: true}
        },
        count: {type: Number, default: 0},
        isFull: {type: Boolean, default: false},
        createdAt: {type: Date, default: Date.now}
    }],

    // Recent Earnings (last 20 for quick access)
    recentEarnings: [{
        transactionId: Schema.Types.ObjectId,
        orderId: Schema.Types.ObjectId,
        amount: Number,
        status: String,
        earnedAt: Date
    }],

    // Payout History (last 10)
    recentPayouts: [{
        transactionId: Schema.Types.ObjectId,
        amount: Number,
        netAmount: Number,
        status: String,
        requestedAt: Date,
        processedAt: Date
    }],

    // Banking Information
    bankDetails: {
        bankName: String,
        bankCode: String,
        accountNumber: String,
        accountName: String,
        verified: {type: Boolean, default: false},
        verifiedAt: Date
    },

    // Withdrawal Settings
    withdrawalSettings: {
        minimumAmount: {type: Number, default: 1000},
        autoWithdrawal: {type: Boolean, default: false},
        autoWithdrawalThreshold: Number
    }

}, {
    timestamps: true,
    collection: 'driver_earnings',
    strictPopulate: false
});

// Indexes - ONLY in schema.index()
DriverEarningsSchema.index({driverId: 1});
DriverEarningsSchema.index({availableBalance: -1});
DriverEarningsSchema.index({ 'earningsPagination.totalEarnings': -1 });

// ============================================
// PLATFORM REVENUE MODEL
// ============================================

const PlatformRevenueSchema = new Schema({
    // Time Period
    period: {
        type: {type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'], required: true},
        value: {type: String, required: true}, // e.g., '2025-01-15', '2025-W03', '2025-01'
        startDate: Date,
        endDate: Date
    },

    // Revenue Breakdown
    revenue: {
        gross: {type: Number, default: 0},           // Total platform share (30%)
        paystackFees: {type: Number, default: 0},    // Fees paid to Paystack
        transferFees: {type: Number, default: 0},    // Fees for driver payouts
        refunds: {type: Number, default: 0},         // Refunded amounts
        net: {type: Number, default: 0}              // Actual profit
    },

    // Transaction Counts
    counts: {
        totalOrders: {type: Number, default: 0},
        completedOrders: {type: Number, default: 0},
        refundedOrders: {type: Number, default: 0},
        driverPayouts: {type: Number, default: 0}
    },

    // Detailed Transactions
    transactions: [{
        transactionId: Schema.Types.ObjectId,
        orderId: Schema.Types.ObjectId,
        amount: Number,
        type: String,
        timestamp: Date
    }],

    // Calculation Status
    calculated: {
        status: {type: Boolean, default: false},
        at: Date,
        by: String
    }

}, {
    timestamps: true,
    collection: 'platform_revenue',
    strictPopulate: false
});
// Indexes
PlatformRevenueSchema.index({'period.type': 1, 'period.value': 1}, {unique: true});
PlatformRevenueSchema.index({'period.startDate': 1, 'period.endDate': 1});

// ============================================
// STATIC METHODS
// ============================================

// Financial Transaction Methods
FinancialTransactionSchema.statics.recordClientPayment = async function (data) {
    const {
        orderId,
        clientId,
        grossAmount,
        paystackFee,
        paystackRef,
        walletUsed = 0,
        walletBalanceBefore = 0
    } = data;

    const transaction = new this({
        transactionType: walletUsed > 0 ? 'combined' : 'client_payment',
        orderId,
        clientId,
        amount: {
            gross: grossAmount,
            fees: paystackFee,
            net: grossAmount - paystackFee
        },
        gateway: {
            provider: walletUsed > 0 ? 'combined' : 'paystack',
            reference: paystackRef
        },
        wallet: walletUsed > 0 ? {
            used: true,
            amount: walletUsed,
            balanceBefore: walletBalanceBefore,
            balanceAfter: walletBalanceBefore - walletUsed
        } : undefined,
        status: 'completed',
        processedAt: new Date(),
        processedBy: 'system'
    });

    return await transaction.save();
};

FinancialTransactionSchema.statics.recordDriverEarning = async function (data) {
    const {orderId, driverId, amount} = data;

    const transaction = new this({
        transactionType: 'driver_earning',
        orderId,
        driverId,
        amount: {
            gross: amount,
            fees: 0,
            net: amount
        },
        distribution: {
            driverShare: amount,
            calculated: true
        },
        status: 'completed',
        processedAt: new Date(),
        processedBy: 'system'
    });

    return await transaction.save();
};

FinancialTransactionSchema.statics.recordDriverPayout = async function (data) {
    const {
        driverId,
        requestedAmount,
        transferFee,
        bankDetails,
        paystackTransferRef
    } = data;

    const transaction = new this({
        transactionType: 'driver_payout',
        driverId,
        amount: {
            gross: requestedAmount,
            fees: transferFee,
            net: requestedAmount - transferFee
        },
        payout: {
            requestedAmount,
            transferFee,
            netAmount: requestedAmount - transferFee,
            bankDetails,
            paystackTransferRef,
            transferStatus: 'processing'
        },
        status: 'processing',
        processedBy: 'system'
    });

    return await transaction.save();
};

FinancialTransactionSchema.statics.recordPlatformRevenue = async function (data) {
    const {orderId, amount} = data;

    const transaction = new this({
        transactionType: 'platform_revenue',
        orderId,
        amount: {
            gross: amount,
            fees: 0,
            net: amount
        },
        distribution: {
            platformShare: amount,
            calculated: true
        },
        status: 'completed',
        processedAt: new Date(),
        processedBy: 'system'
    });

    return await transaction.save();
};

// Client Wallet Methods
ClientWalletSchema.statics.getOrCreateWallet = async function (clientId) {
    let wallet = await this.findOne({clientId});

    if (!wallet) {
        wallet = new this({
            clientId,
            balance: 0,
            lifetime: {
                firstDepositAt: new Date()
            }
        });
        await wallet.save();
    }

    return wallet;
};

ClientWalletSchema.methods.deposit = async function (amount, transactionId) {
    this.balance += amount;
    this.lifetime.totalDeposited += amount;
    this.lifetime.transactionCount += 1;
    this.lifetime.lastActivityAt = new Date();

    if (!this.lifetime.firstDepositAt) {
        this.lifetime.firstDepositAt = new Date();
    }

    // Add to recent transactions
    this.recentTransactions.unshift({
        transactionId,
        type: 'deposit',
        amount,
        balanceAfter: this.balance,
        createdAt: new Date()
    });

    // Keep only last 10 transactions
    if (this.recentTransactions.length > 10) {
        this.recentTransactions = this.recentTransactions.slice(0, 10);
    }

    return await this.save();
};

ClientWalletSchema.methods.deduct = async function (amount, transactionId) {
    if (this.balance < amount) {
        throw new Error('Insufficient wallet balance');
    }

    this.balance -= amount;
    this.lifetime.totalSpent += amount;
    this.lifetime.transactionCount += 1;
    this.lifetime.lastActivityAt = new Date();

    this.recentTransactions.unshift({
        transactionId,
        type: 'payment',
        amount: -amount,
        balanceAfter: this.balance,
        createdAt: new Date()
    });

    if (this.recentTransactions.length > 10) {
        this.recentTransactions = this.recentTransactions.slice(0, 10);
    }

    return await this.save();
};

// Driver Earnings Methods
DriverEarningsSchema.statics.getOrCreateEarnings = async function (driverId) {
    let earnings = await this.findOne({driverId});

    if (!earnings) {
        earnings = new this({
            driverId,
            availableBalance: 0,
            earningsPagination: {
                currentPage: 1,
                totalPages: 1,
                totalEarnings: 0,
                pageSize: 500,
                nextPageId: 2
            },
            earningsPages: [{
                pageId: 1,
                pageNumber: 1,
                earnings: [],
                dateRange: {
                    start: new Date(),
                    end: new Date()
                },
                count: 0,
                isFull: false,
                createdAt: new Date()
            }]
        });
        await earnings.save();
    }


    return earnings;
};

DriverEarningsSchema.methods.addEarning = async function (amount, orderId, transactionId) {
    this.availableBalance += amount;
    this.earnings.available += amount;
    this.lifetime.totalEarned += amount;
    this.lifetime.deliveryCount += 1;
    this.lifetime.averagePerDelivery = this.lifetime.totalEarned / this.lifetime.deliveryCount;
    this.lifetime.lastEarningAt = new Date();

    if (!this.lifetime.firstEarningAt) {
        this.lifetime.firstEarningAt = new Date();
    }

    this.recentEarnings.unshift({
        transactionId,
        orderId,
        amount,
        status: 'available',
        earnedAt: new Date()
    });

    if (this.recentEarnings.length > 20) {
        this.recentEarnings = this.recentEarnings.slice(0, 20);
    }

    return await this.save();
};

DriverEarningsSchema.methods.recordPayout = async function (amount, netAmount, transactionId) {
    this.availableBalance -= amount;
    this.earnings.available -= amount;
    this.earnings.withdrawn += amount;
    this.lifetime.totalWithdrawn += amount;
    this.lifetime.lastWithdrawalAt = new Date();

    this.recentPayouts.unshift({
        transactionId,
        amount,
        netAmount,
        status: 'processing',
        requestedAt: new Date()
    });

    if (this.recentPayouts.length > 10) {
        this.recentPayouts = this.recentPayouts.slice(0, 10);
    }

    return await this.save();
};

/**
 * Add a new earning with intelligent pagination
 */
DriverEarningsSchema.methods.addEarningWithPagination = async function (amount, orderId, transactionId) {
    const earningRecord = {
        transactionId,
        orderId,
        amount,
        status: 'available',
        earnedAt: new Date()
    };

    // Update financial metrics
    this.availableBalance += amount;
    this.earnings.available += amount;
    this.lifetime.totalEarned += amount;
    this.lifetime.deliveryCount += 1;
    this.lifetime.averagePerDelivery = this.lifetime.totalEarned / this.lifetime.deliveryCount;
    this.lifetime.lastEarningAt = new Date();

    if (!this.lifetime.firstEarningAt) {
        this.lifetime.firstEarningAt = new Date();
    }

    // Initialize pagination if first time
    if (!this.earningsPagination) {
        this.earningsPagination = {
            currentPage: 1,
            totalPages: 1,
            totalEarnings: 0,
            pageSize: 500,
            nextPageId: 2
        };
    }

    // Get current page
    let currentPage = this.earningsPages.find(page =>
        page.pageNumber === this.earningsPagination.currentPage
    );

    // Create first page if doesn't exist
    if (!currentPage) {
        currentPage = {
            pageId: 1,
            pageNumber: 1,
            earnings: [],
            dateRange: {
                start: new Date(),
                end: new Date()
            },
            count: 0,
            isFull: false,
            createdAt: new Date()
        };
        this.earningsPages.push(currentPage);
    }

    // Add to current page
    currentPage.earnings.push(earningRecord);
    currentPage.count++;
    currentPage.dateRange.end = new Date();
    this.earningsPagination.totalEarnings++;

    // Update recent earnings (last 50 for quick UI access)
    this.recentEarnings.unshift(earningRecord);
    if (this.recentEarnings.length > 50) {
        this.recentEarnings = this.recentEarnings.slice(0, 50);
    }

    // Check if page is full and create new page if needed
    if (currentPage.count >= this.earningsPagination.pageSize) {
        await this._createNewPage();
    }

    return await this.save();
};

/**
 * Create a new earnings page when current one is full
 */
DriverEarningsSchema.methods._createNewPage = async function () {
    const newPage = {
        pageId: this.earningsPagination.nextPageId,
        pageNumber: this.earningsPagination.totalPages + 1,
        earnings: [],
        dateRange: {
            start: new Date(),
            end: new Date()
        },
        count: 0,
        isFull: false,
        createdAt: new Date()
    };

    this.earningsPages.push(newPage);

    // Update pagination metadata
    this.earningsPagination.currentPage = newPage.pageNumber;
    this.earningsPagination.totalPages++;
    this.earningsPagination.nextPageId++;

    // Mark old page as full
    const oldPage = this.earningsPages.find(page =>
        page.pageNumber === newPage.pageNumber - 1
    );
    if (oldPage) {
        oldPage.isFull = true;
    }

    // Auto-archive if we have too many pages
    if (this.earningsPages.length > 20) {
        await this._archiveOldPages();
    }
};

/**
 * Archive old pages to prevent document size issues
 */
DriverEarningsSchema.methods._archiveOldPages = async function () {
    const pagesToKeep = 10; // Keep last 10 pages in main document
    const pagesToArchive = this.earningsPages.slice(0, -pagesToKeep);

    if (pagesToArchive.length > 0) {
        // Archive to separate collection (you'll need to create this)
        const ArchiveModel = mongoose.model('DriverEarningsArchive');

        for (const page of pagesToArchive) {
            await ArchiveModel.create({
                driverId: this.driverId,
                ...page,
                archivedAt: new Date()
            });
        }

        // Remove archived pages from main document
        this.earningsPages = this.earningsPages.slice(-pagesToKeep);

        // Update pagination metadata
        this.earningsPagination.totalPages = pagesToKeep;
        this.earningsPagination.currentPage = this.earningsPages[this.earningsPages.length - 1].pageNumber;
    }
};

/**
 * Get earnings by page number
 */
DriverEarningsSchema.methods.getEarningsPage = function (pageNumber = 1) {
    return this.earningsPages.find(page => page.pageNumber === pageNumber);
};

/**
 * Get all earnings with pagination
 */
DriverEarningsSchema.methods.getAllEarnings = function (limit = 50, page = 1) {
    const targetPage = this.getEarningsPage(page);
    if (!targetPage) return [];

    const startIndex = (page - 1) * limit;
    return targetPage.earnings.slice(startIndex, startIndex + limit);
};

/**
 * Search earnings across all pages
 */
DriverEarningsSchema.methods.searchEarnings = function (filters = {}) {
    let results = [];

    // Search through pages (newest first)
    for (let i = this.earningsPages.length - 1; i >= 0; i--) {
        const page = this.earningsPages[i];
        const pageResults = page.earnings.filter(earning => {
            let match = true;

            if (filters.minAmount && earning.amount < filters.minAmount) match = false;
            if (filters.maxAmount && earning.amount > filters.maxAmount) match = false;
            if (filters.status && earning.status !== filters.status) match = false;
            if (filters.startDate && earning.earnedAt < filters.startDate) match = false;
            if (filters.endDate && earning.earnedAt > filters.endDate) match = false;

            return match;
        });

        results = results.concat(pageResults);

        // Stop if we have enough results
        if (filters.limit && results.length >= filters.limit) {
            break;
        }
    }

    return filters.limit ? results.slice(0, filters.limit) : results;
};


// Export Models
const getFinancialModels = async () => {
    await connectDB();

    const FinancialTransaction = mongoose.models.FinancialTransaction ||
        model('FinancialTransaction', FinancialTransactionSchema);

    const ClientWallet = mongoose.models.ClientWallet ||
        model('ClientWallet', ClientWalletSchema);

    const DriverEarnings = mongoose.models.DriverEarnings ||
        model('DriverEarnings', DriverEarningsSchema);

    const PlatformRevenue = mongoose.models.PlatformRevenue ||
        model('PlatformRevenue', PlatformRevenueSchema);

    return {
        FinancialTransaction,
        ClientWallet,
        DriverEarnings,
        PlatformRevenue
    };
};

export default getFinancialModels;
export {
    FinancialTransactionSchema,
    ClientWalletSchema,
    DriverEarningsSchema,
    PlatformRevenueSchema
};