module.exports = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.ORGO_API_URL || "http://localhost:4000"}/api/:path*`,
      },
      {
        source: "/worlds-api/:path*",
        destination: `${process.env.ORGO_WORLDS_API_URL || "http://127.0.0.1:4100/api"}/:path*`,
      },
    ];
  },
};
