/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true
  },
  experimental: {
    serverComponentsExternalPackages: ["casper-js-sdk"]
  }
};

export default nextConfig;
