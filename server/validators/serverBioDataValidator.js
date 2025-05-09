// bioDataValidator.js
import { z } from 'zod';

export const userBioDataValidator = z.object({
    email: z.string().email(),
    fullName: z.string().min(1),
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/), // Basic regex for phone number without `react-phone-number-input`
    nextOfKinPhone: z.string().regex(/^\+[1-9]\d{1,14}$/),
    gender: z.enum(["Male", "Female", "Other"]),
    
});