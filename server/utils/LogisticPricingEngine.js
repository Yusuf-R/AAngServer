// utils/LogisticsPricingEngine.js
// Comprehensive, stakeholder-friendly pricing system

// ====== PRICING CONFIGURATION ======
// These values can be easily adjusted by stakeholders
export const PRICING_CONFIG = {
    // Base rates per vehicle type (in NGN)
    baseFares: {
        bicycle: 800,
        motorcycle: 1200,
        tricycle: 1800,
        car: 2500,
        van: 4000,
        truck: 6000
    },

    // Distance-based pricing (per km)
    distanceRates: {
        bicycle: 40,     // 40 NGN per km
        motorcycle: 60,  // 60 NGN per km
        tricycle: 80,    // 80 NGN per km
        car: 100,        // 100 NGN per km
        van: 150,        // 150 NGN per van
        truck: 200       // 200 NGN per km
    },

    // Weight-based surcharges (per kg above free limit)
    weightPricing: {
        freeWeightLimits: {
            bicycle: 2,      // Free up to 2kg
            motorcycle: 5,  // Free up to 5kg
            tricycle: 8,    // Free up to 8kg
            car: 10,         // Free up to 10kg
            van: 10,        // Free up to 10kg
            truck: 10       // Free up to 10kg
        },
        excessRates: {
            bicycle: 50,     // 50 NGN per excess kg
            motorcycle: 150,  // 150 NGN per excess kg
            tricycle: 150,    // 150 NGN per excess kg
            car: 100,         // 100 NGN per excess kg
            van: 100,         // 100 NGN per excess kg
            truck: 100        // 100 NGN per excess kg
        }
    },

    // Priority multipliers
    priorityMultipliers: {
        low: 0.9,        // 10% discount
        normal: 1.0,     // Base rate
        high: 1.3,       // 30% premium
        urgent: 1.8      // 80% premium
    },

    // Time-based multipliers (future feature)
    timeMultipliers: {
        businessHours: 1.0,    // 9AM-6PM
        eveningHours: 1.2,     // 6PM-9PM
        nightHours: 1.5,       // 9PM-6AM
        weekendHours: 1.3,     // Weekends
        holidayHours: 1.6      // Public holidays
    },

    // Fixed surcharges (in NGN)
    surcharges: {
        fragileHandling: 500,
        specialHandling: 300,
        hospitalDelivery: 400,
        mallDelivery: 200,
        highValueItem: 800,     // For items > 50k value
        multipleStops: 600,     // Per additional stop
        waitingTime: 100        // Per 5-minute wait
    },

    // Insurance rates (percentage of declared value)
    insurance: {
        basicRate: 0.015,      // 1.5% of declared value
        premiumRate: 0.025,    // 2.5% for high-value items
        highValueThreshold: 100000, // Above 100k NGN
        minimumPremium: 200    // Minimum insurance fee
    },

    // Tax configuration
    tax: {
        vatRate: 0.075,        // 7.5% VAT
        includeInDisplay: true // Show VAT separately
    },

    // Paystack Fee Configuration for Nigeria
    paymentProcessing: {
        decimalFee: 0.015,      // 1.5%
        flatFee: 100,           // ₦100
        feeCap: 2000,           // ₦2,000 maximum
        flatFeeThreshold: 2500, // ₦100 fee waived under ₦2,500
        currency: 'NGN'
    }
};

// ====== CORE PRICING FUNCTIONS ======

/**
 * Calculate base fare based on vehicle type and distance
 */
export function calculateBaseFare(vehicleType, distanceKm = 0) {
    const baseFare = PRICING_CONFIG.baseFares[vehicleType] || 0;
    const distanceRate = PRICING_CONFIG.distanceRates[vehicleType] || 0;
    const distanceFare = distanceKm * distanceRate;

    return {
        baseFare,
        distanceFare,
        total: baseFare + distanceFare,
        breakdown: {
            description: `Base fare + Distance (${distanceKm.toFixed(1)}km × ₦${distanceRate})`,
            calculation: `₦${baseFare} + ₦${distanceFare.toFixed(0)}`
        }
    };
}

/**
 * Calculate weight-based surcharge
 */
