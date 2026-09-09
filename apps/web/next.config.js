module.exports = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.ORGO_API_URL || "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};
