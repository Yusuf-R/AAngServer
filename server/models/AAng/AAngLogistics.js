// /models/AAng/AAngLogistics.js
import mongoose from "mongoose";
import dbClient from "../../database/mongoDB";

const {Schema, model} = mongoose;

const connectDB = async () => {
    if (mongoose.connection.readyState !== 1) {
        await dbClient.connect();
    }
};

const baseOptions = {
    discriminatorKey: "role",
    timestamps: true,
};

const AuthMethodSchema = new Schema({
    type: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        required: true
    },
    providerId: String,
    verified: {
        type: Boolean,
        default: false
    },
    lastUsed: {
        type: Date,
        default: Date.now
    }
}, {_id: false});
const GoogleCredentialsSchema = new Schema({
    googleId: {
        type: String,
        sparse: true,
        unique: true
    },
    name: {
        type: String,
    },
    givenName: {
        type: String,
    },
    familyName: {
        type: String,
    },
    email: {
        type: String,
        sparse: true
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    picture: String
});
const LocationSchema = new Schema({
    address: {type: String, required: true},
    coordinates: {
        lat: {type: Number, required: true},
        lng: {type: Number, required: true}
    },
    landmark: String,
    contactPerson: {
        name: String,
        phone: String,
        alternatePhone: String
    },
    extraInformation: String,
    locationType: {
        type: String,
        enum: ['residential', 'commercial', 'office', 'mall', 'hospital', 'school', 'other'],
        default: 'residential'
    },
    building: {
        name: String,
        floor: String,
        unit: String
    }
}, {_id: true});
// Enhanced Client Schema
const ClientSchema = new Schema({
    savedLocations: {type: [LocationSchema], default: []},

    // User Preferences
    preferences: {
        notifications: {
            orderUpdates: {type: Boolean, default: true},
            driverLocation: {type: Boolean, default: true},
            promotional: {type: Boolean, default: false},
            smsUpdates: {type: Boolean, default: true},
            emailUpdates: {type: Boolean, default: false}
        },
        defaultPaymentMethod: {type: String, enum: ['Wallet', 'PayStack', 'BankTransfer'], default: 'PayStack'},
        preferredVehicleTypes: [{type: String, enum: ['bicycle', 'motorcycle', 'tricycle', 'van', 'truck', 'car']}],
        communicationChannel: {type: String, enum: ["sms", "push", "email"], default: "push"},
        deliveryInstructions: String,
        emergencyContact: {
            name: String,
            phone: String,
            relationship: String
        }
    },

    // Trust & Safety Score
    trustScore: {
        score: {type: Number, default: 100, min: 0, max: 100},
        factors: [{
            factor: {type: String, enum: ['payment_reliability', 'communication_quality', 'delivery_cooperation', 'false_reports']},
            impact: {type: Number, min: -50, max: 50},
            date: {type: Date, default: Date.now},
            description: String
        }],
        lastCalculated: {type: Date, default: Date.now}
    },

    // Financial Information
    wallet: {
        balance: {type: Number, default: 0},
        totalSpent: {type: Number, default: 0},
        lifetimeValue: {type: Number, default: 0},
        lastTransactionDate: Date
    },

    // Usage Statistics
    statistics: {
        totalOrders: {type: Number, default: 0},
        completedOrders: {type: Number, default: 0},
        cancelledOrders: {type: Number, default: 0},
        averageOrderValue: {type: Number, default: 0},
        favoriteLocations: [{
            locationId: Schema.Types.ObjectId,
            usageCount: Number
        }],
        lastOrderDate: Date,
        memberSince: {type: Date, default: Date.now}
    }
});
// Enhanced Driver Schema
const DriverSchema = new Schema({
    // Current License Number - keep for backward compatibility
    licenseNumber: String,
    vehicleType: String, // Keep for backward compatibility

    // Operational Status
    availabilityStatus: {
        type: String,
        enum: ["online", "offline", "on-ride", "break", "maintenance"],
        default: "offline",
    },

    operationalStatus: {
        currentOrderId: {type: Schema.Types.ObjectId, ref: 'Order'},
        lastLocationUpdate: {type: Date, default: Date.now},
        batteryLevel: {type: Number, min: 0, max: 100},
        appVersion: String,
        deviceModel: String,
        connectionQuality: {type: String, enum: ["excellent", "good", "poor", "offline"], default: "offline"},
        isActive: {type: Boolean, default: false},
        lastActiveAt: {type: Date, default: Date.now}
    },

    // Real-time Location & Movement
    currentLocation: {
        coordinates: {
            lat: {type: Number, required: true, default: 0},
            lng: {type: Number, required: true, default: 0}
        },
        accuracy: {type: Number, default: 0}, // meters
        heading: {type: Number, min: 0, max: 359}, // degrees
        speed: {type: Number, default: 0}, // km/h
        timestamp: {type: Date, default: Date.now},
        address: String,
        isMoving: {type: Boolean, default: false},
        zone: String // operational zone/region
    },

    // Vehicle & Equipment Details
    vehicleDetails: {
        type: {type: String, enum: ['bicycle', 'motorcycle', 'tricycle', 'van', 'truck', 'car']},
        plateNumber: {type: String},
        model: String,
        year: {type: Number, min: 1990, max: new Date().getFullYear() + 2},
        color: String,
        capacity: {
            weight: {type: Number, default: 0}, // kg
            volume: {type: Number, default: 0}, // cubic meters
            passengers: {type: Number, default: 0}
        },
        insuranceExpiry: Date,
        roadWorthiness: {
            certificateNumber: String,
            expiryDate: Date,
            verified: {type: Boolean, default: false},
            verifiedBy: {type: Schema.Types.ObjectId, ref: 'Admin'},
            verificationDate: Date
        },
        registrationExpiry: Date
    },

    // Performance Metrics
    performance: {
        totalDeliveries: {type: Number, default: 0},
        completionRate: {type: Number, default: 0, min: 0, max: 100}, // percentage
        averageRating: {type: Number, default: 0, min: 0, max: 5},
        averageDeliveryTime: {type: Number, default: 0}, // minutes
        onTimeDeliveryRate: {type: Number, default: 0, min: 0, max: 100}, // percentage
        cancellationRate: {type: Number, default: 0, min: 0, max: 100}, // percentage

        // Response metrics
        averageResponseTime: {type: Number, default: 0}, // seconds to accept order
        averagePickupTime: {type: Number, default: 0}, // minutes from assignment to pickup

        // Weekly Stats (auto-reset)
        weeklyStats: {
            deliveries: {type: Number, default: 0},
            earnings: {type: Number, default: 0},
            hoursOnline: {type: Number, default: 0},
            distance: {type: Number, default: 0}, // km
            fuelCost: {type: Number, default: 0},
            weekStarting: {type: Date, default: () => getWeekStart()},
            rating: {type: Number, default: 0}
        },

        // Monthly Stats (auto-reset)
        monthlyStats: {
            deliveries: {type: Number, default: 0},
            earnings: {type: Number, default: 0},
            hoursOnline: {type: Number, default: 0},
            distance: {type: Number, default: 0}, // km
            fuelCost: {type: Number, default: 0},
            month: {type: Number, default: () => new Date().getMonth() + 1},
            year: {type: Number, default: () => new Date().getFullYear()},
            rating: {type: Number, default: 0}
        }
    },

    // Financial Management
    wallet: {
        balance: {type: Number, default: 0},
        pendingEarnings: {type: Number, default: 0},
        totalEarnings: {type: Number, default: 0},
        totalWithdrawn: {type: Number, default: 0},
        lastPayoutDate: Date,
        nextPayoutDate: Date,

        // Banking Details
        bankDetails: {
            accountName: String,
            accountNumber: String,
            bankName: String,
            bankCode: String,
            verified: {type: Boolean, default: false},
            verificationDate: Date,
            verifiedBy: {type: Schema.Types.ObjectId, ref: 'Admin'}
        },

        // Transaction History (last 50)
        recentTransactions: [{
            type: {type: String, enum: ['earning', 'payout', 'bonus', 'penalty', 'refund']},
            amount: Number,
            description: String,
            orderId: {type: Schema.Types.ObjectId, ref: 'Order'},
            timestamp: {type: Date, default: Date.now},
            reference: String
        }]
    },

    // Verification & Compliance
    verification: {
        documentsStatus: {
            license: {type: String, enum: ["pending", "approved", "rejected", "expired"], default: "pending"},
            vehicleRegistration: {type: String, enum: ["pending", "approved", "rejected", "expired"], default: "pending"},
            insurance: {type: String, enum: ["pending", "approved", "rejected", "expired"], default: "pending"},
            roadWorthiness: {type: String, enum: ["pending", "approved", "rejected", "expired"], default: "pending"},
            profilePhoto: {type: String, enum: ["pending", "approved", "rejected"], default: "pending"},
            backgroundCheck: {type: String, enum: ["pending", "approved", "rejected"], default: "pending"}
        },
        overallStatus: {type: String, enum: ["pending", "approved", "rejected", "suspended"], default: "pending"},
        verifiedBy: {type: Schema.Types.ObjectId, ref: 'Admin'},
        verificationDate: Date,
        nextReviewDate: Date,
        notes: String,
        complianceScore: {type: Number, default: 100, min: 0, max: 100}
    },

    // Schedule & Availability
    schedule: {
        preferredWorkingHours: {
            start: {type: String, default: "06:00"}, // "HH:MM"
            end: {type: String, default: "22:00"},   // "HH:MM"
            days: {type: [String], enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], default: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]}
        },

        // Current shift
        currentShift: {
            start: Date,
            end: Date,
            status: {type: String, enum: ["active", "break", "ended"], default: "ended"},
            hoursWorked: {type: Number, default: 0},
            ordersCompleted: {type: Number, default: 0}
        },

        // Break management
        breaks: [{
            start: Date,
            end: Date,
            reason: {type: String, enum: ["lunch", "fuel", "maintenance", "personal"], default: "personal"},
            duration: Number // minutes
        }],

        // Vacation/Time off
        timeOff: {
            active: {type: Boolean, default: false},
            startDate: Date,
            endDate: Date,
            reason: String,
            approvedBy: {type: Schema.Types.ObjectId, ref: 'Admin'}
        }
    },

    // Emergency & Safety
    emergency: {
        emergencyContact: {
            name: String,
            phone: String,
            relationship: String
        },
        safetyFeatures: {
            panicButtonEnabled: {type: Boolean, default: true},
            locationSharingEnabled: {type: Boolean, default: true},
            emergencyCallEnabled: {type: Boolean, default: true}
        },
        incidents: [{
            type: {type: String, enum: ['accident', 'theft', 'harassment', 'vehicle_breakdown', 'other']},
            description: String,
            location: {
                lat: Number,
                lng: Number,
                address: String
            },
            timestamp: {type: Date, default: Date.now},
            severity: {type: String, enum: ['low', 'medium', 'high'], default: 'medium'},
            status: {type: String, enum: ['reported', 'investigating', 'resolved'], default: 'reported'},
            handledBy: {type: Schema.Types.ObjectId, ref: 'Admin'}
        }]
    }
});
// Enhanced Admin Schema
const AdminSchema = new Schema({
    // Role & Permissions System
    adminRole: {
        type: String,
        enum: ["super_admin", "platform_manager", "operations_manager",
            "customer_support", "finance_manager", "compliance_officer"],
        default: "super_admin",
        required: true
    },

    // permissionMatrix: {
    //     // User Management
    //     users: {
    //         view: {type: Boolean, default: false},
    //         create: {type: Boolean, default: false},
    //         edit: {type: Boolean, default: false},
    //         suspend: {type: Boolean, default: false},
    //         delete: {type: Boolean, default: false},
    //         impersonate: {type: Boolean, default: false}
    //     },
    //
    //     // Enhanced Order Management
    //     orders: {
    //         view_all: {type: Boolean, default: false},
    //         view_assigned: {type: Boolean, default: false},
    //         update_status: {type: Boolean, default: false},
    //         cancel_any: {type: Boolean, default: false},
    //         refund: {type: Boolean, default: false},
    //         priority_handling: {type: Boolean, default: false},
    //         manual_status_update: {type: Boolean, default: false},
    //         override_driver_assignment: {type: Boolean, default: false},
    //         emergency_intervention: {type: Boolean, default: false},
    //         tracking_visibility: {type: String, enum: ["none", "assigned", "regional", "all"], default: "assigned"},
    //         bulk_operations: {type: Boolean, default: false}
    //     },
    //
    //     // Driver Management
    //     drivers: {
    //         onboard: {type: Boolean, default: false},
    //         verify: {type: Boolean, default: false},
    //         suspend: {type: Boolean, default: false},
    //         payout: {type: Boolean, default: false},
    //         performance_view: {type: Boolean, default: false},
    //         location_tracking: {type: Boolean, default: false},
    //         schedule_management: {type: Boolean, default: false},
    //         emergency_response: {type: Boolean, default: false}
    //     },
    //
    //     // Financial Controls
    //     financial: {
    //         view_reports: {type: Boolean, default: false},
    //         process_refunds: {type: Boolean, default: false},
    //         adjust_balances: {type: Boolean, default: false},
    //         export_data: {type: Boolean, default: false},
    //         tax_operations: {type: Boolean, default: false},
    //         payout_approval: {type: Boolean, default: false},
    //         fraud_investigation: {type: Boolean, default: false}
    //     },
    //
    //     // System Operations
    //     system: {
    //         config_update: {type: Boolean, default: false},
    //         feature_toggle: {type: Boolean, default: false},
    //         api_management: {type: Boolean, default: false},
    //         database_operations: {type: Boolean, default: false},
    //         server_maintenance: {type: Boolean, default: false},
    //         backup_restore: {type: Boolean, default: false}
    //     },
    //
    //     // Content & Communications
    //     content: {
    //         send_notifications: {type: Boolean, default: false},
    //         manage_templates: {type: Boolean, default: false},
    //         broadcast_messages: {type: Boolean, default: false},
    //         sms_operations: {type: Boolean, default: false},
    //         email_campaigns: {type: Boolean, default: false}
    //     },
    //
    //     // Security & Compliance
    //     security: {
    //         view_audit_logs: {type: Boolean, default: false},
    //         manage_roles: {type: Boolean, default: false},
    //         data_export: {type: Boolean, default: false},
    //         compliance_reports: {type: Boolean, default: false},
    //         incident_management: {type: Boolean, default: false}
    //     }
    // },

    // Real-time Operations
    realTimeOperations: {
        canAccessLiveTracking: {type: Boolean, default: false},
        canManuallyAssignDrivers: {type: Boolean, default: false},
        canInterruptDeliveries: {type: Boolean, default: false},
        escalationLevel: {type: Number, min: 1, max: 5, default: 1},
        responseTimeTarget: {type: Number, default: 300}, // seconds

        activeIncidents: [{
            orderId: {type: Schema.Types.ObjectId, ref: 'Order'},
            incidentType: {type: String, enum: ['delivery_delay', 'driver_unresponsive', 'customer_complaint', 'payment_issue', 'safety_concern']},
            severity: {type: String, enum: ['low', 'medium', 'high', 'critical']},
            assignedAt: {type: Date, default: Date.now},
            expectedResolution: Date,
            status: {type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open'},
            notes: String
        }],

        currentWorkload: {
            assignedOrders: [{type: Schema.Types.ObjectId, ref: 'Order'}],
            assignedTickets: [{type: Schema.Types.ObjectId, ref: 'Ticket'}],
            activeChats: Number,
            lastActionTime: {type: Date, default: Date.now}
        }
    },

    // Operational Limits
    operationalLimits: {
        maxRefundAmount: {type: Number, default: 0}, // 0 = no limit
        maxOrderAmountApprove: {type: Number, default: 0},
        maxDriverAssignments: {type: Number, default: 50}, // per hour
        workingHours: {
            start: {type: String, default: "00:00"}, // 24h format
            end: {type: String, default: "23:59"}
        },
        geofence: {
            type: {type: String, enum: ["national", "regional", "state", "lga"], default: "national"},
            regions: [{type: String}] // States/LGAs this admin can operate in
        },
        concurrentOperations: {type: Number, default: 10}
    },

    // Enhanced Security Configuration
    security: {
        requires2FA: {type: Boolean, default: true},
        last2FASetup: Date,
        backupCodes: [{
            code: String,
            used: {type: Boolean, default: false},
            usedAt: Date
        }],
        sessionSettings: {
            timeoutMinutes: {type: Number, default: 30},
            concurrentSessions: {type: Number, default: 3},
            allowMobileAccess: {type: Boolean, default: true}
        },
        ipWhitelist: [{
            ip: String,
            description: String,
            addedAt: {type: Date, default: Date.now},
            addedBy: {type: Schema.Types.ObjectId, ref: 'Admin'}
        }],
        deviceWhitelist: [{
            deviceId: String,
            deviceName: String,
            lastUsed: Date,
            trusted: {type: Boolean, default: false}
        }],
        loginAttempts: {
            failed: {type: Number, default: 0},
            lastFailedAt: Date,
            lockedUntil: Date
        }
    },

    // Enhanced Audit & Compliance
    auditTrail: [{
        action: {
            type: String,
            required: true
        },
        resourceType: {
            type: String,
            enum: ["user", "order", "driver", "payment", "system", "admin"]
        },
        resourceId: String,
        changes: Schema.Types.Mixed,

        // Enhanced context
        severity: {type: String, enum: ["low", "medium", "high", "critical"], default: "medium"},
        category: {type: String, enum: ["order_management", "driver_ops", "system", "security", "financial", "user_management"]},

        affectedUsers: [{
            userId: Schema.Types.ObjectId,
            userType: {type: String, enum: ["client", "driver", "admin"]}
        }],

        // Location context
        geolocation: {
            lat: Number,
            lng: Number,
            city: String,
            state: String,
            country: {type: String, default: "Nigeria"}
        },

        // Technical context
        ipAddress: String,
        userAgent: String,
        timestamp: {type: Date, default: Date.now},
        outcome: {
            type: String,
            enum: ["success", "failure", "pending", "partial"]
        },

        // Additional metadata
        metadata: Schema.Types.Mixed,
        correlationId: String, // For tracking related actions
        sessionId: String
    }],

    // Workflow & Performance
    assignedWorkload: {
        openTickets: {type: Number, default: 0},
        assignedOrders: [{type: Schema.Types.ObjectId, ref: "Order"}],
        currentShift: {
            start: Date,
            end: Date,
            status: {
                type: String,
                enum: ["active", "completed", "break", "offline"],
                default: "offline"
            },
            hoursWorked: {type: Number, default: 0}
        },
        performanceMetrics: {
            resolutionTime: {type: Number, default: 0}, // Average in minutes
            satisfactionScore: {type: Number, default: 0, min: 0, max: 5},
            completedTasks: {type: Number, default: 0},
            escalatedTasks: {type: Number, default: 0},
            responseTime: {type: Number, default: 0} // Average response time in minutes
        }
    },

    // Emergency & Escalation
    emergencyAccess: {
        hasOverride: {type: Boolean, default: false},
        overrideExpires: Date,
        overrideReason: String,
        approvedBy: {type: Schema.Types.ObjectId, ref: "Admin"},
        emergencyProcedures: [{
            procedure: String,
            lastTrained: Date,
            certified: Boolean,
            expiryDate: Date
        }],
        emergencyContacts: [{
            name: String,
            phone: String,
            role: String,
            available24h: {type: Boolean, default: false}
        }]
    },

    // Communication Preferences
    notifications: {
        emailAlerts: {
            critical: {type: Boolean, default: true},
            warnings: {type: Boolean, default: true},
            routine: {type: Boolean, default: false},
            digest: {type: Boolean, default: true}
        },
        pushNotifications: {
            assignedTask: {type: Boolean, default: true},
            systemAlert: {type: Boolean, default: true},
            securityEvent: {type: Boolean, default: true},
            orderUpdates: {type: Boolean, default: true}
        },
        smsAlerts: {
            securityBreach: {type: Boolean, default: true},
            systemDown: {type: Boolean, default: true},
            emergencyOnly: {type: Boolean, default: true}
        }
    },

    // Training & Certification
    training: {
        completedModules: [{
            module: String,
            completedAt: Date,
            score: Number,
            validUntil: Date
        }],
        requiredCertifications: [{
            certification: String,
            status: {type: String, enum: ['pending', 'completed', 'expired'], default: 'pending'},
            dueDate: Date,
            completedDate: Date
        }],
        lastTrainingDate: Date,
        nextTrainingDue: Date
    }
}, {
    timestamps: true,
    toJSON: {virtuals: true},
    toObject: {virtuals: true}
});

const AAngSchema = new Schema({
    email: {
        type: String,
        unique: true,
        required: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: {
        type: String,
        required: function () {
            return this.authMethods && this.authMethods.some(method => method.type === 'Credentials');
        }
    },
    fullName: String,
    avatar: String,
    status: {
        type: String,
        enum: ["Active", "Inactive", "Suspended", "Banned", "Deleted", "Pending", "Blocked"],
        default: "Active",
    },
    googleCredentials: GoogleCredentialsSchema,
    phoneNumber: String,
    dob: String,
    gender: {type: String, enum: ["Male", "Female"]},
    address: String,
    state: String,
    lga: String,
    authPin: {
        pin: {type: String},
        isEnabled: {type: Boolean, default: false},
        createdAt: {type: Date, default: Date.now},
        lastUsed: {type: Date},
        failedAttempts: {type: Number, default: 0},
        lockedUntil: {type: Date}
    },
    tcs: {
        isAccepted: {
            type: Boolean, default: false
        },
        acceptedAt: {type: Date, default: Date.now},
        version: {type: String, default: '1.0'},
    },
    pinVerificationToken: {
        token: String,
        email: String,
        purpose: {type: String, enum: ['CHANGE_PIN', 'RESET_PIN']},
        createdAt: {type: Date},
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 10 * 60 * 1000)
        },
        used: {type: Boolean, default: false}
    },
    authMethods: {
        type: [AuthMethodSchema],
        validate: {
            validator: function (methods) {
                return methods && methods.length > 0;
            },
            message: 'At least one authentication method is required'
        }
    },
    preferredAuthMethod: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        default: 'Credentials'
    },
    provider: {
        type: String,
        enum: ['Google', 'Apple', 'Credentials', 'AuthPin'],
        default: 'Credentials'
    },
    nin: {
        number: {
            type: String,
            unique: true,
            sparse: true
        },
        verified: {
            type: Boolean,
            default: false
        },
        verification: {
            date: Date,
            method: {
                type: String,
                enum: ['api', 'manual', null],
                default: null
            },
            metadata: {
                type: Object,
                default: {}
            }
        }
    },
    sessionTokens: [{
        token: String,
        device: String,
        ip: String,
        createdAt: {type: Date, default: Date.now},
        lastActive: {type: Date, default: Date.now}
    }],
    resetPasswordToken: String,
    resetPasswordExpiry: Date,
    emailVerificationToken: String,
    emailVerificationExpiry: Date,
    emailVerified: {type: Boolean, default: false},
    authPinResetToken: String,
    authPinResetExpiry: Date
}, baseOptions);