export function calculateWeightSurcharge(vehicleType, weightKg = 0) {
    const freeLimit = PRICING_CONFIG.weightPricing.freeWeightLimits[vehicleType] || 0;
    const excessRate = PRICING_CONFIG.weightPricing.excessRates[vehicleType] || 0;

    if (weightKg <= freeLimit) {
        return {
            surcharge: 0,
            excessWeight: 0,
            breakdown: {
                description: `Within free weight limit (${freeLimit}kg)`,
                calculation: `₦0`
            }
        };
    }

    const excessWeight = weightKg - freeLimit;
    const surcharge = excessWeight * excessRate;

    return {
        surcharge: Math.round(surcharge),
        excessWeight,
        breakdown: {
            description: `Excess weight (${excessWeight.toFixed(1)}kg × ₦${excessRate})`,
            calculation: `₦${surcharge.toFixed(0)}`
        }
    };
}

/**
 * Calculate priority-based multiplier
 */
export function calculatePriorityAdjustment(baseAmount, priority = 'normal') {
    const multiplier = PRICING_CONFIG.priorityMultipliers[priority] || 1.0;
    const adjustment = baseAmount * (multiplier - 1);

    return {
        multiplier,
        adjustment: Math.round(adjustment),
        newTotal: Math.round(baseAmount * multiplier),
        breakdown: {
            description: `${priority.toUpperCase()} priority (${multiplier}x)`,
            calculation: adjustment >= 0 ? `+₦${Math.abs(adjustment)}` : `-₦${Math.abs(adjustment)}`
        }
    };
}

/**
 * Calculate package-specific surcharges
 */
export function calculatePackageSurcharges(packageData = {}) {
    const surcharges = [];
    let totalSurcharge = 0;

    // Fragile handling
    if (packageData.isFragile) {
        const amount = PRICING_CONFIG.surcharges.fragileHandling;
        surcharges.push({
            type: 'fragile_handling',
            amount,
            reason: 'Fragile item handling fee'
        });
        totalSurcharge += amount;
    }

    // Special handling
    if (packageData.requiresSpecialHandling) {
        const amount = PRICING_CONFIG.surcharges.specialHandling;
        surcharges.push({
            type: 'special_handling',
            amount,
            reason: 'Special handling required'
        });
        totalSurcharge += amount;
    }

    // High-value item
    const declaredValue = packageData.declaredValue || 0;
    if (declaredValue > 50000) {
        const amount = PRICING_CONFIG.surcharges.highValueItem;
        surcharges.push({
            type: 'high_value',
            amount,
            reason: 'High-value item surcharge'
        });
        totalSurcharge += amount;
    }

    return {
        surcharges,
        totalSurcharge,
        breakdown: {
            description: `Package surcharges (${surcharges.length} items)`,
            calculation: `₦${totalSurcharge}`
        }
    };
}

/**
 * Calculate location-specific surcharges
 */
export function calculateLocationSurcharges(pickupLocation = {}, dropoffLocation = {}) {
    const surcharges = [];
    let totalSurcharge = 0;

    // Hospital delivery
    if (dropoffLocation.locationType === 'hospital') {
        const amount = PRICING_CONFIG.surcharges.hospitalDelivery;
        surcharges.push({
            type: 'hospital_delivery',
            amount,
            reason: 'Hospital delivery fee'
        });
        totalSurcharge += amount;
    }

    // Mall delivery
    if (dropoffLocation.locationType === 'mall') {
        const amount = PRICING_CONFIG.surcharges.mallDelivery;
        surcharges.push({
            type: 'mall_delivery',
            amount,
            reason: 'Shopping mall delivery fee'
        });
        totalSurcharge += amount;
    }

    return {
        surcharges,
        totalSurcharge,
        breakdown: {
            description: `Location surcharges (${surcharges.length} items)`,
            calculation: `₦${totalSurcharge}`
        }
    };
}

/**
 * Calculate insurance premium
 */
export function calculateInsurance(declaredValue = 0, isInsured = false) {
    if (!isInsured || declaredValue <= 0) {
        return {
            premium: 0,
            rate: 0,
            breakdown: {
                description: 'No insurance selected',
                calculation: '₦0'
            }
        };
    }

    const isHighValue = declaredValue > PRICING_CONFIG.insurance.highValueThreshold;
    const rate = isHighValue ?
        PRICING_CONFIG.insurance.premiumRate :
        PRICING_CONFIG.insurance.basicRate;

    const calculatedPremium = declaredValue * rate;
    const premium = Math.max(calculatedPremium, PRICING_CONFIG.insurance.minimumPremium);

    return {
        premium: Math.round(premium),
        rate,
        isHighValue,
        breakdown: {
            description: `Insurance (${(rate * 100).toFixed(1)}% of ₦${declaredValue.toLocaleString()})`,
            calculation: `₦${premium.toFixed(0)}`
        }
    };
}

/**
 * Calculate Paystack processing fees and final customer amount
 * Ensures you receive exact amount after fees
 */
