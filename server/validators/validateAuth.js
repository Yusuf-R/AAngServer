import * as Yup from 'yup';

export const resetPasswordSchema = Yup.object().shape({
    token: Yup.string().required('Token is required'),
    newPassword: Yup.string()
        .required('Password is required')
        .min(8, 'Password must be at least 8 characters')
        .matches(/[A-Z]/, 'Must contain at least one uppercase letter')
        .matches(/[a-z]/, 'Must contain at least one lowercase letter')
        .matches(/[0-9]/, 'Must contain at least one number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/, 'Must contain at least one special character'),
    confirmPassword: Yup.string()
        .oneOf([Yup.ref('newPassword'), null], 'Passwords must match')
        .required('Confirm Password is required'),
    email: Yup.string().email().required(),
    reqType: Yup.string().oneOf(['resetPassword']).required()
});

export const signUpSchema = Yup.object().shape({
    email: Yup.string().email().required(),
    password: Yup.string()
        .required()
        .min(8)
        .matches(/[A-Z]/, 'Must include uppercase')
        .matches(/[a-z]/, 'Must include lowercase')
        .matches(/[0-9]/, 'Must include number')
        .matches(/[!@#$%^&*(),.?":{}|<>]/, 'Must include special char'),
    role: Yup.string().oneOf(['Client', 'Driver', 'Admin']).required()
});

export const logInSchema = Yup.object().shape({
    email: Yup.string().email().required(),
    password: Yup.string().required(),
});


// update profile validation
export const profileUpdateSchema = Yup.object().shape({
    fullName: Yup.string()
        .required('Full name is required')
        .min(2, 'Full name must be at least 2 characters')
        .max(50, 'Full name cannot exceed 50 characters')
        .matches(/^[a-zA-Z\s]+$/, 'Full name can only contain letters and spaces'),

    phoneNumber: Yup.string()
        .required('Phone number is required')
        .matches(
            /^(\+234|0)[7-9][0-1]\d{8}$/,
            'Please enter a valid Nigerian phone number'
        ),

    dob: Yup.date()
        .required('Date of birth is required')
        .max(
            new Date(Date.now() - 13 * 365 * 24 * 60 * 60 * 1000),
            'Must be at least 13 years old'
        )
        .min(
            new Date(Date.now() - 100 * 365 * 24 * 60 * 60 * 1000),
            'Invalid date of birth'
        ),

    gender: Yup.string()
        .required('Gender is required')
        .oneOf(['Male', 'Female'], 'Please select a valid gender'),

    state: Yup.string().required('State is required'),

    lga: Yup.string().required('Local Government Area is required'),

    address: Yup.string()
        .required('Address is required')
        .min(10, 'Address must be at least 10 characters')
        .max(200, 'Address cannot exceed 200 characters'),


    // Make avatar completely optional
    avatar: Yup.string()
        .nullable()
        .optional()
        .url('Avatar must be a valid URL')
        .test(
            'is-cloudinary-url',
            'Avatar must be from Cloudinary',
            (value) => !value || value.includes('res.cloudinary.com')
        ),

    // Read-only fields that shouldn't be updated through this endpoint

});

export const avatarSchema = Yup.object().shape({
    // Make avatar completely optional
    avatar: Yup.string()
        .url('Avatar must be a valid URL')
        .test(
            'is-cloudinary-url',
            'Avatar must be from Cloudinary',
            (value) => !value || value.includes('res.cloudinary.com')
        ),
});


export const validateSchema = async (schema, data) => {
    try {
        await schema.validate(data, {abortEarly: false});
        return {valid: true};
    } catch (error) {
        return {
            valid: false,
            errors: error.errors || ['Validation failed']
        };
    }
};