AAngSchema.virtual('hasPassword').get(function () {
    return !!this.password;
});

AAngSchema.virtual('pinStatus').get(function () {
    return {
        isSet: !!(this.authPin && this.authPin.pin),
        setDate: this.authPin?.createdAt,
        lastChanged: this.authPin?.createdAt,
        canChange: this.emailVerified,
        isLocked: this.authPin?.lockedUntil && this.authPin.lockedUntil > new Date(),
        attemptsRemaining: Math.max(0, 5 - (this.authPin?.failedAttempts || 0))
    };
});

AAngSchema.pre('save', function (next) {
    if (this.preferredAuthMethod) {
        this.provider = this.preferredAuthMethod;
    } else if (this.authMethods && this.authMethods.length > 0) {
        this.preferredAuthMethod = this.authMethods[0].type;
        this.provider = this.authMethods[0].type;
    }
    next();
});

// Virtual for admin status
AdminSchema.virtual('isActive').get(function () {
    return this.status === "Active" &&
        (!this.security.requires2FA || this.security.last2FASetup) &&
        (!this.security.loginAttempts.lockedUntil || this.security.loginAttempts.lockedUntil < new Date());
});

// Virtual for permission level
AdminSchema.virtual('permissionLevel').get(function () {
    if (this.adminRole === "super_administrator") return "maximum";
    if (this.adminRole === "administrator") return "elevated";
    if (this.adminRole === "operations_manager") return "operational";
    return "standard";
});

