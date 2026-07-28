/** @type {import('next').NextConfig} */

/*
 * App-wide security headers (plan.md #6).
 *
 * The CSP allows inline scripts because the theme bootstrap in app/layout.js
 * is an inline <script>, and Next itself inlines hydration data. 'unsafe-eval'
 * is added in development only, where webpack's runtime needs it.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // admin-sw.js is served from the root but must only ever control /admin.
        // This header is what lets a root-level file claim a narrower scope.
        source: "/admin-sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/admin" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        source: "/order-sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/order" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // /vitrine used to be the ordering screen. La Vitrine is now a section of
      // the website, and ordering lives at /order.
      { source: "/vitrine", destination: "/order", permanent: true },
    ];
  },
};
export default nextConfig;
