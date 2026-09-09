import { Button } from "ui";

export function LoginScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <section className="w-full max-w-sm rounded-lg bg-white p-6 shadow">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Login</h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </header>

        <form className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <Button type="submit" className="w-full">
            Login
          </Button>
        </form>
      </section>
    </main>
  );
}