// Virtual for current workload status
AdminSchema.virtual('workloadStatus').get(function () {
    const activeOrders = this.assignedWorkload.assignedOrders?.length || 0;
    const openTickets = this.assignedWorkload.openTickets || 0;
    const total = activeOrders + openTickets;

    if (total === 0) return "available";
    if (total < 5) return "light";
    if (total < 15) return "moderate";
    return "heavy";
});

// Virtual for driver operational status
DriverSchema.virtual('operationalStatusSummary').get(function () {
    const isOnline = this.availabilityStatus === 'online';
    const hasActiveOrder = !!this.operationalStatus.currentOrderId;
    const isLocationCurrent = this.operationalStatus.lastLocationUpdate > new Date(Date.now() - 5 * 60000); // 5 minutes

    return {
        isOperational: isOnline && isLocationCurrent,
        hasActiveDelivery: hasActiveOrder,
        lastSeen: this.operationalStatus.lastLocationUpdate,
        canReceiveOrders: isOnline && !hasActiveOrder && isLocationCurrent
    };
});

// Virtual for driver performance grade
DriverSchema.virtual('performanceGrade').get(function () {
    const rating = this.performance.averageRating || 0;
    const completion = this.performance.completionRate || 0;
    const onTime = this.performance.onTimeDeliveryRate || 0;

    const score = (rating * 0.4) + (completion * 0.003) + (onTime * 0.003);

    if (score >= 4.5) return { grade: 'A+', level: 'excellent' };
    if (score >= 4.0) return { grade: 'A', level: 'very_good' };
    if (score >= 3.5) return { grade: 'B+', level: 'good' };
    if (score >= 3.0) return { grade: 'B', level: 'satisfactory' };
    if (score >= 2.5) return { grade: 'C', level: 'needs_improvement' };
    return { grade: 'D', level: 'poor' };
});

