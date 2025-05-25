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
    role: Yup.string().oneOf(['Client', 'Driver', 'Admin']).required()
});

export const validateSchema = async (schema, data) => {
    try {
        await schema.validate(data, { abortEarly: false });
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            errors: error.errors || ['Validation failed']
        };
    }
};
