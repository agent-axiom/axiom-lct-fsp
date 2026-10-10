declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    RESEND_API_KEY?: string;
    FSP_SITE_ORIGIN?: string;
    FSP_OWNER_EMAIL_TEST_ENABLED?: string;
    FSP_OWNER_EMAIL_TEST_TO?: string;
    BUCKET?: R2Bucket;
  }
}