// Helper function for week calculation
function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    return start;
}

// Indexes for Performance - Add these after schema definitions

// Base schema indexes
AAngSchema.index({ phoneNumber: 1 });
AAngSchema.index({ status: 1 });
AAngSchema.index({ role: 1 });

// Client schema indexes
ClientSchema.index({ 'trustScore.score': 1 });
ClientSchema.index({ 'statistics.totalOrders': 1 });
ClientSchema.index({ 'wallet.balance': 1 });
ClientSchema.index({ 'statistics.lastOrderDate': 1 });

// Driver schema indexes - Critical for real-time operations
DriverSchema.index({ availabilityStatus: 1 });
DriverSchema.index({ "currentLocation.coordinates": "2dsphere" });
DriverSchema.index({
    availabilityStatus: 1,
    "verification.overallStatus": 1
});
DriverSchema.index({ "operationalStatus.lastLocationUpdate": 1 });
DriverSchema.index({ "operationalStatus.currentOrderId": 1 });
DriverSchema.index({ "vehicleDetails.type": 1 });
DriverSchema.index({ "performance.averageRating": 1 });
DriverSchema.index({ "wallet.balance": 1 });
DriverSchema.index({
    "currentLocation.zone": 1,
    availabilityStatus: 1
});

// Admin schema indexes
AdminSchema.index({  adminRole: 1, status: 1 });
AdminSchema.index({ "security.ipWhitelist.ip": 1 });
AdminSchema.index({ "operationalLimits.geofence.regions": 1 });
AdminSchema.index({ "auditTrail.timestamp": -1 });
AdminSchema.index({
    adminRole: 1,
    "permissionMatrix.orders.tracking_visibility": 1
});
AdminSchema.index({ "realTimeOperations.activeIncidents.orderId": 1 });
AdminSchema.index({ "assignedWorkload.assignedOrders": 1 });

