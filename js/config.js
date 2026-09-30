/* =============================================================================
   Landscapers Inc. HQ — configuration
   -----------------------------------------------------------------------------
   The ONLY file you edit to go live.

   mode: 'local'     Everything runs in this browser (IndexedDB). The full company
                     dataset is loaded on first run. Perfect for trying the system,
                     training staff, or a single office PC. Nothing leaves the device.

   mode: 'supabase'  Production. Shared Postgres database, real per-person logins,
                     Row Level Security, file storage, realtime chat and live updates
                     across every phone and PC. See docs/SETUP-SUPABASE.md.

   The anon key is safe in the browser ONLY because every table has RLS.
   NEVER paste the service_role key anywhere in this project.
   ========================================================================== */

export const CONFIG = {
  mode: 'local',                 // 'local' | 'supabase'
  SUPABASE_URL: '',              // e.g. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',         // the public "anon" key — never service_role

  appName: 'Landscapers Inc. HQ',
  shortName: 'LSI HQ',
  tagline: 'Transforming your outdoor space, one garden at a time.',
  timezone: 'Africa/Johannesburg',
  locale: 'en-ZA',
  currency: 'ZAR',

  // Money display: 'R9,000.00' (default, matches company invoices) or 'R 9 000,00' (SANS style)
  moneyStyle: 'business',
  vatRate: 0.15,                 // South African VAT rate. Only applied when the company is VAT registered (Admin → Company).

  // Session security
  idleTimeoutMinutes: 45,
  rememberDeviceDays: 14,

  // Local-mode storage
  dbName: 'landscapers-hq',
  dbVersion: 1,
  storagePrefix: 'lsihq.',

  // Supabase Edge Functions (deployed from /supabase/functions). Leave as-is.
  functions: {
    sendEmail: 'send-email',
    assistant: 'ai-assistant',
    adminUsers: 'admin-users'
  },

  // Storage buckets (created by sql/04_storage.sql)
  buckets: { drive: 'drive', avatars: 'avatars' },

  // Video meetings (Meet app). Jitsi is free and needs no account.
  meetBaseUrl: 'https://meet.jit.si/',

  // Reminder engine
  reminderTickSeconds: 30,
  defaultEventReminders: [30, 1440], // minutes before: 30 min and 1 day

  // Machine learning
  ml: { seed: 20260923, testSize: 0.25, retrainAfterNewRecords: 10, retrainEveryDays: 7 }
};

export const IS_SUPABASE = () => CONFIG.mode === 'supabase' && !!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY;