export function calculatePaystackFees(amount) {
    const { decimalFee, flatFee, feeCap, flatFeeThreshold } = PRICING_CONFIG.paymentProcessing;

    // Determine if flat fee applies
    const effectiveFlatFee = amount < flatFeeThreshold ? 0 : flatFee;

    // Calculate applicable fees
    const applicableFees = (decimalFee * amount) + effectiveFlatFee;

    let processingFee, finalCustomerAmount;

    if (applicableFees > feeCap) {
        // Use fee cap (rare case for very large amounts)
        processingFee = feeCap;
        finalCustomerAmount = amount + feeCap;
    } else {
        // Use percentage + flat fee formula
        finalCustomerAmount = ((amount + effectiveFlatFee) / (1 - decimalFee)) + 0.01;
        processingFee = finalCustomerAmount - amount;
    }

    return {
        processingFee: Math.ceil(processingFee),
        finalCustomerAmount: Math.ceil(finalCustomerAmount),
        effectiveFlatFee,
        breakdown: {
            description: `Payment processing (${(decimalFee * 100)}% + ₦${effectiveFlatFee})`,
            calculation: `₦${Math.ceil(processingFee)}`
        }
    };
}

/**
 * Apply discount (future feature for promo codes)
 */
export function applyDiscount(subtotal, discountCode = null) {
    // Placeholder for future discount logic
    // This is where stakeholders can define promotional rules

    const discountRules = {
        'FIRST10': { type: 'percentage', value: 10, minOrder: 1000 },
        'STUDENT': { type: 'fixed', value: 200, minOrder: 500 },
        'WEEKEND20': { type: 'percentage', value: 20, minOrder: 2000 }
    };

    if (!discountCode || !discountRules[discountCode]) {
        return {
            discount: 0,
            code: null,
            reason: null,
            breakdown: {
                description: 'No discount applied',
                calculation: '₦0'
            }
        };
    }

    const rule = discountRules[discountCode];

    if (subtotal < rule.minOrder) {
        return {
            discount: 0,
            code: discountCode,
            reason: `Minimum order of ₦${rule.minOrder} required`,
            breakdown: {
                description: 'Discount not applicable',
                calculation: '₦0'
            }
        };
    }

    let discountAmount = 0;
    if (rule.type === 'percentage') {
        discountAmount = subtotal * (rule.value / 100);
    } else {
        discountAmount = rule.value;
    }

    return {
        discount: Math.round(discountAmount),
        code: discountCode,
        reason: `${rule.value}${rule.type === 'percentage' ? '%' : ' NGN'} discount applied`,
        breakdown: {
            description: `Discount code: ${discountCode}`,
            calculation: `-₦${discountAmount.toFixed(0)}`
        }
    };
}

/**
 * Calculate VAT
 */
export function calculateVAT(taxableAmount) {
    const vat = taxableAmount * PRICING_CONFIG.tax.vatRate;

    return {
        vat: Math.round(vat),
        rate: PRICING_CONFIG.tax.vatRate,
        breakdown: {
            description: `VAT (${(PRICING_CONFIG.tax.vatRate * 100)}%)`,
            calculation: `₦${vat.toFixed(0)}`
        }
    };
}

/**
 * Master pricing calculation function
 */
