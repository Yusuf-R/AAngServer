import * as yup from 'yup';

const locationSchema = yup.object().shape({
    address: yup
        .string()
        .min(10, 'Address must be at least 10 characters')
        .max(200, 'Address cannot exceed 200 characters')
        .required('Address is required'),

    landmark: yup
        .string()
        .max(100, 'Landmark cannot exceed 100 characters'),

    locationType: yup
        .string()
        .oneOf(['residential', 'commercial', 'office', 'mall', 'hospital', 'school', 'other'])
        .required('Location type is required'),

    contactPerson: yup.object().shape({
        name: yup
            .string()
            .max(50, 'Name cannot exceed 50 characters'),
        phone: yup
            .string()
            .nullable()
            .notRequired()
            .matches(/^(\+2340\d{10}|\+234\d{10}|0\d{10})$/, {
                message: 'Invalid phone number format',
                excludeEmptyString: true,
            }),
        alternatePhone: yup
            .string()
            .nullable()
            .notRequired()
            .matches(/^(\+2340\d{10}|\+234\d{10}|0\d{10})$/, {
                message: 'Invalid alternate phone number format',
                excludeEmptyString: true,
            }),
    }),

    building: yup.object().shape({
        name: yup
            .string()
            .max(100, 'Building name cannot exceed 100 characters'),
        floor: yup
            .string()
            .max(20, 'Floor cannot exceed 20 characters'),
        unit: yup
            .string()
            .max(20, 'Unit cannot exceed 20 characters'),
    }),

    extraInformation: yup
        .string()
        .max(300, 'Instructions cannot exceed 300 characters'),

    coordinates: yup.object().shape({
        lat: yup
            .number()
            .required('Latitude is required'),
        lng: yup
            .number()
            .required('Longitude is required'),
    }),
});

export default locationSchema;