// Compound indexes for complex queries
DriverSchema.index({
    "currentLocation.coordinates": "2dsphere",
    availabilityStatus: 1,
    "verification.overallStatus": 1
});

AdminSchema.index({
    adminRole: 1,
    "realTimeOperations.canAccessLiveTracking": 1,
    status: 1
});

// Pre-save middleware for data validation and updates
DriverSchema.pre('save', function(next) {
    // Update weekly stats if week has changed
    const currentWeekStart = getWeekStart();
    if (this.performance.weeklyStats.weekStarting < currentWeekStart) {
        this.performance.weeklyStats = {
            deliveries: 0,
            earnings: 0,
            hoursOnline: 0,
            distance: 0,
            fuelCost: 0,
            weekStarting: currentWeekStart,
            rating: 0
        };
    }

    // Update monthly stats if month has changed
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    if (this.performance.monthlyStats.month !== currentMonth ||
        this.performance.monthlyStats.year !== currentYear) {
        this.performance.monthlyStats = {
            deliveries: 0,
            earnings: 0,
            hoursOnline: 0,
            distance: 0,
            fuelCost: 0,
            month: currentMonth,
            year: currentYear,
            rating: 0
        };
    }

    // Update location timestamp when coordinates change
    if (this.isModified('currentLocation.coordinates')) {
        this.currentLocation.timestamp = new Date();
        this.operationalStatus.lastLocationUpdate = new Date();
    }

    next();
});

