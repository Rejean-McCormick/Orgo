import Head from "next/head";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { OrgoClient } from "../src/orgo/api";
export default function Account() {
  const [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) {
      setToken(value);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const client = new OrgoClient();
      if (token) {
        if (form.get("password") !== form.get("confirm"))
          throw new Error("Passwords do not match.");
        await client.request("auth/reset", "POST", {
          token,
          password: form.get("password"),
        });
        setToken("");
        setMessage("Password saved. You can sign in.");
      } else {
        await client.request("auth/recover", "POST", {
          organization: form.get("organization"),
          email: form.get("email"),
        });
        setMessage(
          "If the account is eligible, a link will be sent by email.",
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <Head>
        <title>Orgo Access</title>
        <link rel="icon" href="/logo_k.svg" type="image/svg+xml" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <section className="panel form-panel">
        <img className="account-logo" src="/logo_k.svg" alt="Orgo" />
        <h1>
          {token ? "Set your password" : "Recover your access"}
        </h1>
        <form onSubmit={submit}>
          {token ? (
            <>
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Confirm
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Organization
                <input name="organization" required maxLength={100} />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy}>
            {token ? "Save" : "Send link"}
          </button>
        </form>
        <p role="status">{message}</p>
        <Link href="/">Back to Orgo</Link>
      </section>
    </main>
  );
}
