import { z } from 'zod';

// users/{uid} (spec §6.1). Created the first time a user creates a rental.
// `locale` and `readingLevel` stay null until the app sends the user's
// settings.
export const User = z.object({
  uid: z.string().min(1),
  createdAt: z.date(),
  authProvider: z.enum(['anonymous', 'apple', 'other']),
  locale: z.string().nullable(),
  readingLevel: z.string().nullable(),
  impactOptIn: z.boolean(),
});
export type User = z.infer<typeof User>;