ClientSchema.pre('save', function(next) {
    // Recalculate trust score if factors have changed
    if (this.isModified('trustScore.factors')) {
        const totalImpact = this.trustScore.factors.reduce((sum, factor) => sum + factor.impact, 0);
        this.trustScore.score = Math.max(0, Math.min(100, 100 + totalImpact));
        this.trustScore.lastCalculated = new Date();
    }

    next();
});

AdminSchema.pre('save', function(next) {
    // Limit audit trail to last 1000 entries
    if (this.auditTrail.length > 1000) {
        this.auditTrail = this.auditTrail.slice(-1000);
    }

    // Clean up expired active incidents
    if (this.realTimeOperations.activeIncidents) {
        this.realTimeOperations.activeIncidents = this.realTimeOperations.activeIncidents.filter(
            incident => incident.status !== 'resolved' ||
                incident.assignedAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Keep resolved incidents for 7 days
        );
    }

    next();
});

// Static methods for common operations
DriverSchema.statics.findAvailableNearby = function(lat, lng, maxDistance = 10000, vehicleType = null) {
    const query = {
        availabilityStatus: 'online',
        'verification.overallStatus': 'approved',
        'operationalStatus.currentOrderId': { $exists: false },
        'currentLocation.coordinates': {
            $near: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
                $maxDistance: maxDistance
            }
        },
        'operationalStatus.lastLocationUpdate': {
            $gte: new Date(Date.now() - 5 * 60000) // Last 5 minutes
        }
    };

    if (vehicleType) {
        query['vehicleDetails.type'] = vehicleType;
    }

    return this.find(query).limit(20);
};