export function calculateTotalPrice(orderData = {}) {
    // Extract order details
    const vehicleType = determineOptimalVehicle(orderData);
    const distance = calculateOrderDistance(orderData);
    const packageWeight = getPackageWeight(orderData);
    const priority = orderData.priority || 'normal';
    const packageData = orderData.package || {};
    const pickupLocation = orderData.location?.pickUp || {};
    const dropoffLocation = orderData.location?.dropOff || {};
    const insuranceData = orderData.insurance || {};

    // Step 1: Base fare calculation
    const baseFareCalc = calculateBaseFare(vehicleType, distance);

    // Step 2: Weight surcharge
    const weightCalc = calculateWeightSurcharge(vehicleType, packageWeight);

    // Step 3: Priority adjustment
    const baseAmount = baseFareCalc.total + weightCalc.surcharge;
    const priorityCalc = calculatePriorityAdjustment(baseAmount, priority);

    // Step 4: Package surcharges
    const packageSurcharges = calculatePackageSurcharges(packageData);

    // Step 5: Location surcharges
    const locationSurcharges = calculateLocationSurcharges(pickupLocation, dropoffLocation);

    // Step 6: Insurance
    const insuranceCalc = calculateInsurance(
        insuranceData.declaredValue,
        insuranceData.isInsured
    );

    // Step 7: Subtotal before discount
    const subtotal = priorityCalc.newTotal +
        packageSurcharges.totalSurcharge +
        locationSurcharges.totalSurcharge +
        insuranceCalc.premium;

    // Step 8: Apply discount
    const discountCalc = applyDiscount(subtotal, orderData.discountCode);

    // Step 9: Calculate VAT
    const taxableAmount = subtotal - discountCalc.discount;
    const vatCalc = calculateVAT(taxableAmount);

    // Step 10: Final delivery total (what you want to receive)
    const deliveryTotal = taxableAmount + vatCalc.vat;

    // Step 11: Calculate Paystack fees and final customer amount
    const paystackCalc = calculatePaystackFees(deliveryTotal);

    // Compile all surcharges for backend
    const allSurcharges = [
        ...packageSurcharges.surcharges,
        ...locationSurcharges.surcharges
    ];

    return {
        // Frontend display values
        displayBreakdown: {
            deliveryService: baseFareCalc.total + weightCalc.surcharge + priorityCalc.adjustment,
            packageSurcharges: packageSurcharges.totalSurcharge,
            locationSurcharges: locationSurcharges.totalSurcharge,
            insurance: insuranceCalc.premium,
            discount: discountCalc.discount,
            vat: vatCalc.vat,
            total: paystackCalc.finalCustomerAmount
        },

        // Backend schema-compliant structure
        backendPricing: {
            baseFare: baseFareCalc.baseFare,
            distanceFare: baseFareCalc.distanceFare,
            timeFare: 0, // Future feature
            weightFare: weightCalc.surcharge,
            priorityFare: priorityCalc.adjustment,
            surcharges: allSurcharges,
            discount: discountCalc.discount > 0 ? {
                amount: discountCalc.discount,
                code: discountCalc.code,
                reason: discountCalc.reason
            } : undefined,
            // CRITICAL: Financial breakdown
            financialBreakdown: {
                deliveryTotal: Math.round(deliveryTotal),
                customerAmount: paystackCalc.finalCustomerAmount,
                processingFee: paystackCalc.processingFee,     // Paystack's cut
                netAmount: Math.round(deliveryTotal),

                // Revenue sharing (70/30 split)
                driverEarnings: Math.round(deliveryTotal * 0.7),
                platformRevenue: Math.round(deliveryTotal * 0.3),

                currency: 'NGN'
            },

            totalAmount: paystackCalc.finalCustomerAmount, // Charge this to customer
            currency: 'NGN'
        },

        // Detailed breakdown for stakeholder review
        detailedBreakdown: {
            baseFare: baseFareCalc,
            weight: weightCalc,
            priority: priorityCalc,
            packageSurcharges,
            locationSurcharges,
            insurance: insuranceCalc,
            discount: discountCalc,
            vat: vatCalc,
            vehicleType,
            distance: distance.toFixed(1),
            packageWeight,
            // Financial summary
            financialSummary: {
                youReceive: Math.round(deliveryTotal),
                customerPays: paystackCalc.finalCustomerAmount,
                paystackFee: paystackCalc.processingFee,
                driverShare: Math.round(deliveryTotal * 0.7),
                yourShare: Math.round(deliveryTotal * 0.3)
            }
        }
    };
}

// ====== UTILITY FUNCTIONS ======

function determineOptimalVehicle(orderData) {
    const selectedVehicles = orderData.vehicleRequirements || [];

    // GUARANTEED: selectedVehicles is never empty and all vehicles are valid
    const vehicleHierarchy = ['bicycle', 'motorcycle', 'tricycle', 'car', 'van', 'truck'];

    // Return the most expensive (highest-tier) vehicle from user's selection
    for (let i = vehicleHierarchy.length - 1; i >= 0; i--) {
        if (selectedVehicles.includes(vehicleHierarchy[i])) {
            return vehicleHierarchy[i];
        }
    }

    // This should NEVER be reached, but safety fallback
    return selectedVehicles[0];
}

function calculateOrderDistance(orderData) {
    const pickup = orderData.location?.pickUp?.coordinates?.coordinates;
    const dropoff = orderData.location?.dropOff?.coordinates?.coordinates;

    return haversineDistance(pickup[1], pickup[0], dropoff[1], dropoff[0]);
}

function getPackageWeight(orderData) {
    const weight = orderData.package?.weight;
    if (!weight?.value) return 0;
    return weight.unit === 'g' ? weight.value / 1000 : weight.value;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRadians(deg) {
    return deg * (Math.PI/180);
}