DriverSchema.statics.updateLocation = function(driverId, location) {
    return this.findByIdAndUpdate(
        driverId,
        {
            $set: {
                'currentLocation.coordinates': location.coordinates,
                'currentLocation.accuracy': location.accuracy,
                'currentLocation.heading': location.heading,
                'currentLocation.speed': location.speed,
                'currentLocation.timestamp': new Date(),
                'currentLocation.address': location.address,
                'currentLocation.isMoving': location.speed > 5, // Consider moving if speed > 5 km/h
                'operationalStatus.lastLocationUpdate': new Date()
            }
        },
        { new: true }
    );
};

AdminSchema.statics.logAction = function(adminId, action, resourceType, resourceId, changes, metadata = {}) {
    const auditEntry = {
        action,
        resourceType,
        resourceId,
        changes,
        severity: metadata.severity || 'medium',
        category: metadata.category || 'system',
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        timestamp: new Date(),
        outcome: metadata.outcome || 'success',
        metadata: metadata.additional || {},
        correlationId: metadata.correlationId,
        sessionId: metadata.sessionId
    };

    return this.findByIdAndUpdate(
        adminId,
        { $push: { auditTrail: auditEntry } },
        { new: true }
    );
};

ClientSchema.statics.updateTrustScore = function(clientId, factor, impact, description) {
    return this.findByIdAndUpdate(
        clientId,
        {
            $push: {
                'trustScore.factors': {
                    factor,
                    impact,
                    date: new Date(),
                    description
                }
            }
        },
        { new: true }
    );
};

// Model creation function
const getModels = async () => {
    await connectDB();

    const AAngBase = mongoose.models.Base || model("Base", AAngSchema);
    const Client = mongoose.models.Client || AAngBase.discriminator("Client", ClientSchema);
    const Driver = mongoose.models.Driver || AAngBase.discriminator("Driver", DriverSchema);
    const Admin = mongoose.models.Admin || AAngBase.discriminator("Admin", AdminSchema);

    return { AAngBase, Client, Driver, Admin };
};

export default getModels;